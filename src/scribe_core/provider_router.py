from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Iterable, List, Mapping, Optional, Sequence, Union

from .llm import AnthropicClient, LLMMessage, LLMResult, ToolDefinition

MessageInput = Union[LLMMessage, Mapping[str, Any]]
ToolInput = Union[ToolDefinition, Mapping[str, Any]]


class UnknownProviderError(ValueError):
    """Raised when a caller references a provider that is not registered."""


@dataclass
class ProviderConfig:
    """Lightweight provider registry entry."""

    key: str
    kind: str


class ProviderRouter:
    """Route LLM invocations to a configured provider runtime."""

    def __init__(
        self,
        *,
        anthropic_client: Optional[AnthropicClient] = None,
        providers: Optional[Iterable[ProviderConfig]] = None,
    ) -> None:
        self._anthropic_client = anthropic_client
        self._providers = {provider.key: provider for provider in providers or []}
        if "anthropic" not in self._providers:
            self._providers["anthropic"] = ProviderConfig(key="anthropic", kind="anthropic")

        self._lock = threading.Lock()

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def send(
        self,
        *,
        provider: str,
        model: str,
        messages: Sequence[MessageInput],
        tools: Optional[Sequence[ToolInput]] = None,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        tool_choice: Optional[Mapping[str, Any]] = None,
    ) -> LLMResult:
        """Dispatch a chat request to a provider."""

        provider_key = provider.lower().strip()
        if provider_key not in self._providers:
            raise UnknownProviderError(f"Provider '{provider}' is not registered with this router.")

        normalized_messages = _normalise_messages(messages)
        normalized_tools = _normalise_tools(tools)

        if provider_key == "anthropic":
            client = self._ensure_anthropic_client()
            return client.send_messages(
                normalized_messages,
                tools=normalized_tools,
                system=system,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                metadata=metadata,
                tool_choice=tool_choice,
            )

        raise UnknownProviderError(f"Provider '{provider}' is not supported by this router.")

    @classmethod
    def lazy_default(cls) -> "ProviderRouter":
        return cls()

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _ensure_anthropic_client(self) -> AnthropicClient:
        with self._lock:
            if self._anthropic_client is None:
                self._anthropic_client = AnthropicClient()
            return self._anthropic_client


def _normalise_messages(messages: Sequence[MessageInput]) -> List[LLMMessage]:
    normalised: List[LLMMessage] = []
    for entry in messages:
        if isinstance(entry, LLMMessage):
            normalised.append(entry)
            continue

        if not isinstance(entry, Mapping):
            raise TypeError(f"Unsupported message input type: {type(entry)!r}")

        role = entry.get("role")
        content = entry.get("content")
        if not isinstance(role, str):
            raise ValueError("Message role must be a string.")
        if content is None:
            raise ValueError("Message content cannot be None.")
        normalised.append(LLMMessage(role=role, content=content))

    return normalised


def _normalise_tools(tools: Optional[Sequence[ToolInput]]) -> Optional[List[ToolDefinition]]:
    if not tools:
        return None

    normalised: List[ToolDefinition] = []
    for tool in tools:
        if isinstance(tool, ToolDefinition):
            normalised.append(tool)
            continue

        if not isinstance(tool, Mapping):
            raise TypeError(f"Unsupported tool input type: {type(tool)!r}")

        name = tool.get("name")
        description = tool.get("description")
        input_schema = tool.get("input_schema")
        metadata = tool.get("metadata")

        if not isinstance(name, str) or not name.strip():
            raise ValueError("Tool definition must include a non-empty 'name'.")
        if not isinstance(description, str) or not description.strip():
            raise ValueError("Tool definition must include a non-empty 'description'.")
        if not isinstance(input_schema, Mapping):
            raise ValueError("Tool definition must include an 'input_schema' object.")

        normalised.append(
            ToolDefinition(
                name=name.strip(),
                description=description.strip(),
                input_schema=dict(input_schema),
                metadata=dict(metadata) if isinstance(metadata, Mapping) else None,
            )
        )

    return normalised
