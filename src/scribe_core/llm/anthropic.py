from __future__ import annotations

import json
import logging
import os
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Mapping, MutableMapping, Optional, Sequence, Tuple

from .types import (
    LLMMessage,
    LLMResult,
    ToolCall,
    ToolDefinition,
    UsageMetrics,
)


LOGGER = logging.getLogger(__name__)


@dataclass
class AnthropicError(Exception):
    """Raised when the Anthropic API request fails."""

    status_code: Optional[int]
    message: str
    response_text: Optional[str] = None
    response_json: Optional[Dict[str, Any]] = None
    payload: Optional[Dict[str, Any]] = None

    def __post_init__(self) -> None:
        super().__init__(self.message)


class AnthropicClient:
    """Thin wrapper around Anthropic's Messages API with tool support."""

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        api_version: str = "2023-06-01",
        default_model: Optional[str] = None,
        default_max_output_tokens: int = 1024,
        timeout: float = 30.0,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        resolved_key = (api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not resolved_key:
            raise ValueError("Missing Anthropic API key (set ANTHROPIC_API_KEY)")

        self.api_key = resolved_key
        self.base_url = (base_url or os.environ.get("ANTHROPIC_API_URL") or "https://api.anthropic.com").rstrip("/")
        self.api_version = api_version
        self.default_model = default_model or os.environ.get("ANTHROPIC_MODEL") or "claude-3-5-sonnet-20241022"
        self.default_max_output_tokens = int(default_max_output_tokens)
        self.timeout = timeout
        self.logger = logger or LOGGER

    # --------------------------------------------------------------------- #
    # Public API
    # --------------------------------------------------------------------- #

    def send_messages(
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
        """Invoke Anthropic's Messages API and normalize the response."""

        if not messages:
            raise ValueError("At least one message must be supplied.")

        prepared_messages, resolved_system = self._prepare_messages(messages, system_override=system)
        if not prepared_messages:
            raise ValueError("No non-system messages supplied for Anthropic call.")

        body: Dict[str, Any] = {
            "model": model or self.default_model,
            "messages": prepared_messages,
            "max_tokens": max_tokens or self.default_max_output_tokens,
        }

        tool_payload = self._prepare_tools(tools)
        if tool_payload:
            body["tools"] = tool_payload

        if resolved_system:
            body["system"] = resolved_system
        if temperature is not None:
            body["temperature"] = float(temperature)
        if metadata:
            body["metadata"] = dict(metadata)
        if tool_choice:
            body["tool_choice"] = dict(tool_choice)

        response_payload, response_text = self._http_request(body, extra_headers=extra_headers)
        return self._normalise_response(response_payload, response_text)

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _prepare_messages(
        self,
        messages: Sequence[LLMMessage],
        *,
        system_override: Optional[str],
    ) -> Tuple[Sequence[Dict[str, Any]], Optional[str]]:
        prepared: list[Dict[str, Any]] = []
        system_segments: list[str] = []

        for message in messages:
            if message.role == "system":
                system_text = self._system_text_for_message(message)
                if system_text:
                    system_segments.append(system_text)
                continue

            blocks = message.content_blocks()
            if not blocks:
                raise ValueError(f"Message for role '{message.role}' is empty.")

            prepared.append(
                {
                    "role": message.role,
                    "content": blocks,
                }
            )

        resolved_system = (system_override or "").strip() or None
        if system_segments:
            combined = "\n\n".join(segment for segment in system_segments if segment)
            if combined:
                if resolved_system:
                    resolved_system = f"{resolved_system}\n\n{combined}".strip()
                else:
                    resolved_system = combined

        return prepared, resolved_system

    def _prepare_tools(self, tools: Optional[Sequence[ToolDefinition]]) -> Optional[Sequence[Dict[str, Any]]]:
        if not tools:
            return None
        payload = []
        for tool in tools:
            payload.append(tool.to_payload())
        return payload

    def _system_text_for_message(self, message: LLMMessage) -> str:
        if isinstance(message.content, str):
            return message.content.strip()

        fragments: list[str] = []
        for block in message.content_blocks():
            if block.get("type") == "text":
                text_value = str(block.get("text", "")).strip()
                if text_value:
                    fragments.append(text_value)
        return "\n\n".join(fragments)

    def _http_request(
        self,
        body: Dict[str, Any],
        *,
        extra_headers: Optional[Mapping[str, str]] = None,
    ) -> Tuple[Dict[str, Any], str]:
        data = json.dumps(body).encode("utf-8")
        headers: MutableMapping[str, str] = {
            "content-type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": self.api_version,
        }
        if extra_headers:
            headers.update(extra_headers)

        request = urllib.request.Request(
            url=f"{self.base_url}/v1/messages",
            data=data,
            headers=dict(headers),
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw_bytes = response.read()
                response_text = raw_bytes.decode("utf-8") if raw_bytes else ""
                try:
                    payload = json.loads(response_text) if response_text else {}
                except json.JSONDecodeError as exc:  # pragma: no cover - defensive guard
                    raise AnthropicError(
                        status_code=response.getcode(),
                        message="Anthropic response was not valid JSON.",
                        response_text=response_text,
                        payload=body,
                    ) from exc

                return payload, response_text

        except urllib.error.HTTPError as exc:
            error_bytes = exc.read()
            error_text = error_bytes.decode("utf-8", errors="ignore") if error_bytes else ""
            parsed: Optional[Dict[str, Any]] = None
            try:
                parsed = json.loads(error_text) if error_text else None
            except json.JSONDecodeError:
                parsed = None

            message = ""
            if isinstance(parsed, dict):
                error_payload = parsed.get("error")
                if isinstance(error_payload, dict):
                    message = str(error_payload.get("message") or "")

            raise AnthropicError(
                status_code=exc.code,
                message=message or f"Anthropic API error ({exc.code})",
                response_text=error_text or None,
                response_json=parsed,
                payload=body,
            ) from None
        except urllib.error.URLError as exc:
            human = getattr(exc, "reason", None) or str(exc)
            raise AnthropicError(status_code=None, message=f"Anthropic request failed: {human}", payload=body) from exc
        except socket.timeout as exc:
            raise AnthropicError(status_code=None, message="Anthropic request timed out", payload=body) from exc

    def _normalise_response(self, payload: Mapping[str, Any], response_text: str) -> LLMResult:
        content_blocks = payload.get("content") or []

        text_fragments: list[str] = []
        tool_calls: list[ToolCall] = []

        if isinstance(content_blocks, list):
            for block in content_blocks:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type")
                if block_type == "text":
                    text_value = block.get("text")
                    if text_value:
                        text_fragments.append(str(text_value))
                elif block_type == "tool_use":
                    call_id = str(block.get("id") or "")
                    name = str(block.get("name") or "")
                    arguments = block.get("input") or {}
                    if not isinstance(arguments, dict):
                        arguments = {}
                    tool_calls.append(
                        ToolCall(
                            id=call_id,
                            name=name,
                            arguments=dict(arguments),
                        )
                    )

        usage_payload = payload.get("usage") or {}
        usage = None
        if isinstance(usage_payload, dict) and usage_payload:
            usage = UsageMetrics(
                input_tokens=_safe_int(usage_payload.get("input_tokens")),
                output_tokens=_safe_int(usage_payload.get("output_tokens")),
                total_tokens=_safe_int(usage_payload.get("total_tokens")),
            )

        text = "\n".join(fragment for fragment in text_fragments if fragment).strip()

        normalised_blocks = [
            dict(block) for block in content_blocks if isinstance(block, dict)
        ]

        return LLMResult(
            text=text,
            tool_calls=tool_calls,
            stop_reason=payload.get("stop_reason"),
            model=payload.get("model"),
            usage=usage,
            content_blocks=normalised_blocks,
            raw={
                "response": dict(payload),
                "text": response_text,
            },
        )


def _safe_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None
