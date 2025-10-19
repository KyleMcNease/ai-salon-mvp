from __future__ import annotations

import datetime as dt
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, MutableMapping, Optional, Sequence
from uuid import uuid4

from scribe_core.llm import LLMMessage, LLMResult, ToolDefinition
from scribe_core.provider_router import ProviderRouter, UnknownProviderError


JobStatus = str


@dataclass
class AgentJobRequest:
    """Payload used to create an agent job."""

    provider: str
    model: str
    instructions: Optional[str] = None
    messages: Sequence[Mapping[str, Any]] = field(default_factory=list)
    tools: Optional[Sequence[Mapping[str, Any] | ToolDefinition]] = None
    metadata: Optional[Mapping[str, Any]] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    tool_choice: Optional[Mapping[str, Any]] = None
    session_id: Optional[str] = None
    inputs: Optional[Mapping[str, Any]] = None


@dataclass
class AgentJob:
    """Runtime representation of a queued job."""

    id: str
    status: JobStatus
    provider: str
    model: str
    created_at: dt.datetime
    updated_at: dt.datetime
    input: AgentJobRequest
    result: Optional[LLMResult] = None
    error: Optional[str] = None
    logs: List[str] = field(default_factory=list)
    progress: float = 0.0
    artifacts: List[Mapping[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "status": self.status,
            "provider": self.provider,
            "model": self.model,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "instructions": self.input.instructions,
            "messages": list(self.input.messages),
            "progress": self.progress,
            "logs": list(self.logs),
        }

        if self.input.tools:
            payload["tools"] = [_tool_to_payload(t) for t in self.input.tools]
        if self.input.metadata:
            payload["metadata"] = dict(self.input.metadata)
        if self.input.session_id:
            payload["session_id"] = self.input.session_id
        if self.input.inputs:
            payload["inputs"] = dict(self.input.inputs)
        if self.error:
            payload["error"] = self.error
        if self.result:
            payload["output"] = _result_to_payload(self.result)
        if self.artifacts:
            payload["artifacts"] = [dict(artifact) for artifact in self.artifacts]

        return payload


class AgentJobStore:
    """In-memory store for tracking agent jobs during a process lifetime."""

    def __init__(self) -> None:
        self._jobs: MutableMapping[str, AgentJob] = {}
        self._lock = threading.Lock()

    def put(self, job: AgentJob) -> None:
        with self._lock:
            self._jobs[job.id] = job

    def get(self, job_id: str) -> AgentJob:
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            return self._jobs[job_id]

    def all(self) -> List[AgentJob]:
        with self._lock:
            return list(self._jobs.values())


class AgentJobRunner:
    """Synchronously execute agent jobs via the provider router."""

    TERMINAL_STATUSES = frozenset({"completed", "failed"})

    def __init__(
        self,
        *,
        router: Optional[ProviderRouter] = None,
        store: Optional[AgentJobStore] = None,
    ) -> None:
        self.router = router or ProviderRouter.lazy_default()
        self.store = store or AgentJobStore()

    def create_job(self, request: AgentJobRequest) -> AgentJob:
        """Create and execute a new job in-process."""

        job_id = str(uuid4())
        now = dt.datetime.now(dt.timezone.utc)
        job = AgentJob(
            id=job_id,
            status="running",
            provider=request.provider,
            model=request.model,
            created_at=now,
            updated_at=now,
            input=request,
            logs=["Job received.", "Dispatching to provider."],
        )
        self.store.put(job)

        try:
            messages = self._build_messages(request)
            result = self.router.send(
                provider=request.provider,
                model=request.model,
                messages=messages,
                tools=request.tools,
                system=request.instructions,
                metadata=request.metadata,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                tool_choice=request.tool_choice,
            )
        except UnknownProviderError as exc:
            job.status = "failed"
            job.error = str(exc)
            job.logs.append(f"Provider error: {exc}")
        except Exception as exc:  # pragma: no cover - defensive guardrail
            job.status = "failed"
            job.error = str(exc)
            job.logs.append(f"Unhandled error: {exc}")
        else:
            job.status = "completed"
            job.result = result
            job.progress = 1.0
            job.logs.append("Provider completed successfully.")
            job.artifacts = self._build_artifacts(result)

        job.updated_at = dt.datetime.now(dt.timezone.utc)
        self.store.put(job)
        return job

    def get_job(self, job_id: str) -> AgentJob:
        return self.store.get(job_id)

    def list_jobs(self) -> List[AgentJob]:
        return self.store.all()

    def _build_messages(self, request: AgentJobRequest) -> List[LLMMessage]:
        messages: List[LLMMessage] = []
        for message in request.messages:
            role = message.get("role")
            content = message.get("content")
            if not isinstance(role, str):
                raise ValueError("Each message must include a 'role' field.")
            if content is None:
                raise ValueError("Each message must include a 'content' field.")
            messages.append(LLMMessage(role=role, content=content))

        if not messages:
            goal = ""
            if request.inputs and isinstance(request.inputs, Mapping):
                goal_value = request.inputs.get("goal")
                if isinstance(goal_value, str):
                    goal = goal_value
            if goal:
                messages.append(LLMMessage(role="user", content=goal))

        return messages

    def _build_artifacts(self, result: LLMResult) -> List[Mapping[str, Any]]:
        artifacts: List[Mapping[str, Any]] = []
        if result.text:
            artifacts.append(
                {
                    "id": f"artifact-{uuid4()}",
                    "type": "TEXT",
                    "uri": result.text,
                }
            )
        return artifacts


def _tool_to_payload(tool: Mapping[str, Any] | ToolDefinition) -> Mapping[str, Any]:
    if isinstance(tool, ToolDefinition):
        payload = tool.to_payload()
        payload.pop("metadata", None)
        return payload
    return dict(tool)


def _result_to_payload(result: LLMResult) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "text": result.text,
        "stop_reason": result.stop_reason,
        "model": result.model,
        "tool_calls": [
            {
                "id": call.id,
                "name": call.name,
                "arguments": dict(call.arguments),
            }
            for call in result.tool_calls
        ],
    }

    if result.usage:
        payload["usage"] = {
            "input_tokens": result.usage.input_tokens,
            "output_tokens": result.usage.output_tokens,
            "total_tokens": result.usage.total_tokens,
        }

    return payload
