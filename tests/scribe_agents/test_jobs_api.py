from __future__ import annotations

import re
from typing import Any, Dict, Mapping, Optional, Sequence

from apps.scribe_api import AnthropicJobsAPI
from scribe_agents.runtime.jobs import AgentJobRequest, AgentJobRunner
from scribe_core.llm import AnthropicClient, LLMMessage, LLMResult
from scribe_core.provider_router import ProviderRouter


class StubAnthropicClient(AnthropicClient):
    def __init__(self, responder: Optional[LLMResult] = None) -> None:
        super().__init__(api_key="stub-key", base_url="https://example.com")
        self.responder = responder or LLMResult(text="default")
        self.calls: list[Dict[str, Any]] = []

    def send_messages(  # type: ignore[override]
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Optional[Sequence[Any]] = None,
        system: Optional[str] = None,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        tool_choice: Optional[Mapping[str, Any]] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
    ) -> LLMResult:
        self.calls.append(
            {
                "messages": [message.role for message in messages],
                "system": system,
                "model": model,
                "metadata": metadata,
            }
        )
        return self.responder


def _build_runner(result_text: str = "Agent completed.") -> AgentJobRunner:
    client = StubAnthropicClient(LLMResult(text=result_text))
    router = ProviderRouter(anthropic_client=client)
    return AgentJobRunner(router=router)


def test_agent_job_runner_completes_job() -> None:
    runner = _build_runner("Computation done.")
    request = AgentJobRequest(
        provider="anthropic",
        model="claude-3.5-sonnet",
        instructions="Be concise.",
        messages=[{"role": "user", "content": "Summarize the cosmos."}],
        session_id="sess-123",
        inputs={"goal": "Summarize the cosmos."},
    )

    job = runner.create_job(request)

    assert job.status == "completed"
    assert job.result is not None
    assert job.result.text == "Computation done."
    assert re.match(r"^[0-9a-f-]{36}$", job.id)
    assert job.progress == 1.0
    assert any("Provider completed successfully" in log for log in job.logs)
    assert job.artifacts
    assert job.input.session_id == "sess-123"


def test_jobs_api_create_and_fetch() -> None:
    runner = _build_runner("Hello from agent.")
    api = AnthropicJobsAPI(runner=runner)

    created = api.create_job(
        {
            "provider": "anthropic",
            "model": "claude-3-haiku",
            "instructions": "You are playful.",
            "messages": [{"role": "user", "content": "Tell a joke."}],
            "session_id": "sess-456",
            "inputs": {"goal": "Tell a joke."},
        }
    )

    job_id = created["id"]
    assert created["status"] == "completed"
    assert created["output"]["text"] == "Hello from agent."
    assert created["progress"] == 1.0
    assert created["logs"]
    assert created["artifacts"]
    assert created["session_id"] == "sess-456"

    fetched = api.get_job(job_id)
    assert fetched["id"] == job_id
    assert fetched["output"]["text"] == "Hello from agent."
    assert fetched["logs"]

    listing = api.list_jobs()
    assert len(listing) == 1
    assert listing[0]["id"] == job_id
    assert listing[0]["artifacts"]


def test_jobs_api_accepts_agent_model_alias() -> None:
    runner = _build_runner("Alias works.")
    api = AnthropicJobsAPI(runner=runner)

    created = api.create_job(
        {
            "agent_model": "claude-3-5-sonnet",
            "instructions": "Answer directly.",
            "inputs": {"goal": "State alias success."},
        }
    )

    assert created["status"] == "completed"
    assert created["output"]["text"] == "Alias works."
