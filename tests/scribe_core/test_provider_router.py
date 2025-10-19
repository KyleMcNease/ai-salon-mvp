from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Sequence

from scribe_core.llm import AnthropicClient, LLMMessage, LLMResult, ToolDefinition, ToolCall, UsageMetrics
from scribe_core.provider_router import ProviderRouter, UnknownProviderError


class StubAnthropicClient(AnthropicClient):
    def __init__(self, response: LLMResult) -> None:
        super().__init__(api_key="stub-key", base_url="https://example.com")
        self._response = response
        self.calls: list[Dict[str, Any]] = []

    def send_messages(  # type: ignore[override]
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Optional[Sequence[ToolDefinition]] = None,
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
                "messages": [message.content_blocks() for message in messages],
                "system": system,
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "metadata": metadata,
                "tool_choice": tool_choice,
                "tools": [tool.to_payload() for tool in tools or []],
            }
        )
        return self._response


def test_provider_router_routes_to_anthropic() -> None:
    expected_result = LLMResult(
        text="All systems go.",
        tool_calls=[ToolCall(id="test", name="noop")],
        stop_reason="end_turn",
        model="claude-3-sonnet",
        usage=UsageMetrics(input_tokens=10, output_tokens=20, total_tokens=30),
    )

    client = StubAnthropicClient(expected_result)
    router = ProviderRouter(anthropic_client=client)

    result = router.send(
        provider="anthropic",
        model="claude-3-sonnet",
        messages=[
            {"role": "user", "content": "Status report"},
        ],
        tools=[
            {
                "name": "noop",
                "description": "Does nothing",
                "input_schema": {"type": "object"},
            }
        ],
        system="You are a testing assistant.",
        max_tokens=256,
        temperature=0.2,
        metadata={"request_id": "abc"},
        tool_choice={"type": "tool", "name": "noop"},
    )

    assert result == expected_result
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["system"] == "You are a testing assistant."
    assert call["model"] == "claude-3-sonnet"
    assert call["max_tokens"] == 256
    assert call["temperature"] == 0.2
    assert call["metadata"] == {"request_id": "abc"}
    assert call["tool_choice"] == {"type": "tool", "name": "noop"}
    assert call["tools"][0]["name"] == "noop"


def test_provider_router_rejects_unknown_provider() -> None:
    router = ProviderRouter(anthropic_client=StubAnthropicClient(LLMResult(text="ok")))

    try:
        router.send(
            provider="openai",
            model="gpt-5",
            messages=[{"role": "user", "content": "hello"}],
        )
    except UnknownProviderError as exc:
        assert "Provider 'openai'" in str(exc)
    else:  # pragma: no cover - sanity guard
        raise AssertionError("Expected UnknownProviderError")
