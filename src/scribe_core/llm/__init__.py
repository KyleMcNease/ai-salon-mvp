"""
LLM provider integrations for the Scribe runtime.

At the moment this package focuses on the Anthropic Messages API with tool
support. Additional providers should expose a similar surface area so the
agent runtime can swap implementations without touching higher layers.
"""

from .anthropic import AnthropicClient, AnthropicError
from .types import (
    LLMMessage,
    LLMResult,
    ToolCall,
    ToolDefinition,
    UsageMetrics,
)

__all__ = [
    "AnthropicClient",
    "AnthropicError",
    "LLMMessage",
    "LLMResult",
    "ToolCall",
    "ToolDefinition",
    "UsageMetrics",
]
