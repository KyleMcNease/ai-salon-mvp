from __future__ import annotations

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


@pytest.fixture
def api_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(scribe_api_app, "shared_sessions", SharedSessionStore(root=tmp_path / "shared_sessions"))
    monkeypatch.setattr(scribe_api_app, "router", StubRouter())
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
