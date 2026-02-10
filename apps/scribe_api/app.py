"""FastAPI app exposing SCRIBE runtime and shared-state duet endpoints."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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

_DEFAULT_MODELS = {
    "anthropic": [
        "claude-opus-4-1-20250805",
        "claude-sonnet-4-5",
        "claude-3-7-sonnet-20250219",
    ],
    "openai": [
        "gpt-5",
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
                model="gpt-5",
                profile_id="openai:default",
                label="Codex",
            ),
            BridgeAgentRequest(
                provider="anthropic",
                model="claude-sonnet-4-5",
                profile_id="anthropic:default",
                label="Claude",
            ),
        ]
    )


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _workspace_path_for_session(session_id: str) -> str:
    return str((Path.cwd() / "data" / "workspaces" / session_id).resolve())


def _default_bridge_agents() -> List[BridgeAgentRequest]:
    return [
        BridgeAgentRequest(
            provider="openai",
            model="gpt-5",
            profile_id="openai:default",
            label="Codex",
        ),
        BridgeAgentRequest(
            provider="anthropic",
            model="claude-sonnet-4-5",
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
    if "claude" in lowered:
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
        if role not in {"user", "assistant"}:
            role = "user"
        if role == "assistant":
            content = f"[{speaker}] {content}"
        llm_messages.append({"role": role, "content": content})
    return llm_messages


def _run_duet_turn(
    *,
    session_id: str,
    user_message: str,
    system_prompt: Optional[str],
    agents: List[BridgeAgentRequest],
) -> Dict[str, Any]:
    trimmed_message = user_message.strip()
    if not trimmed_message:
        raise ValueError("user_message must not be empty")
    if not agents:
        raise ValueError("at least one agent is required")

    state = shared_sessions.load(session_id)
    history = list(state.get("messages") or [])
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
            "system": system_prompt or "",
            "context": {"session_id": session_id, "agent_label": agent.label or agent.provider},
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

    saved = shared_sessions.save(session_id, history)
    return {"session": saved, "responses": responses}


def _truncate_last_user_turn(session_id: str) -> Dict[str, Any]:
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
    result = router.send_message("openai", "gpt-5", request_payload)
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


@app.get("/api/sessions/{session_id}")
def get_shared_session(session_id: str) -> dict[str, Any]:
    """Fetch shared state for a duet session."""

    return shared_sessions.load(session_id)


@app.get("/api/sessions/{session_id}/events")
def get_shared_session_events(session_id: str) -> dict[str, Any]:
    """Build replay events from shared duet state for legacy UI playback."""

    return {"events": _session_events(session_id)}


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


@app.websocket("/ws")
async def websocket_bridge(websocket: WebSocket) -> None:
    """Compatibility WebSocket endpoint mapped to duet shared-state execution."""

    await websocket.accept()
    query_params = websocket.query_params
    session_id = (
        query_params.get("session_uuid")
        or query_params.get("id")
        or query_params.get("session_id")
        or f"session-{uuid.uuid4()}"
    )
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

                await _ws_send(websocket, "processing", {"message": "Running shared duet turn..."})
                try:
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
