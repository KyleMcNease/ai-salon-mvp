from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence

from scribe_core.llm import AnthropicClient, LLMMessage, LLMResult, ToolCall, ToolDefinition


ToolHandler = Callable[[ToolCall], "ToolExecutionResult | str | Mapping[str, Any] | Sequence[Any] | None"]

LOGGER = logging.getLogger(__name__)


@dataclass
class ToolExecutionResult:
    """Output produced by a tool handler."""

    content: Any
    is_error: bool = False
    metadata: Optional[Mapping[str, Any]] = None


@dataclass
class ToolExecutionRecord:
    """Trace of a tool invocation during a runtime loop."""

    call: ToolCall
    result: ToolExecutionResult


@dataclass
class RegisteredTool:
    """Runtime representation of a tool + callable."""

    definition: ToolDefinition
    handler: ToolHandler


@dataclass
class RuntimeResult:
    """Output returned by the runtime after finishing tool resolution."""

    response: LLMResult
    history: List[LLMMessage]
    tool_executions: List[ToolExecutionRecord] = field(default_factory=list)
    iterations: int = 0
    stop_reason: Optional[str] = None


class AnthropicAgentRuntime:
    """Higher-level runtime that manages the tool loop around Anthropic calls."""

    def __init__(
        self,
        *,
        client: Optional[AnthropicClient] = None,
        tools: Optional[Sequence[RegisteredTool]] = None,
        logger: Optional[logging.Logger] = None,
        max_tool_iterations: int = 4,
    ) -> None:
        self.client = client or AnthropicClient()
        self.logger = logger or LOGGER
        self.max_tool_iterations = max_tool_iterations

        self._registered_tools: Dict[str, RegisteredTool] = {}
        if tools:
            for tool in tools:
                self.register_tool(tool.definition, tool.handler)

    # ------------------------------------------------------------------ #
    # Tool registration
    # ------------------------------------------------------------------ #

    def register_tool(self, definition: ToolDefinition, handler: ToolHandler) -> None:
        """Register a tool for subsequent invocations."""

        self._registered_tools[definition.name] = RegisteredTool(definition=definition, handler=handler)

    def clear_tools(self) -> None:
        """Remove all registered tools (useful for tests)."""

        self._registered_tools.clear()

    def available_tools(self) -> Iterable[RegisteredTool]:
        return self._registered_tools.values()

    # ------------------------------------------------------------------ #
    # Runtime loop
    # ------------------------------------------------------------------ #

    def run(
        self,
        conversation: Sequence[LLMMessage],
        *,
        tools: Optional[Sequence[RegisteredTool]] = None,
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        system: Optional[str] = None,
        tool_choice: Optional[Mapping[str, Any]] = None,
        max_tool_iterations: Optional[int] = None,
    ) -> RuntimeResult:
        """Execute a conversation loop, resolving tool calls as needed."""

        history = [_clone_message(message) for message in conversation]
        tool_registry = dict(self._registered_tools)

        if tools:
            for tool in tools:
                tool_registry[tool.definition.name] = tool

        if not history:
            raise ValueError("Conversation history cannot be empty.")

        if system:
            # Allow explicit system override by prefixing a synthetic system message.
            history.insert(0, LLMMessage(role="system", content=system))

        definitions = [tool.definition for tool in tool_registry.values()]

        tool_executions: list[ToolExecutionRecord] = []
        iterations = 0
        stop_reason: Optional[str] = None

        last_response: Optional[LLMResult] = None
        iteration_limit = max_tool_iterations if max_tool_iterations is not None else self.max_tool_iterations

        while True:
            last_response = self.client.send_messages(
                history,
                tools=definitions if tool_registry else None,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                metadata=metadata,
                system=None,  # already encoded in `history`
                tool_choice=tool_choice,
            )
            iterations += 1

            assistant_message = _assistant_message_from_result(last_response)
            history.append(assistant_message)

            if not last_response.tool_calls:
                stop_reason = stop_reason or last_response.stop_reason
                break

            if iterations >= iteration_limit:
                stop_reason = "tool_iteration_limit"
                break

            for call in last_response.tool_calls:
                execution = self._execute_tool(call, tool_registry)
                tool_executions.append(execution)
                history.append(
                    LLMMessage(
                        role="user",
                        content=[
                            _tool_result_block(call_id=call.id, result=execution.result),
                        ],
                    )
                )

        return RuntimeResult(
            response=last_response,
            history=history,
            tool_executions=tool_executions,
            iterations=iterations,
            stop_reason=stop_reason,
        )

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _execute_tool(
        self,
        call: ToolCall,
        registry: Mapping[str, RegisteredTool],
    ) -> ToolExecutionRecord:
        registered = registry.get(call.name)

        if not registered:
            error_content = f"Tool '{call.name}' is not registered with this runtime."
            self.logger.warning("Missing tool handler for %s", call.name)
            return ToolExecutionRecord(
                call=call,
                result=ToolExecutionResult(content=error_content, is_error=True),
            )

        try:
            result = registered.handler(call)
        except Exception as exc:  # pragma: no cover - defensive guardrail
            self.logger.exception("Tool handler raised for %s", call.name)
            result = ToolExecutionResult(content=str(exc), is_error=True)

        normalized = _normalise_tool_result(result)
        return ToolExecutionRecord(call=call, result=normalized)


# ---------------------------------------------------------------------- #
# Helper utilities
# ---------------------------------------------------------------------- #


def _clone_message(message: LLMMessage) -> LLMMessage:
    if isinstance(message.content, str):
        return LLMMessage(role=message.role, content=message.content)
    return LLMMessage(role=message.role, content=message.content_blocks())


def _assistant_message_from_result(result: LLMResult) -> LLMMessage:
    if result.content_blocks:
        return LLMMessage(role="assistant", content=result.content_blocks)
    if result.text:
        return LLMMessage(role="assistant", content=result.text)
    return LLMMessage(role="assistant", content="")


def _tool_result_block(*, call_id: str, result: ToolExecutionResult) -> Dict[str, Any]:
    content = result.content

    if isinstance(content, str):
        payload_content: Any = content
    elif isinstance(content, Sequence):
        payload_content = list(content)
    else:
        payload_content = content

    block: Dict[str, Any] = {
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": payload_content,
    }

    if result.is_error:
        block["is_error"] = True
    if result.metadata:
        block["metadata"] = dict(result.metadata)

    return block


def _normalise_tool_result(
    value: ToolExecutionResult | str | Mapping[str, Any] | Sequence[Any] | None,
) -> ToolExecutionResult:
    if isinstance(value, ToolExecutionResult):
        return value
    if value is None:
        return ToolExecutionResult(content="")
    if isinstance(value, str):
        return ToolExecutionResult(content=value)
    if isinstance(value, Mapping):
        try:
            content = json.dumps(value)
        except TypeError:
            content = str(value)
        return ToolExecutionResult(content=content)
    if isinstance(value, Sequence):
        if not value:
            return ToolExecutionResult(content=[])
        if all(isinstance(item, Mapping) for item in value):
            return ToolExecutionResult(content=[dict(item) for item in value])
        try:
            content = json.dumps(list(value))
        except TypeError:
            content = str(list(value))
        return ToolExecutionResult(content=content)
    return ToolExecutionResult(content=str(value))
