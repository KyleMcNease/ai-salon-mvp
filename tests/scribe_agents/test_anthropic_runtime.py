from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Optional, Sequence

from scribe_agents.runtime import AnthropicAgentRuntime, ToolExecutionResult
from scribe_core.llm import AnthropicClient, LLMMessage, ToolCall, ToolDefinition


class ScriptedAnthropicClient(AnthropicClient):
    """Anthropic client that replays a deterministic sequence of responses."""

    def __init__(self, responses: Sequence[Mapping[str, Any]]) -> None:
        super().__init__(api_key="test-key", base_url="https://example.com")
        self._responses = [dict(payload) for payload in responses]
        self.calls: list[Dict[str, Any]] = []

    def _http_request(  # type: ignore[override]
        self,
        body: Dict[str, Any],
        *,
        extra_headers: Optional[Mapping[str, str]] = None,
    ) -> tuple[Dict[str, Any], str]:
        if not self._responses:
            raise AssertionError("No scripted responses left.")
        self.calls.append(dict(body))
        payload = self._responses.pop(0)
        return dict(payload), json.dumps(payload)


def _weather_tool_definition() -> ToolDefinition:
    return ToolDefinition(
        name="weather",
        description="Returns the current weather.",
        input_schema={
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    )


def test_runtime_executes_tool_loop() -> None:
    scripted_responses = [
        {
            "id": "msg_1",
            "model": "claude",
            "content": [
                {"type": "text", "text": "Let me check the latest forecast."},
                {
                    "type": "tool_use",
                    "id": "call_weather",
                    "name": "weather",
                    "input": {"location": "Kyoto"},
                },
            ],
            "stop_reason": "tool_use",
        },
        {
            "id": "msg_2",
            "model": "claude",
            "content": [{"type": "text", "text": "Kyoto is sunny at 25°C."}],
            "stop_reason": "end_turn",
        },
    ]

    client = ScriptedAnthropicClient(scripted_responses)

    weather_tool = _weather_tool_definition()

    def weather_handler(call: ToolCall) -> ToolExecutionResult:
        assert call.arguments == {"location": "Kyoto"}
        return ToolExecutionResult(content="Kyoto is sunny with a gentle breeze.")

    runtime = AnthropicAgentRuntime(client=client)
    runtime.register_tool(weather_tool, weather_handler)

    conversation = [LLMMessage(role="user", content="What's the weather in Kyoto?")]

    result = runtime.run(conversation)

    assert result.response.text == "Kyoto is sunny at 25°C."
    assert result.stop_reason == "end_turn"
    assert result.iterations == 2
    assert len(result.tool_executions) == 1
    assert result.tool_executions[0].result.content == "Kyoto is sunny with a gentle breeze."

    # Verify that the runtime appended the tool result block before the second call.
    assert len(client.calls) == 2
    second_call_messages = client.calls[1]["messages"]
    tool_result_block = second_call_messages[-1]["content"][0]
    assert tool_result_block["type"] == "tool_result"
    assert tool_result_block["tool_use_id"] == "call_weather"
    assert tool_result_block["content"] == "Kyoto is sunny with a gentle breeze."

    # Conversation history should include the original user message,
    # the assistant's tool call, the tool result, and the final assistant message.
    assert len(result.history) == 4


def test_runtime_marks_missing_tool_as_error() -> None:
    scripted_responses = [
        {
            "id": "msg_1",
            "model": "claude",
            "content": [
                {"type": "text", "text": "Invoking unsupported tool..."},
                {
                    "type": "tool_use",
                    "id": "call_unknown",
                    "name": "unknown_tool",
                    "input": {"foo": "bar"},
                },
            ],
            "stop_reason": "tool_use",
        },
        {
            "id": "msg_2",
            "model": "claude",
            "content": [{"type": "text", "text": "Tool was unavailable."}],
            "stop_reason": "end_turn",
        },
    ]

    client = ScriptedAnthropicClient(scripted_responses)
    runtime = AnthropicAgentRuntime(client=client)

    conversation = [LLMMessage(role="user", content="Do something fancy.")]
    result = runtime.run(conversation)

    assert len(result.tool_executions) == 1
    execution = result.tool_executions[0]
    assert execution.call.name == "unknown_tool"
    assert execution.result.is_error is True
    assert "not registered" in execution.result.content

    second_call_messages = client.calls[1]["messages"]
    tool_result_block = second_call_messages[-1]["content"][0]
    assert tool_result_block["is_error"] is True
