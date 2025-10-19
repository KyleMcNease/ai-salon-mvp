from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Literal, Mapping, Optional, Sequence, Union


MessageRole = Literal["system", "user", "assistant"]
ContentBlock = Dict[str, Any]
ContentLike = Union[str, Sequence[Mapping[str, Any]]]


@dataclass
class LLMMessage:
    """Generic chat message representation used across Scribe runtimes."""

    role: MessageRole
    content: ContentLike

    def as_text(self) -> str:
        """Return the string content for text-only messages."""

        if isinstance(self.content, str):
            return self.content
        return ""

    def content_blocks(self) -> List[ContentBlock]:
        """Return the message content as Anthropic-compatible blocks."""

        if isinstance(self.content, str):
            text = self.content.strip()
            if not text:
                return []
            return [{"type": "text", "text": text}]

        blocks: List[ContentBlock] = []
        for block in self.content:
            if not isinstance(block, Mapping):
                raise TypeError(f"Unsupported content block type: {type(block)!r}")
            # Copy to avoid accidental mutation downstream.
            blocks.append(dict(block))
        return blocks


@dataclass
class ToolDefinition:
    """JSON-schema definition for a callable tool exposed to models."""

    name: str
    description: str
    input_schema: Mapping[str, Any]
    metadata: Optional[Mapping[str, Any]] = None

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "input_schema": dict(self.input_schema),
        }
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        return payload


@dataclass
class ToolCall:
    """Normalized representation of an Anthropic tool invocation."""

    id: str
    name: str
    arguments: Dict[str, Any] = field(default_factory=dict)


@dataclass
class UsageMetrics:
    """Token accounting returned by Anthropic's API."""

    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


@dataclass
class LLMResult:
    """Normalized model response with optional tool invocations."""

    text: str
    tool_calls: List[ToolCall] = field(default_factory=list)
    stop_reason: Optional[str] = None
    model: Optional[str] = None
    usage: Optional[UsageMetrics] = None
    content_blocks: List[ContentBlock] = field(default_factory=list)
    raw: Optional[Dict[str, Any]] = None

    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)

    def iter_tool_calls(self) -> Iterable[ToolCall]:
        return iter(self.tool_calls)
