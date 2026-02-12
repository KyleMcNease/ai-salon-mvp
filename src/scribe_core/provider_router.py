"""Provider router with subscription-CLI and API provider adapters."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from anthropic import Anthropic
from openai import OpenAI

from .provider_profiles import AuthMode, ProviderProfile, ProviderProfilesStore


class ProviderRouter:
    """Route LLM invocations via configured provider profiles."""

    def __init__(
        self,
        config_path: Optional[Path] = None,
        *,
        profiles_store: Optional[ProviderProfilesStore] = None,
    ) -> None:
        self.config_path = config_path
        self.profiles_store = profiles_store or ProviderProfilesStore()

    def send_message(self, provider: str, model: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatch the request through the configured provider profile."""

        profile_id = payload.get("profile_id")
        profile = self.profiles_store.resolve(provider=provider, profile_id=profile_id)
        if not profile:
            fallback = self.profiles_store.resolve(provider="mock")
            return self._invoke_mock(
                fallback,
                provider=provider,
                model=model,
                payload=payload,
                error=f"No enabled profile found for provider '{provider}'",
            )

        try:
            if profile.auth_mode == AuthMode.CLI_OAUTH:
                return self._invoke_cli_oauth(profile, provider=provider, model=model, payload=payload)
            if profile.auth_mode == AuthMode.API_KEY:
                return self._invoke_api_key(profile, provider=provider, model=model, payload=payload)
            if profile.auth_mode == AuthMode.OPENAI_COMPATIBLE:
                return self._invoke_openai_compatible(profile, provider=provider, model=model, payload=payload)
            return self._invoke_mock(profile, provider=provider, model=model, payload=payload)
        except Exception as exc:  # pragma: no cover - defensive fallback
            fallback = self.profiles_store.resolve(provider="mock")
            return self._invoke_mock(
                fallback,
                provider=provider,
                model=model,
                payload=payload,
                error=f"{type(exc).__name__}: {exc}",
            )

    def _invoke_cli_oauth(
        self,
        profile: ProviderProfile,
        *,
        provider: str,
        model: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        command = str((profile.metadata or {}).get("command") or self._default_cli_command(provider))
        if not command or shutil.which(command) is None:
            raise RuntimeError(f"CLI command '{command}' is not available on PATH")

        prompt = self._build_cli_prompt(payload)

        if command == "codex":
            response_text, meta = self._run_codex_cli(command=command, model=model, prompt=prompt)
        elif command == "claude":
            response_text, meta = self._run_claude_cli(command=command, model=model, prompt=prompt)
        else:
            raise RuntimeError(f"Unsupported CLI OAuth command: {command}")

        meta.update(
            {
                "auth_mode": profile.auth_mode.value,
                "profile_id": profile.id,
                "provider_profile": profile.provider,
                "bridge": "subscription_cli",
            }
        )

        return {"content": response_text, "artifacts": [], "meta": meta}

    def _invoke_api_key(
        self,
        profile: ProviderProfile,
        *,
        provider: str,
        model: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        if provider == "openai":
            content = self._openai_response(
                model=model,
                messages=self._normalized_messages(payload),
                api_key=profile.api_key,
                base_url=profile.base_url,
                organization=profile.organization,
                system_prompt=str(payload.get("system") or "").strip(),
            )
        elif provider == "anthropic":
            content = self._anthropic_response(
                model=model,
                messages=self._normalized_messages(payload),
                api_key=profile.api_key,
                system_prompt=str(payload.get("system") or "").strip(),
                max_tokens=int((payload.get("options") or {}).get("max_tokens") or 1200),
            )
        else:
            raise RuntimeError(f"Provider '{provider}' is not supported in api_key mode")

        return {
            "content": content,
            "artifacts": [],
            "meta": {
                "auth_mode": profile.auth_mode.value,
                "profile_id": profile.id,
                "provider_profile": profile.provider,
            },
        }

    def _invoke_openai_compatible(
        self,
        profile: ProviderProfile,
        *,
        provider: str,
        model: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        content = self._openai_response(
            model=model,
            messages=self._normalized_messages(payload),
            api_key=profile.api_key,
            base_url=profile.base_url,
            organization=profile.organization,
            system_prompt=str(payload.get("system") or "").strip(),
        )
        return {
            "content": content,
            "artifacts": [],
            "meta": {
                "auth_mode": profile.auth_mode.value,
                "profile_id": profile.id,
                "provider_profile": profile.provider,
            },
        }

    def _invoke_mock(
        self,
        profile: Optional[ProviderProfile],
        *,
        provider: str,
        model: str,
        payload: Dict[str, Any],
        error: Optional[str] = None,
    ) -> Dict[str, Any]:
        if error:
            response_text = (
                f"[mock-fallback {provider}:{model}] Provider invocation failed: {error}. "
                f"Verify CLI OAuth/session for {provider}."
            )
        else:
            response_text = f"[mock {provider}:{model}] No live provider response available."

        meta: Dict[str, Any] = {
            "auth_mode": profile.auth_mode.value if profile else AuthMode.MOCK.value,
            "profile_id": profile.id if profile else None,
            "provider_profile": profile.provider if profile else "mock",
            "bridge": "mock",
        }
        if error:
            meta["error"] = error
        mentions = payload.get("mentions")
        if mentions:
            meta["mentions"] = list(mentions)
        context = payload.get("context")
        if context:
            meta["context"] = dict(context)
        options = payload.get("options")
        if options:
            meta["options"] = dict(options)

        return {"content": response_text, "artifacts": [], "meta": meta}

    def _default_cli_command(self, provider: str) -> str:
        if provider == "openai":
            return "codex"
        if provider == "anthropic":
            return "claude"
        return ""

    def _normalized_messages(self, payload: Dict[str, Any]) -> List[Dict[str, str]]:
        messages = payload.get("messages") or []
        normalized: List[Dict[str, str]] = []
        if not isinstance(messages, list):
            return normalized
        for item in messages:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "user")
            content = str(item.get("content") or "")
            normalized.append({"role": role, "content": content})
        return normalized

    def _build_cli_prompt(self, payload: Dict[str, Any]) -> str:
        system_prompt = str(payload.get("system") or "").strip()
        messages = self._normalized_messages(payload)
        context = payload.get("context") or {}
        transcript_lines: List[str] = []
        if system_prompt:
            transcript_lines.append(f"[SYSTEM]\n{system_prompt}")
        if context:
            transcript_lines.append(f"[CONTEXT]\n{json.dumps(context, ensure_ascii=True)}")
        if messages:
            transcript_lines.append("[TRANSCRIPT]")
            for message in messages[-30:]:
                transcript_lines.append(f"{message['role'].upper()}: {message['content']}")
        transcript_lines.append("Respond with the best next assistant message.")
        return "\n\n".join(transcript_lines)

    def _run_codex_cli(self, *, command: str, model: str, prompt: str) -> tuple[str, Dict[str, Any]]:
        process = subprocess.run(
            [command, "exec", "--skip-git-repo-check", "--json", "-m", model, prompt],
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
        events: List[Dict[str, Any]] = []
        for line in process.stdout.splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

        last_text = ""
        errors: List[str] = []
        thread_id: Optional[str] = None
        for event in events:
            if event.get("type") == "thread.started":
                thread_id = event.get("thread_id")
            if event.get("type") == "item.completed":
                item = event.get("item") or {}
                if item.get("type") == "agent_message" and item.get("text"):
                    last_text = str(item["text"])
            if event.get("type") == "error" and event.get("message"):
                errors.append(str(event["message"]))
            if event.get("type") == "turn.failed":
                err_payload = event.get("error") or {}
                if err_payload.get("message"):
                    errors.append(str(err_payload["message"]))

        if process.returncode != 0 and not errors:
            stderr = process.stderr.strip()
            if stderr:
                errors.append(stderr)
        if not last_text:
            if errors:
                raise RuntimeError(errors[-1])
            raise RuntimeError("Codex CLI returned no assistant message")

        return last_text, {"cli_command": command, "thread_id": thread_id, "warnings": errors}

    def _run_claude_cli(self, *, command: str, model: str, prompt: str) -> tuple[str, Dict[str, Any]]:
        process = subprocess.run(
            [command, "--print", "--output-format", "json", "--model", model, prompt],
            check=False,
            capture_output=True,
            text=True,
            timeout=300,
        )
        payload = None
        for line in reversed(process.stdout.splitlines()):
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                payload = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

        stdout_text = process.stdout.strip()
        stderr_text = process.stderr.strip()

        if not isinstance(payload, dict):
            # Some Claude CLI builds emit plain text with --print; accept that path.
            if process.returncode == 0 and stdout_text:
                return stdout_text, {"cli_command": command, "output_format": "text"}
            if stderr_text:
                raise RuntimeError(stderr_text)
            if stdout_text:
                raise RuntimeError(f"Claude CLI returned unparseable output: {stdout_text[:240]}")
            raise RuntimeError("Claude CLI returned unparseable output")

        if payload.get("is_error"):
            raise RuntimeError(str(payload.get("result") or "Claude CLI returned an error"))

        result = str(payload.get("result") or "").strip()
        if not result:
            raise RuntimeError("Claude CLI returned no result text")

        meta = {
            "cli_command": command,
            "session_id": payload.get("session_id"),
            "duration_ms": payload.get("duration_ms"),
        }
        return result, meta

    def _openai_response(
        self,
        *,
        model: str,
        messages: List[Dict[str, str]],
        api_key: Optional[str],
        base_url: Optional[str],
        organization: Optional[str],
        system_prompt: str,
    ) -> str:
        if not api_key:
            raise RuntimeError("Missing API key for OpenAI-compatible invocation")

        client = OpenAI(api_key=api_key, base_url=base_url or None, organization=organization or None)
        response = client.responses.create(
            model=model,
            input=messages,
            instructions=system_prompt or None,
        )
        text = getattr(response, "output_text", None)
        if text:
            return str(text)
        return json.dumps(response.model_dump(), ensure_ascii=True)

    def _anthropic_response(
        self,
        *,
        model: str,
        messages: List[Dict[str, str]],
        api_key: Optional[str],
        system_prompt: str,
        max_tokens: int,
    ) -> str:
        if not api_key:
            raise RuntimeError("Missing API key for Anthropic invocation")
        client = Anthropic(api_key=api_key)
        anthropic_messages = [
            {"role": message["role"], "content": message["content"]}
            for message in messages
            if message["role"] in {"user", "assistant"}
        ]
        if not anthropic_messages:
            anthropic_messages = [{"role": "user", "content": "Hello"}]
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt or None,
            messages=anthropic_messages,
        )
        parts: List[str] = []
        for block in response.content:
            if getattr(block, "type", None) == "text":
                parts.append(str(getattr(block, "text", "")))
        return "\n".join(part for part in parts if part).strip()

    @classmethod
    def lazy_default(cls) -> "ProviderRouter":
        """Construct a router using default configuration discovery."""

        default_config = Path("config/models.yml")
        if not default_config.exists():
            default_config = None
        return cls(config_path=default_config)
