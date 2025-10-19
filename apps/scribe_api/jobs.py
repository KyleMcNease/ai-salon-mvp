from __future__ import annotations

from typing import Any, Dict, Iterable, Mapping, Optional, Sequence

from scribe_agents.runtime.jobs import AgentJobRequest, AgentJobRunner
from scribe_core.provider_router import ProviderRouter


class AnthropicJobsAPI:
    """Facade implementing an Anthropic-style jobs contract."""

    def __init__(
        self,
        *,
        router: Optional[ProviderRouter] = None,
        runner: Optional[AgentJobRunner] = None,
    ) -> None:
        if runner is not None and router is not None:
            self.runner = runner
            self.router = router
        elif runner is not None:
            self.runner = runner
            self.router = runner.router
        else:
            self.router = router or ProviderRouter.lazy_default()
            self.runner = runner or AgentJobRunner(router=self.router)

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def create_job(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        request = self._parse_job_request(payload)
        job = self.runner.create_job(request)
        return job.to_dict()

    def get_job(self, job_id: str) -> Dict[str, Any]:
        job = self.runner.get_job(job_id)
        return job.to_dict()

    def list_jobs(self) -> Sequence[Dict[str, Any]]:
        return [job.to_dict() for job in self.runner.list_jobs()]

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _parse_job_request(self, payload: Mapping[str, Any]) -> AgentJobRequest:
        provider = str(payload.get("provider") or "anthropic")
        model = str(payload.get("model") or payload.get("agent_model") or "")
        if not model:
            raise ValueError("Job payload must include a 'model' (or 'agent_model').")

        instructions = payload.get("instructions")
        if instructions is not None and not isinstance(instructions, str):
            raise ValueError("'instructions' must be a string if provided.")

        messages = payload.get("messages") or []
        if not isinstance(messages, Iterable):
            raise ValueError("'messages' must be a list.")
        message_list = []
        for item in messages:
            if not isinstance(item, Mapping):
                raise ValueError("Each message entry must be a mapping.")
            message_list.append(dict(item))

        tools = payload.get("tools")
        tool_list: Optional[Sequence[Mapping[str, Any]]] = None
        if tools is not None:
            if not isinstance(tools, Iterable):
                raise ValueError("'tools' must be a list when provided.")
            tool_list = []
            for item in tools:
                if not isinstance(item, Mapping):
                    raise ValueError("Each tool definition must be a mapping.")
                tool_list.append(dict(item))

        max_tokens = payload.get("max_tokens")
        temperature = payload.get("temperature")
        metadata = payload.get("metadata")
        tool_choice = payload.get("tool_choice")
        session_id = payload.get("session_id")
        inputs = payload.get("inputs")

        request = AgentJobRequest(
            provider=provider,
            model=model,
            instructions=instructions,
            messages=message_list,
            tools=tool_list,
            metadata=dict(metadata) if isinstance(metadata, Mapping) else None,
            max_tokens=int(max_tokens) if isinstance(max_tokens, int) else None,
            temperature=float(temperature) if isinstance(temperature, (int, float)) else None,
            tool_choice=dict(tool_choice) if isinstance(tool_choice, Mapping) else None,
            session_id=str(session_id) if isinstance(session_id, str) and session_id else None,
            inputs=dict(inputs) if isinstance(inputs, Mapping) else None,
        )
        return request
