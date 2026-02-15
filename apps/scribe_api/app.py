"""FastAPI app exposing SCRIBE runtime and shared-state duet endpoints."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from scribe_agents.salon.salon_personas import (
    get_default_personas,
    get_personas_with_voice_overrides,
    list_voice_catalog,
    load_persona_voice_overrides,
    save_persona_voice_overrides,
)
from scribe_core.provider_profiles import ProviderProfileUpdate, ProviderProfilesStore
from scribe_core.provider_router import ProviderRouter
from scribe_core.shared_state import SharedSessionStore

app = FastAPI(title="Scribe API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

profiles_store = ProviderProfilesStore()
shared_sessions = SharedSessionStore()
router = ProviderRouter.lazy_default()
_RESEARCH_HANDOFF_ROOT = Path("data/research_handoffs")
_PERSONA_VOICE_OVERRIDES_PATH = Path("data/persona_voice_overrides.json")
_MAX_CONTEXT_MESSAGE_CHARS = 4000
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$")
_TELEMETRY_MAX_EVENTS = 500
_telemetry_events: deque[Dict[str, Any]] = deque(maxlen=_TELEMETRY_MAX_EVENTS)

DEFAULT_OPENAI_MODEL = "gpt-5.2-codex"
DEFAULT_ANTHROPIC_MODEL = "opus"

_DEFAULT_MODELS = {
    "anthropic": [
        DEFAULT_ANTHROPIC_MODEL,
        "claude-opus-4-1-20250805",
        "claude-3-7-sonnet-20250219",
    ],
    "openai": [
        DEFAULT_OPENAI_MODEL,
        "o3",
        "gpt-4.1",
    ],
    "local": [
        "gpt-oss-120b",
        "llama3.3:70b",
    ],
}


class BridgeAgentRequest(BaseModel):
    provider: str
    model: str
    profile_id: Optional[str] = None
    label: Optional[str] = None


class DuetTurnRequest(BaseModel):
    session_id: str
    user_message: str
    system_prompt: Optional[str] = None
    agents: List[BridgeAgentRequest] = Field(
        default_factory=lambda: [
            BridgeAgentRequest(
                provider="openai",
                model=DEFAULT_OPENAI_MODEL,
                profile_id="openai:default",
                label="Codex",
            ),
            BridgeAgentRequest(
                provider="anthropic",
                model=DEFAULT_ANTHROPIC_MODEL,
                profile_id="anthropic:default",
                label="Claude",
            ),
        ]
    )


class DuetConverseRequest(BaseModel):
    session_id: str
    seed_user_message: Optional[str] = None
    system_prompt: Optional[str] = None
    rounds: int = Field(default=2, ge=1, le=12)
    agents: List[BridgeAgentRequest] = Field(
        default_factory=lambda: [
            BridgeAgentRequest(
                provider="openai",
                model=DEFAULT_OPENAI_MODEL,
                profile_id="openai:default",
                label="Codex",
            ),
            BridgeAgentRequest(
                provider="anthropic",
                model=DEFAULT_ANTHROPIC_MODEL,
                profile_id="anthropic:default",
                label="Claude",
            ),
        ]
    )


class SessionMemoryUpdate(BaseModel):
    summary: Optional[str] = None
    key_facts: Optional[List[str]] = None
    user_preferences: Optional[List[str]] = None
    agent_notes: Optional[List[str]] = None
    merge: bool = True


class PersonaVoiceUpdate(BaseModel):
    voice_id: Optional[str] = None


class ResearchHandoffCreateRequest(BaseModel):
    session_id: str
    mode: Optional[str] = "hybrid"
    query: Optional[str] = None
    research_url: Optional[str] = None
    include_recent_messages: int = Field(default=8, ge=0, le=50)


class ResearchIngestRequest(BaseModel):
    session_id: str
    source: str = "research-app"
    mode: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    findings: List[str] = Field(default_factory=list)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    raw: Optional[Dict[str, Any]] = None


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_valid_session_id(session_id: str) -> str:
    candidate = str(session_id or "").strip()
    if not _SESSION_ID_RE.fullmatch(candidate):
        raise ValueError("invalid session_id: use 3-128 chars of letters, numbers, '_' or '-'")
    return candidate


def _workspace_path_for_session(session_id: str) -> str:
    safe_session_id = _require_valid_session_id(session_id)
    return str((Path.cwd() / "data" / "workspaces" / safe_session_id).resolve())


def _record_telemetry(event: Dict[str, Any]) -> None:
    payload = dict(event)
    payload.setdefault("timestamp", _timestamp())
    _telemetry_events.append(payload)


def _record_agent_telemetry(
    *,
    session_id: str,
    route: str,
    provider: str,
    model: str,
    label: str,
    meta: Dict[str, Any],
    round_index: Optional[int] = None,
) -> None:
    _record_telemetry(
        {
            "event_type": "agent_turn",
            "session_id": session_id,
            "route": route,
            "provider": provider,
            "model": model,
            "label": label,
            "round": round_index,
            "latency_ms": meta.get("latency_ms"),
            "retries": meta.get("retries", 0),
            "attempt": meta.get("attempt", 1),
            "degraded": bool(meta.get("degraded")),
            "bridge": meta.get("bridge"),
            "profile_id": meta.get("profile_id"),
            "error": meta.get("error"),
            "warnings": meta.get("warnings") or [],
        }
    )


def _sse(event_type: str, payload: Dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload, ensure_ascii=True)}\n\n"


def _default_bridge_agents() -> List[BridgeAgentRequest]:
    return [
        BridgeAgentRequest(
            provider="openai",
            model=DEFAULT_OPENAI_MODEL,
            profile_id="openai:default",
            label="Codex",
        ),
        BridgeAgentRequest(
            provider="anthropic",
            model=DEFAULT_ANTHROPIC_MODEL,
            profile_id="anthropic:default",
            label="Claude",
        ),
    ]


def _model_hint_to_agents(model_name: Optional[str]) -> List[BridgeAgentRequest]:
    agents = _default_bridge_agents()
    if not model_name:
        return agents

    token = model_name.strip()
    if "/" in token:
        token = token.split("/")[-1]

    lowered = token.lower()
    if any(token_name in lowered for token_name in ("claude", "opus", "sonnet", "haiku")):
        agents[1] = BridgeAgentRequest(
            provider="anthropic",
            model=token,
            profile_id="anthropic:default",
            label="Claude",
        )
        return agents

    if lowered.startswith(("gpt", "o1", "o3", "o4")):
        agents[0] = BridgeAgentRequest(
            provider="openai",
            model=token,
            profile_id="openai:default",
            label="Codex",
        )
        return agents

    if "gpt-oss" in lowered or "llama" in lowered:
        agents[0] = BridgeAgentRequest(
            provider="local",
            model=token,
            profile_id="local:gpt-oss",
            label="Local",
        )
    return agents


def _coerce_agents(raw_agents: Any, fallback_agents: List[BridgeAgentRequest]) -> List[BridgeAgentRequest]:
    if not isinstance(raw_agents, list):
        return fallback_agents
    parsed: List[BridgeAgentRequest] = []
    for item in raw_agents:
        if not isinstance(item, dict):
            continue
        try:
            parsed.append(BridgeAgentRequest(**item))
        except Exception:
            continue
    return parsed or fallback_agents


def _to_llm_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    llm_messages: List[Dict[str, str]] = []
    for item in messages:
        role = str(item.get("role") or "user")
        speaker = str(item.get("speaker") or role)
        content = str(item.get("content") or "")
        lowered = content.lower()
        if ("\"subtype\":\"init\"" in lowered or "\"type\":\"system\"" in lowered) and "mcp" in lowered:
            content = "[diagnostic output omitted from shared context]"
        if len(content) > _MAX_CONTEXT_MESSAGE_CHARS:
            content = f"{content[:_MAX_CONTEXT_MESSAGE_CHARS]}\n...[truncated]..."
        if role not in {"user", "assistant"}:
            role = "user"
        speaker_prefix = f"[{speaker}]"
        if not content.startswith(speaker_prefix):
            content = f"{speaker_prefix} {content}" if content else speaker_prefix
        llm_messages.append({"role": role, "content": content})
    return llm_messages


def _clean_memory_list(raw: Any, *, limit: int = 20) -> List[str]:
    if not isinstance(raw, list):
        return []
    cleaned: List[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        cleaned.append(value)
        if len(cleaned) >= limit:
            break
    return cleaned


def _normalize_session_memory(memory: Any) -> Dict[str, Any]:
    if not isinstance(memory, dict):
        memory = {}
    return {
        "summary": str(memory.get("summary") or "").strip(),
        "key_facts": _clean_memory_list(memory.get("key_facts"), limit=25),
        "user_preferences": _clean_memory_list(memory.get("user_preferences"), limit=25),
        "agent_notes": _clean_memory_list(memory.get("agent_notes"), limit=25),
        "updated_at": memory.get("updated_at"),
    }


def _memory_block(memory: Dict[str, Any]) -> str:
    normalized = _normalize_session_memory(memory)
    lines: List[str] = []
    if normalized["summary"]:
        lines.append(f"Summary: {normalized['summary']}")
    if normalized["key_facts"]:
        lines.append("Key facts:")
        lines.extend([f"- {item}" for item in normalized["key_facts"][:8]])
    if normalized["user_preferences"]:
        lines.append("User preferences:")
        lines.extend([f"- {item}" for item in normalized["user_preferences"][:8]])
    if normalized["agent_notes"]:
        lines.append("Agent notes:")
        lines.extend([f"- {item}" for item in normalized["agent_notes"][:8]])
    if not lines:
        return ""
    return "Shared Memory:\n" + "\n".join(lines)


def _compose_system_prompt(system_prompt: Optional[str], memory: Dict[str, Any]) -> str:
    parts: List[str] = []
    if system_prompt and system_prompt.strip():
        parts.append(system_prompt.strip())
    memory_block = _memory_block(memory)
    if memory_block:
        parts.append(memory_block)
    return "\n\n".join(parts)


def _push_memory_note(memory: Dict[str, Any], text: str, *, field_name: str, max_items: int = 20) -> Dict[str, Any]:
    normalized = _normalize_session_memory(memory)
    note = text.strip()
    if not note:
        return normalized
    values = list(normalized.get(field_name) or [])
    if note in values:
        return normalized
    values.append(note)
    normalized[field_name] = values[-max_items:]
    return normalized


def _auto_memory_after_turn(
    memory: Dict[str, Any],
    *,
    user_message: Optional[str],
    responses: List[Dict[str, Any]],
) -> Dict[str, Any]:
    updated = _normalize_session_memory(memory)
    if user_message and user_message.strip():
        trimmed_user = user_message.strip()
        updated = _push_memory_note(updated, trimmed_user, field_name="key_facts")
        updated["summary"] = trimmed_user[:240]
    for response in responses[-4:]:
        speaker = str(response.get("speaker") or "assistant")
        content = str(response.get("content") or "").strip()
        if not content:
            continue
        updated = _push_memory_note(
            updated,
            f"{speaker}: {content[:240]}",
            field_name="agent_notes",
        )
    return updated


def _run_duet_turn(
    *,
    session_id: str,
    user_message: str,
    system_prompt: Optional[str],
    agents: List[BridgeAgentRequest],
) -> Dict[str, Any]:
    session_id = _require_valid_session_id(session_id)
    trimmed_message = user_message.strip()
    if not trimmed_message:
        raise ValueError("user_message must not be empty")
    if not agents:
        raise ValueError("at least one agent is required")

    state = shared_sessions.load(session_id)
    history = list(state.get("messages") or [])
    memory = _normalize_session_memory(state.get("memory"))
    history.append(
        {
            "role": "user",
            "speaker": "user",
            "content": trimmed_message,
            "timestamp": _timestamp(),
        }
    )

    responses: List[Dict[str, Any]] = []
    for agent in agents:
        agent_payload = {
            "messages": _to_llm_messages(history),
            "system": _compose_system_prompt(system_prompt, memory),
            "context": {
                "session_id": session_id,
                "agent_label": agent.label or agent.provider,
                "shared_memory": memory,
            },
            "profile_id": agent.profile_id,
            "options": {"temperature": 0.4},
        }
        result = router.send_message(agent.provider, agent.model, agent_payload)
        content = str(result.get("content") or "").strip()
        if not content:
            content = "[empty response]"

        response_message = {
            "role": "assistant",
            "speaker": agent.label or f"{agent.provider}:{agent.model}",
            "provider": agent.provider,
            "model": agent.model,
            "content": content,
            "meta": result.get("meta") or {},
            "timestamp": _timestamp(),
        }
        history.append(response_message)
        responses.append(response_message)
        _record_agent_telemetry(
            session_id=session_id,
            route="turn",
            provider=agent.provider,
            model=agent.model,
            label=agent.label or agent.provider,
            meta=response_message["meta"] if isinstance(response_message.get("meta"), dict) else {},
        )

    updated_memory = _auto_memory_after_turn(memory, user_message=trimmed_message, responses=responses)
    saved = shared_sessions.save(session_id, history, memory=updated_memory)
    return {"session": saved, "responses": responses}


def _run_duet_turn_stream(
    *,
    session_id: str,
    user_message: str,
    system_prompt: Optional[str],
    agents: List[BridgeAgentRequest],
):
    session_id = _require_valid_session_id(session_id)
    trimmed_message = user_message.strip()
    if not trimmed_message:
        raise ValueError("user_message must not be empty")
    if not agents:
        raise ValueError("at least one agent is required")

    state = shared_sessions.load(session_id)
    history = list(state.get("messages") or [])
    memory = _normalize_session_memory(state.get("memory"))
    user_item = {
        "role": "user",
        "speaker": "user",
        "content": trimmed_message,
        "timestamp": _timestamp(),
    }
    history.append(user_item)
    yield _sse("status", {"message": "running", "session_id": session_id})

    responses: List[Dict[str, Any]] = []
    for index, agent in enumerate(agents):
        yield _sse(
            "status",
            {
                "message": "agent_start",
                "agent_index": index,
                "agent": {"provider": agent.provider, "model": agent.model, "label": agent.label or agent.provider},
            },
        )
        agent_payload = {
            "messages": _to_llm_messages(history),
            "system": _compose_system_prompt(system_prompt, memory),
            "context": {
                "session_id": session_id,
                "agent_label": agent.label or agent.provider,
                "shared_memory": memory,
            },
            "profile_id": agent.profile_id,
            "options": {"temperature": 0.4},
        }
        result = router.send_message(agent.provider, agent.model, agent_payload)
        content = str(result.get("content") or "").strip() or "[empty response]"
        response_message = {
            "role": "assistant",
            "speaker": agent.label or f"{agent.provider}:{agent.model}",
            "provider": agent.provider,
            "model": agent.model,
            "content": content,
            "meta": result.get("meta") or {},
            "timestamp": _timestamp(),
        }
        history.append(response_message)
        responses.append(response_message)
        _record_agent_telemetry(
            session_id=session_id,
            route="turn_stream",
            provider=agent.provider,
            model=agent.model,
            label=agent.label or agent.provider,
            meta=response_message["meta"] if isinstance(response_message.get("meta"), dict) else {},
        )
        yield _sse("agent", {"agent_index": index, "message": response_message})

    updated_memory = _auto_memory_after_turn(memory, user_message=trimmed_message, responses=responses)
    saved = shared_sessions.save(session_id, history, memory=updated_memory)
    yield _sse("session", {"session": saved, "responses": responses})
    yield _sse("done", {"ok": True})


def _run_agentic_conversation(
    *,
    session_id: str,
    seed_user_message: Optional[str],
    system_prompt: Optional[str],
    agents: List[BridgeAgentRequest],
    rounds: int,
) -> Dict[str, Any]:
    session_id = _require_valid_session_id(session_id)
    if rounds < 1:
        raise ValueError("rounds must be >= 1")
    if not agents:
        raise ValueError("at least one agent is required")

    state = shared_sessions.load(session_id)
    history = list(state.get("messages") or [])
    memory = _normalize_session_memory(state.get("memory"))
    cleaned_seed = (seed_user_message or "").strip()
    if cleaned_seed:
        history.append(
            {
                "role": "user",
                "speaker": "user",
                "content": cleaned_seed,
                "timestamp": _timestamp(),
            }
        )
    if not history:
        raise ValueError("conversation is empty; provide seed_user_message to start")

    responses: List[Dict[str, Any]] = []
    for round_index in range(rounds):
        for agent in agents:
            agent_payload = {
                "messages": _to_llm_messages(history),
                "system": _compose_system_prompt(system_prompt, memory),
                "context": {
                    "session_id": session_id,
                    "agent_label": agent.label or agent.provider,
                    "round": round_index + 1,
                    "shared_memory": memory,
                },
                "profile_id": agent.profile_id,
                "options": {"temperature": 0.4},
            }
            result = router.send_message(agent.provider, agent.model, agent_payload)
            content = str(result.get("content") or "").strip()
            if not content:
                content = "[empty response]"
            response_message = {
                "role": "assistant",
                "speaker": agent.label or f"{agent.provider}:{agent.model}",
                "provider": agent.provider,
                "model": agent.model,
                "content": content,
                "meta": {
                    **(result.get("meta") or {}),
                    "round": round_index + 1,
                },
                "timestamp": _timestamp(),
            }
            history.append(response_message)
            responses.append(response_message)
            _record_agent_telemetry(
                session_id=session_id,
                route="converse",
                provider=agent.provider,
                model=agent.model,
                label=agent.label or agent.provider,
                meta=response_message["meta"] if isinstance(response_message.get("meta"), dict) else {},
                round_index=round_index + 1,
            )

    updated_memory = _auto_memory_after_turn(memory, user_message=cleaned_seed or None, responses=responses)
    saved = shared_sessions.save(session_id, history, memory=updated_memory)
    return {
        "session": saved,
        "responses": responses,
        "rounds": rounds,
        "turns": len(responses),
    }


def _truncate_last_user_turn(session_id: str) -> Dict[str, Any]:
    session_id = _require_valid_session_id(session_id)
    state = shared_sessions.load(session_id)
    history = list(state.get("messages") or [])
    last_user_index = -1
    for index in range(len(history) - 1, -1, -1):
        if str(history[index].get("role")) == "user":
            last_user_index = index
            break
    if last_user_index == -1:
        return state
    return shared_sessions.save(session_id, history[:last_user_index])


def _session_events(session_id: str) -> List[Dict[str, Any]]:
    session_id = _require_valid_session_id(session_id)
    state = shared_sessions.load(session_id)
    history = list(state.get("messages") or [])
    workspace_dir = _workspace_path_for_session(session_id)
    events: List[Dict[str, Any]] = [
        {
            "id": f"{session_id}:workspace",
            "event_type": "workspace_info",
            "event_payload": {"type": "workspace_info", "content": {"path": workspace_dir}},
            "timestamp": state.get("updated_at") or _timestamp(),
            "workspace_dir": workspace_dir,
        },
        {
            "id": f"{session_id}:agent_initialized",
            "event_type": "agent_initialized",
            "event_payload": {"type": "agent_initialized", "content": {"vscode_url": ""}},
            "timestamp": state.get("updated_at") or _timestamp(),
            "workspace_dir": workspace_dir,
        },
    ]

    counter = 0
    for message in history:
        counter += 1
        role = str(message.get("role") or "")
        timestamp = str(message.get("timestamp") or state.get("updated_at") or _timestamp())
        if role == "user":
            events.append(
                {
                    "id": f"{session_id}:user:{counter}",
                    "event_type": "user_message",
                    "event_payload": {"type": "user_message", "content": {"text": str(message.get("content") or "")}},
                    "timestamp": timestamp,
                    "workspace_dir": workspace_dir,
                }
            )
        elif role == "assistant":
            events.append(
                {
                    "id": f"{session_id}:assistant:{counter}",
                    "event_type": "agent_thinking",
                    "event_payload": {"type": "agent_thinking", "content": {"text": str(message.get("content") or "")}},
                    "timestamp": timestamp,
                    "workspace_dir": workspace_dir,
                }
            )

    if history:
        events.append(
            {
                "id": f"{session_id}:complete",
                "event_type": "agent_response",
                "event_payload": {"type": "agent_response", "content": {"text": "complete"}},
                "timestamp": state.get("updated_at") or _timestamp(),
                "workspace_dir": workspace_dir,
            }
        )
    return events


def _serialize_persona(persona: Any) -> Dict[str, Any]:
    return {
        "id": str(getattr(persona, "id", "")),
        "name": str(getattr(persona, "name", "")),
        "role": str(getattr(getattr(persona, "role", ""), "value", getattr(persona, "role", ""))),
        "description": str(getattr(persona, "description", "")),
        "communication_style": str(getattr(persona, "communication_style", "")),
        "expertise_areas": list(getattr(persona, "expertise_areas", []) or []),
        "voice_id": getattr(persona, "voice_id", None),
        "avatar_color": getattr(persona, "avatar_color", None),
        "priority": float(getattr(persona, "priority", 1.0)),
    }


def _append_research_message(
    *,
    session_id: str,
    source: str,
    mode: Optional[str],
    title: Optional[str],
    summary: Optional[str],
    findings: List[str],
    artifacts: List[Dict[str, Any]],
    raw: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    session_id = _require_valid_session_id(session_id)
    state = shared_sessions.load(session_id)
    history = list(state.get("messages") or [])
    lines: List[str] = []
    header = title.strip() if isinstance(title, str) and title.strip() else "Research Handoff"
    lines.append(f"# {header}")
    if summary and summary.strip():
        lines.append(summary.strip())
    clean_findings = [item.strip() for item in findings if isinstance(item, str) and item.strip()]
    if clean_findings:
        lines.append("## Findings")
        lines.extend([f"- {item}" for item in clean_findings])
    if artifacts:
        lines.append("## Artifacts")
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                continue
            label = str(artifact.get("label") or artifact.get("name") or "artifact")
            url = str(artifact.get("url") or "").strip()
            lines.append(f"- {label}: {url}" if url else f"- {label}")

    message = {
        "role": "assistant",
        "speaker": "Research",
        "provider": "research-app",
        "model": mode or "external",
        "content": "\n\n".join(part for part in lines if part),
        "meta": {
            "type": "research_ingest",
            "source": source,
            "mode": mode,
            "artifact_count": len(artifacts),
            "raw": raw or {},
        },
        "timestamp": _timestamp(),
    }
    history.append(message)
    saved = shared_sessions.save(session_id, history)
    return {"session": saved, "message": message}


def _handoff_path(handoff_id: str) -> Path:
    return _RESEARCH_HANDOFF_ROOT / f"{handoff_id}.json"


def _create_research_handoff(payload: ResearchHandoffCreateRequest) -> Dict[str, Any]:
    safe_session_id = _require_valid_session_id(payload.session_id)
    session = shared_sessions.load(safe_session_id)
    history = list(session.get("messages") or [])
    memory = _normalize_session_memory(session.get("memory"))
    recent = history[-payload.include_recent_messages :] if payload.include_recent_messages else []
    inferred_query = payload.query or ""
    if not inferred_query:
        for item in reversed(history):
            if str(item.get("role") or "") == "user":
                inferred_query = str(item.get("content") or "")
                break
    handoff_id = str(uuid.uuid4())
    handoff_payload = {
        "handoff_id": handoff_id,
        "session_id": safe_session_id,
        "mode": payload.mode or "hybrid",
        "query": inferred_query,
        "created_at": _timestamp(),
        "scribe_api_url": "http://localhost:8000",
        "history": recent,
        "memory": memory,
        "recommended_agents": [agent.model_dump() for agent in _default_bridge_agents()],
    }
    _RESEARCH_HANDOFF_ROOT.mkdir(parents=True, exist_ok=True)
    _handoff_path(handoff_id).write_text(
        json.dumps(handoff_payload, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )
    return handoff_payload


async def _ws_send(websocket: WebSocket, event_type: str, content: Dict[str, Any]) -> None:
    await websocket.send_text(json.dumps({"type": event_type, "content": content}, ensure_ascii=True))


def _enhance_prompt_text(source_text: str) -> str:
    request_payload = {
        "messages": [{"role": "user", "content": source_text}],
        "system": "Rewrite prompts to be clear, specific, and execution-ready without changing intent.",
        "context": {"workflow": "enhance_prompt"},
        "profile_id": "openai:default",
        "options": {"temperature": 0.2},
    }
    result = router.send_message("openai", DEFAULT_OPENAI_MODEL, request_payload)
    output = str(result.get("content") or "").strip()
    return output or source_text


@app.get("/api/models")
def list_models() -> dict[str, dict[str, list[str]]]:
    """Return available models grouped by provider."""

    _ = router
    return {"models": _DEFAULT_MODELS}


@app.get("/api/provider-profiles")
def list_provider_profiles() -> dict[str, list[dict[str, Any]]]:
    """Return provider profiles (redacted)."""

    return {"profiles": profiles_store.list_profiles(redact=True)}


@app.put("/api/provider-profiles/{profile_id}")
def upsert_provider_profile(profile_id: str, update: ProviderProfileUpdate) -> dict[str, Any]:
    """Create or update a provider profile."""

    profile = profiles_store.upsert(profile_id, update)
    return {"profile": profile.redacted()}


@app.get("/api/personas")
def list_personas() -> dict[str, Any]:
    """Return available personas with effective voice assignments."""

    personas = get_personas_with_voice_overrides(path=_PERSONA_VOICE_OVERRIDES_PATH)
    serialized = [_serialize_persona(persona) for persona in personas.values()]
    serialized.sort(key=lambda item: item["id"])
    return {
        "personas": serialized,
        "voice_overrides": load_persona_voice_overrides(path=_PERSONA_VOICE_OVERRIDES_PATH),
    }


@app.get("/api/voices")
def list_voices() -> dict[str, Any]:
    """Return default voice catalog and persona mappings."""

    personas = get_personas_with_voice_overrides(path=_PERSONA_VOICE_OVERRIDES_PATH)
    assignments = {persona_id: persona.voice_id for persona_id, persona in personas.items()}
    return {
        "voices": list_voice_catalog(),
        "assignments": assignments,
    }


@app.put("/api/personas/{persona_id}/voice")
def update_persona_voice(persona_id: str, payload: PersonaVoiceUpdate) -> dict[str, Any]:
    """Update persisted voice assignment for a persona."""

    defaults = get_default_personas()
    if persona_id not in defaults:
        raise HTTPException(status_code=404, detail=f"Unknown persona '{persona_id}'")

    overrides = load_persona_voice_overrides(path=_PERSONA_VOICE_OVERRIDES_PATH)
    voice_id = (payload.voice_id or "").strip()
    if voice_id:
        overrides[persona_id] = voice_id
    else:
        overrides.pop(persona_id, None)
    save_persona_voice_overrides(overrides, path=_PERSONA_VOICE_OVERRIDES_PATH)

    updated = get_personas_with_voice_overrides(path=_PERSONA_VOICE_OVERRIDES_PATH)
    return {"persona": _serialize_persona(updated[persona_id]), "voice_overrides": overrides}


@app.get("/api/sessions/{session_id}")
def get_shared_session(session_id: str) -> dict[str, Any]:
    """Fetch shared state for a duet session."""

    try:
        safe_session_id = _require_valid_session_id(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return shared_sessions.load(safe_session_id)


@app.get("/api/sessions/{session_id}/memory")
def get_session_memory(session_id: str) -> dict[str, Any]:
    """Fetch durable shared memory for a session."""

    try:
        safe_session_id = _require_valid_session_id(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    state = shared_sessions.load(safe_session_id)
    return {
        "session_id": safe_session_id,
        "memory": _normalize_session_memory(state.get("memory")),
    }


@app.put("/api/sessions/{session_id}/memory")
def update_session_memory(session_id: str, payload: SessionMemoryUpdate) -> dict[str, Any]:
    """Update durable shared memory for a session."""

    try:
        safe_session_id = _require_valid_session_id(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    updated = shared_sessions.update_memory(
        safe_session_id,
        summary=payload.summary,
        key_facts=payload.key_facts,
        user_preferences=payload.user_preferences,
        agent_notes=payload.agent_notes,
        merge=payload.merge,
    )
    return {
        "session_id": safe_session_id,
        "memory": _normalize_session_memory(updated.get("memory")),
    }


@app.get("/api/sessions/{session_id}/events")
def get_shared_session_events(session_id: str) -> dict[str, Any]:
    """Build replay events from shared duet state for legacy UI playback."""

    try:
        safe_session_id = _require_valid_session_id(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"events": _session_events(safe_session_id)}


@app.get("/api/telemetry/recent")
def get_recent_telemetry(limit: int = 50, session_id: Optional[str] = None) -> dict[str, Any]:
    """Return recent runtime telemetry for diagnostics."""

    safe_limit = max(1, min(500, int(limit)))
    events = list(_telemetry_events)
    if session_id:
        try:
            safe_session_id = _require_valid_session_id(session_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        events = [event for event in events if str(event.get("session_id") or "") == safe_session_id]
    return {"events": events[-safe_limit:]}


@app.post("/api/research/handoff")
def create_research_handoff(payload: ResearchHandoffCreateRequest) -> dict[str, Any]:
    """Create a portable research handoff packet from current SCRIBE state."""

    try:
        handoff_payload = _create_research_handoff(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"handoff": handoff_payload}


@app.get("/api/research/handoff/{handoff_id}")
def get_research_handoff(handoff_id: str) -> dict[str, Any]:
    """Fetch a previously created research handoff payload."""

    path = _handoff_path(handoff_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="handoff not found")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"failed to read handoff: {exc}") from exc
    return {"handoff": payload}


@app.post("/api/research/ingest")
def ingest_research_result(payload: ResearchIngestRequest) -> dict[str, Any]:
    """Ingest external research output into the shared SCRIBE transcript."""

    has_summary = bool(payload.summary and payload.summary.strip())
    has_findings = any(isinstance(item, str) and item.strip() for item in payload.findings)
    has_artifacts = bool(payload.artifacts)
    if not (has_summary or has_findings or has_artifacts):
        raise HTTPException(status_code=400, detail="Provide summary, findings, or artifacts")

    try:
        return _append_research_message(
            session_id=payload.session_id,
            source=payload.source,
            mode=payload.mode,
            title=payload.title,
            summary=payload.summary,
            findings=payload.findings,
            artifacts=payload.artifacts,
            raw=payload.raw,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/duet/turn")
def duet_turn(payload: DuetTurnRequest) -> dict[str, Any]:
    """Run one shared-state turn across multiple subscription-backed agents."""

    try:
        return _run_duet_turn(
            session_id=payload.session_id,
            user_message=payload.user_message,
            system_prompt=payload.system_prompt,
            agents=payload.agents,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/duet/turn/stream")
def duet_turn_stream(payload: DuetTurnRequest) -> StreamingResponse:
    """Run one shared-state turn and stream agent outputs as SSE events."""

    def event_source():
        try:
            yield from _run_duet_turn_stream(
                session_id=payload.session_id,
                user_message=payload.user_message,
                system_prompt=payload.system_prompt,
                agents=payload.agents,
            )
        except ValueError as exc:
            yield _sse("error", {"detail": str(exc)})
        except Exception as exc:  # pragma: no cover - defensive streaming fallback
            yield _sse("error", {"detail": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/duet/converse")
def duet_converse(payload: DuetConverseRequest) -> dict[str, Any]:
    """Run multi-round agent-to-agent conversation on shared state."""

    try:
        return _run_agentic_conversation(
            session_id=payload.session_id,
            seed_user_message=payload.seed_user_message,
            system_prompt=payload.system_prompt,
            agents=payload.agents,
            rounds=payload.rounds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.websocket("/ws")
async def websocket_bridge(websocket: WebSocket) -> None:
    """Compatibility WebSocket endpoint mapped to duet shared-state execution."""

    await websocket.accept()
    query_params = websocket.query_params
    session_id_raw = (
        query_params.get("session_uuid")
        or query_params.get("id")
        or query_params.get("session_id")
        or f"session-{uuid.uuid4()}"
    )
    try:
        session_id = _require_valid_session_id(session_id_raw)
    except ValueError:
        await _ws_send(websocket, "error", {"message": "invalid session_id"})
        await websocket.close(code=1008)
        return
    workspace_path = _workspace_path_for_session(session_id)
    current_system_prompt = ""
    current_agents = _default_bridge_agents()

    try:
        while True:
            raw_message = await websocket.receive_text()
            try:
                payload = json.loads(raw_message)
            except json.JSONDecodeError:
                await _ws_send(websocket, "system", {"message": "Invalid JSON payload"})
                continue

            message_type = str(payload.get("type") or "").strip()
            content = payload.get("content") or {}
            if not isinstance(content, dict):
                content = {}

            if message_type == "workspace_info":
                await _ws_send(websocket, "workspace_info", {"path": workspace_path})
                continue

            if message_type == "init_agent":
                model_name = content.get("model_name")
                if isinstance(model_name, str) and model_name.strip():
                    current_agents = _model_hint_to_agents(model_name)
                raw_agents = content.get("agents")
                current_agents = _coerce_agents(raw_agents, current_agents)
                system_prompt = content.get("system_prompt")
                if isinstance(system_prompt, str):
                    current_system_prompt = system_prompt
                await _ws_send(websocket, "agent_initialized", {"vscode_url": ""})
                continue

            if message_type in {"query", "edit_query", "review_result"}:
                text = str(content.get("text") or "").strip()
                if message_type == "review_result":
                    user_input = str(content.get("user_input") or "").strip()
                    text = (
                        "Review and improve the prior answer. "
                        f"Original request: {user_input or '[missing original request]'}"
                    )
                if not text:
                    await _ws_send(websocket, "error", {"message": "Query text must not be empty"})
                    await _ws_send(websocket, "agent_response", {"text": ""})
                    continue

                if message_type == "edit_query":
                    await asyncio.to_thread(_truncate_last_user_turn, session_id)

                system_prompt = content.get("system_prompt")
                if isinstance(system_prompt, str):
                    current_system_prompt = system_prompt
                raw_agents = content.get("agents")
                agents = _coerce_agents(raw_agents, current_agents)
                rounds_value = content.get("agentic_rounds")
                requested_rounds = 1
                if isinstance(rounds_value, int):
                    requested_rounds = max(1, min(12, rounds_value))

                await _ws_send(websocket, "processing", {"message": "Running shared duet turn..."})
                try:
                    if requested_rounds > 1:
                        result = await asyncio.to_thread(
                            _run_agentic_conversation,
                            session_id=session_id,
                            seed_user_message=text,
                            system_prompt=current_system_prompt,
                            agents=agents,
                            rounds=requested_rounds,
                        )
                    else:
                        result = await asyncio.to_thread(
                            _run_duet_turn,
                            session_id=session_id,
                            user_message=text,
                            system_prompt=current_system_prompt,
                            agents=agents,
                        )
                except Exception as exc:  # pragma: no cover - defensive path
                    await _ws_send(websocket, "error", {"message": str(exc)})
                    await _ws_send(websocket, "agent_response", {"text": ""})
                    continue

                responses = result.get("responses") or []
                for response in responses:
                    speaker = str(response.get("speaker") or "assistant")
                    output = str(response.get("content") or "")
                    await _ws_send(websocket, "agent_thinking", {"text": f"[{speaker}] {output}"})
                last_text = str(responses[-1].get("content") or "") if responses else ""
                await _ws_send(websocket, "agent_response", {"text": last_text})
                continue

            if message_type == "agentic_loop":
                text = str(content.get("text") or "").strip()
                rounds = content.get("rounds")
                if not isinstance(rounds, int):
                    rounds = 2
                rounds = max(1, min(12, rounds))
                system_prompt = content.get("system_prompt")
                if isinstance(system_prompt, str):
                    current_system_prompt = system_prompt
                raw_agents = content.get("agents")
                agents = _coerce_agents(raw_agents, current_agents)

                await _ws_send(websocket, "processing", {"message": f"Running agentic loop ({rounds} rounds)..."})
                try:
                    result = await asyncio.to_thread(
                        _run_agentic_conversation,
                        session_id=session_id,
                        seed_user_message=text or None,
                        system_prompt=current_system_prompt,
                        agents=agents,
                        rounds=rounds,
                    )
                except Exception as exc:  # pragma: no cover - defensive path
                    await _ws_send(websocket, "error", {"message": str(exc)})
                    await _ws_send(websocket, "agent_response", {"text": ""})
                    continue

                responses = result.get("responses") or []
                for response in responses:
                    speaker = str(response.get("speaker") or "assistant")
                    output = str(response.get("content") or "")
                    await _ws_send(websocket, "agent_thinking", {"text": f"[{speaker}] {output}"})
                last_text = str(responses[-1].get("content") or "") if responses else ""
                await _ws_send(websocket, "agent_response", {"text": last_text})
                continue

            if message_type == "enhance_prompt":
                source_text = str(content.get("text") or "").strip()
                if not source_text:
                    await _ws_send(websocket, "prompt_generated", {"result": ""})
                    continue
                enhanced = source_text
                try:
                    enhanced = await asyncio.to_thread(_enhance_prompt_text, source_text)
                except Exception:
                    enhanced = source_text
                await _ws_send(websocket, "prompt_generated", {"result": enhanced})
                continue

            if message_type == "cancel":
                await _ws_send(websocket, "system", {"message": "Cancel requested. No active cancellable task."})
                await _ws_send(websocket, "agent_response", {"text": ""})
                continue

            await _ws_send(
                websocket,
                "system",
                {"message": f"Unsupported websocket message type: {message_type or '[missing type]'}"},
            )
    except WebSocketDisconnect:
        return
