from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

import apps.scribe_api.app as scribe_api_app
from scribe_core.shared_state import SharedSessionStore


class StubRouter:
    def send_message(self, provider: str, model: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        messages = payload.get("messages") or []
        last_content = ""
        if messages and isinstance(messages[-1], dict):
            last_content = str(messages[-1].get("content") or "")
        return {
            "content": f"{provider}:{model}:{last_content}",
            "meta": {"stub": True},
        }


def parse_sse_events(raw_stream_text: str) -> list[Dict[str, Any]]:
    events: list[Dict[str, Any]] = []
    for block in raw_stream_text.split("\n\n"):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        event_type = "message"
        data: Dict[str, Any] = {}
        for line in lines:
            if line.startswith("event:"):
                event_type = line.split(":", 1)[1].strip() or "message"
            elif line.startswith("data:"):
                payload = line.split(":", 1)[1].strip()
                if payload:
                    data = json.loads(payload)
        events.append({"event": event_type, "data": data})
    return events


@pytest.fixture
def api_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(scribe_api_app, "shared_sessions", SharedSessionStore(root=tmp_path / "shared_sessions"))
    monkeypatch.setattr(scribe_api_app, "router", StubRouter())
    monkeypatch.setattr(
        scribe_api_app,
        "_PERSONA_VOICE_OVERRIDES_PATH",
        tmp_path / "persona_voice_overrides.json",
    )
    monkeypatch.setattr(
        scribe_api_app,
        "_RESEARCH_HANDOFF_ROOT",
        tmp_path / "research_handoffs",
    )
    monkeypatch.setattr(
        scribe_api_app,
        "_telemetry_events",
        deque(maxlen=scribe_api_app._TELEMETRY_MAX_EVENTS),
    )
    return TestClient(scribe_api_app.app)


def test_duet_turn_persists_shared_state(api_client: TestClient) -> None:
    response = api_client.post(
        "/api/duet/turn",
        json={
            "session_id": "session-a",
            "user_message": "Plan a private workflow",
            "agents": [
                {"provider": "openai", "model": "gpt-5", "profile_id": "openai:default", "label": "Codex"},
                {
                    "provider": "anthropic",
                    "model": "claude-sonnet-4-5",
                    "profile_id": "anthropic:default",
                    "label": "Claude",
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["responses"]) == 2
    assert payload["session"]["session_id"] == "session-a"
    assert len(payload["session"]["messages"]) == 3
    assert payload["session"]["messages"][0]["role"] == "user"
    assert payload["session"]["messages"][1]["role"] == "assistant"
    assert payload["session"]["messages"][2]["role"] == "assistant"
    assert "memory" in payload["session"]


def test_session_events_replay_shape(api_client: TestClient) -> None:
    api_client.post(
        "/api/duet/turn",
        json={
            "session_id": "session-b",
            "user_message": "Summarize this repo",
            "agents": [{"provider": "openai", "model": "gpt-5", "profile_id": "openai:default", "label": "Codex"}],
        },
    )

    response = api_client.get("/api/sessions/session-b/events")
    assert response.status_code == 200
    events = response.json()["events"]

    assert events[0]["event_type"] == "workspace_info"
    assert events[1]["event_type"] == "agent_initialized"
    assert any(event["event_type"] == "user_message" for event in events)
    assert any(event["event_type"] == "agent_thinking" for event in events)
    assert events[-1]["event_type"] == "agent_response"


def test_websocket_query_flow_matches_frontend_contract(api_client: TestClient) -> None:
    with api_client.websocket_connect("/ws?session_uuid=session-ws&device_id=device-1") as websocket:
        websocket.send_json({"type": "workspace_info", "content": {}})
        workspace_info = websocket.receive_json()
        assert workspace_info["type"] == "workspace_info"
        assert "path" in workspace_info["content"]

        websocket.send_json({"type": "init_agent", "content": {"model_name": "anthropic/claude-sonnet-4-5"}})
        initialized = websocket.receive_json()
        assert initialized["type"] == "agent_initialized"

        websocket.send_json({"type": "query", "content": {"text": "Create a secure local-only plan"}})
        processing = websocket.receive_json()
        first_thinking = websocket.receive_json()
        second_thinking = websocket.receive_json()
        completed = websocket.receive_json()

        assert processing["type"] == "processing"
        assert first_thinking["type"] == "agent_thinking"
        assert second_thinking["type"] == "agent_thinking"
        assert completed["type"] == "agent_response"


def test_research_handoff_and_ingest_flow(api_client: TestClient) -> None:
    api_client.post(
        "/api/duet/turn",
        json={
            "session_id": "session-research",
            "user_message": "Find prior work on hypothesis ranking methods",
            "agents": [{"provider": "openai", "model": "gpt-5", "profile_id": "openai:default", "label": "Codex"}],
        },
    )

    handoff_response = api_client.post(
        "/api/research/handoff",
        json={
            "session_id": "session-research",
            "mode": "hybrid",
            "include_recent_messages": 4,
        },
    )
    assert handoff_response.status_code == 200
    handoff = handoff_response.json()["handoff"]
    assert handoff["session_id"] == "session-research"
    assert handoff["handoff_id"]
    assert handoff["history"]

    fetch_response = api_client.get(f"/api/research/handoff/{handoff['handoff_id']}")
    assert fetch_response.status_code == 200
    assert fetch_response.json()["handoff"]["handoff_id"] == handoff["handoff_id"]

    ingest_response = api_client.post(
        "/api/research/ingest",
        json={
            "session_id": "session-research",
            "source": "research-app",
            "mode": "hybrid",
            "title": "Hypothesis ranking literature",
            "summary": "Collected related papers and scoring approaches.",
            "findings": ["Elo variants work well for pairwise hypothesis judgments."],
            "artifacts": [{"label": "paper-list", "url": "https://example.org/papers"}],
        },
    )
    assert ingest_response.status_code == 200
    session_messages = ingest_response.json()["session"]["messages"]
    assert session_messages[-1]["speaker"] == "Research"
    assert "Hypothesis ranking literature" in session_messages[-1]["content"]


def test_persona_and_voice_endpoints(api_client: TestClient) -> None:
    personas_response = api_client.get("/api/personas")
    assert personas_response.status_code == 200
    personas = personas_response.json()["personas"]
    assert personas
    persona_ids = {item["id"] for item in personas}
    assert "researcher" in persona_ids

    voices_response = api_client.get("/api/voices")
    assert voices_response.status_code == 200
    voices = voices_response.json()["voices"]
    assert "alloy" in voices

    update_response = api_client.put(
        "/api/personas/researcher/voice",
        json={"voice_id": "nova"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["persona"]["voice_id"] == "nova"


def test_session_memory_endpoints(api_client: TestClient) -> None:
    update_response = api_client.put(
        "/api/sessions/session-memory/memory",
        json={
            "summary": "Working on trio orchestration.",
            "key_facts": ["User wants GPT and Claude to converse directly."],
            "user_preferences": ["Keep it practical and app-first."],
            "agent_notes": ["Codex should verify every loop write to shared state."],
            "merge": False,
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["memory"]["summary"] == "Working on trio orchestration."

    get_response = api_client.get("/api/sessions/session-memory/memory")
    assert get_response.status_code == 200
    memory = get_response.json()["memory"]
    assert "GPT and Claude" in memory["key_facts"][0]


def test_duet_converse_runs_multi_round_agentic_loop(api_client: TestClient) -> None:
    response = api_client.post(
        "/api/duet/converse",
        json={
            "session_id": "session-loop",
            "seed_user_message": "Debate two options and converge.",
            "rounds": 2,
            "agents": [
                {"provider": "openai", "model": "gpt-5", "profile_id": "openai:default", "label": "Codex"},
                {
                    "provider": "anthropic",
                    "model": "claude-sonnet-4-5",
                    "profile_id": "anthropic:default",
                    "label": "Claude",
                },
            ],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["rounds"] == 2
    assert payload["turns"] == 4
    assert len(payload["responses"]) == 4
    assert payload["session"]["messages"][0]["role"] == "user"
    assert payload["session"]["memory"]["summary"]


def test_duet_turn_stream_emits_agent_and_session_events(api_client: TestClient) -> None:
    response = api_client.post(
        "/api/duet/turn/stream",
        json={
            "session_id": "stream-session",
            "user_message": "stream this turn",
            "agents": [
                {"provider": "openai", "model": "gpt-5", "profile_id": "openai:default", "label": "Codex"},
                {"provider": "anthropic", "model": "opus", "profile_id": "anthropic:default", "label": "Claude"},
            ],
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse_sse_events(response.text)
    event_types = [item["event"] for item in events]
    assert "status" in event_types
    assert "agent" in event_types
    assert "session" in event_types
    assert "done" in event_types

    session_event = next(item for item in events if item["event"] == "session")
    session_payload = session_event["data"]["session"]
    assert session_payload["session_id"] == "stream-session"
    assert len(session_payload["messages"]) == 3
    assert session_payload["messages"][0]["role"] == "user"


def test_invalid_session_id_rejected_across_endpoints(api_client: TestClient) -> None:
    turn_response = api_client.post(
        "/api/duet/turn",
        json={
            "session_id": "bad id",
            "user_message": "hello",
            "agents": [{"provider": "openai", "model": "gpt-5", "profile_id": "openai:default", "label": "Codex"}],
        },
    )
    assert turn_response.status_code == 400
    assert "invalid session_id" in turn_response.json()["detail"]

    memory_response = api_client.get("/api/sessions/bad%20id/memory")
    assert memory_response.status_code == 400
    assert "invalid session_id" in memory_response.json()["detail"]

    telemetry_response = api_client.get("/api/telemetry/recent?session_id=bad%20id")
    assert telemetry_response.status_code == 400
    assert "invalid session_id" in telemetry_response.json()["detail"]


def test_degraded_metadata_surfaces_in_session_and_telemetry(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    class DegradedRouter:
        def send_message(self, provider: str, model: str, payload: Dict[str, Any]) -> Dict[str, Any]:
            return {
                "content": f"degraded-{provider}:{model}",
                "meta": {
                    "degraded": True,
                    "retries": 1,
                    "latency_ms": 123,
                    "warnings": ["mock fallback"],
                    "error": "simulated provider failure",
                },
            }

    monkeypatch.setattr(scribe_api_app, "router", DegradedRouter())
    response = api_client.post(
        "/api/duet/turn",
        json={
            "session_id": "degraded-session",
            "user_message": "test degraded metadata",
            "agents": [{"provider": "openai", "model": "gpt-5", "profile_id": "openai:default", "label": "Codex"}],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assistant_message = payload["session"]["messages"][-1]
    assert assistant_message["meta"]["degraded"] is True
    assert assistant_message["meta"]["retries"] == 1
    assert assistant_message["meta"]["warnings"] == ["mock fallback"]

    telemetry_response = api_client.get("/api/telemetry/recent?session_id=degraded-session")
    assert telemetry_response.status_code == 200
    telemetry_events = telemetry_response.json()["events"]
    assert telemetry_events
    assert telemetry_events[-1]["degraded"] is True
    assert telemetry_events[-1]["error"] == "simulated provider failure"
