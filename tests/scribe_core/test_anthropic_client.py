from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Optional, Sequence

from scribe_core.llm import AnthropicClient, LLMMessage, ToolDefinition


class RecordingAnthropicClient(AnthropicClient):
    """Anthropic client that records the outgoing payload for assertions."""

    def __init__(self, response: Mapping[str, Any]) -> None:
        super().__init__(api_key="test-key", base_url="https://example.com")
        self._response = dict(response)
        self.last_body: Optional[Dict[str, Any]] = None
        self.extra_headers: Optional[Mapping[str, str]] = None

    def _http_request(  # type: ignore[override]
        self,
        body: Dict[str, Any],
        *,
        extra_headers: Optional[Mapping[str, str]] = None,
    ) -> tuple[Dict[str, Any], str]:
        self.last_body = dict(body)
        self.extra_headers = dict(extra_headers or {})
        return dict(self._response), json.dumps(self._response)


def test_send_messages_builds_payload_and_normalizes_response() -> None:
    response_payload = {
        "id": "msg_123",
        "model": "claude-3-sonnet",
        "content": [
            {"type": "text", "text": "Here is the answer."},
            {
                "type": "tool_use",
                "id": "toolu_456",
                "name": "weather",
                "input": {"location": "Paris"},
            },
        ],
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 10, "output_tokens": 32, "total_tokens": 42},
    }

    client = RecordingAnthropicClient(response_payload)

    messages = [
        LLMMessage(role="system", content="You are a precise assistant."),
        LLMMessage(role="user", content="What is the weather in Paris?"),
    ]

    tool_def = ToolDefinition(
        name="weather",
        description="Fetches the current weather.",
        input_schema={
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    )

    result = client.send_messages(
        messages,
        tools=[tool_def],
        max_tokens=256,
        temperature=0.5,
        metadata={"request_id": "req-1"},
        extra_headers={"x-extra": "true"},
    )

    assert client.extra_headers == {"x-extra": "true"}
    assert client.last_body is not None

    assert client.last_body["model"] == client.default_model
    assert client.last_body["max_tokens"] == 256
    assert client.last_body["temperature"] == 0.5
    assert client.last_body["system"].startswith("You are a precise assistant.")

    payload_messages: Sequence[Dict[str, Any]] = client.last_body["messages"]
    assert len(payload_messages) == 1
    assert payload_messages[0]["role"] == "user"
    assert payload_messages[0]["content"][0]["text"] == "What is the weather in Paris?"

    tools_payload = client.last_body["tools"]
    assert tools_payload[0]["name"] == "weather"
    assert tools_payload[0]["input_schema"]["required"] == ["location"]

    assert result.text == "Here is the answer."
    assert len(result.tool_calls) == 1
    call = result.tool_calls[0]
    assert call.id == "toolu_456"
    assert call.name == "weather"
    assert call.arguments == {"location": "Paris"}

    assert result.usage is not None
    assert result.usage.input_tokens == 10
    assert result.content_blocks == response_payload["content"]
