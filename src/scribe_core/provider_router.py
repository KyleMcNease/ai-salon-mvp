"""Provider router with subscription-CLI and API provider adapters."""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from anthropic import Anthropic
from openai import OpenAI

from .provider_profiles import AuthMode, ProviderProfile, ProviderProfilesStore


class ProviderRouter:
    """Route LLM invocations via configured provider profiles."""

    MODEL_ALIASES: Dict[str, Dict[str, str]] = {
        "openai": {
            "gpt5.3-codex": "gpt-5.2-codex",
            "gpt-5.3-codex": "gpt-5.2-codex",
            "gpt5.2-codex": "gpt-5.2-codex",
        },
        "anthropic": {
            "opus4.6": "opus",
            "opus4.5": "opus",
        },
    }
    DEFAULT_MAX_RETRIES = 1
    DEFAULT_TIMEOUT_SECONDS = 300

    def __init__(
        self,
        config_path: Optional[Path] = None,
        *,
        profiles_store: Optional[ProviderProfilesStore] = None,
    ) -> None:
        self.config_path = config_path
        self.profiles_store = profiles_store or ProviderProfilesStore()
        self._cli_sessions_path = Path("data/provider_cli_sessions.json")
        self._cli_sessions_lock = threading.RLock()
        self._cli_sessions = self._load_cli_sessions()

    def _load_cli_sessions(self) -> Dict[str, str]:
        if not self._cli_sessions_path.exists():
            return {}
        try:
            payload = json.loads(self._cli_sessions_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        sessions: Dict[str, str] = {}
        for key, value in payload.items():
            if isinstance(key, str) and isinstance(value, str) and key.strip() and value.strip():
                sessions[key] = value
        return sessions

    def _save_cli_sessions(self) -> None:
        self._cli_sessions_path.parent.mkdir(parents=True, exist_ok=True)
        self._cli_sessions_path.write_text(
            json.dumps(self._cli_sessions, indent=2, sort_keys=True, ensure_ascii=True),
            encoding="utf-8",
        )

    def _cli_session_key(
        self,
        *,
        provider: str,
        model: str,
        profile_id: str,
        scribe_session_id: Optional[str],
    ) -> str:
        return f"{provider}|{model}|{profile_id}|{scribe_session_id or ''}"

    def _get_cli_session(
        self,
        *,
        provider: str,
        model: str,
        profile_id: str,
        scribe_session_id: Optional[str],
    ) -> Optional[str]:
        key = self._cli_session_key(
            provider=provider,
            model=model,
            profile_id=profile_id,
            scribe_session_id=scribe_session_id,
        )
        with self._cli_sessions_lock:
            return self._cli_sessions.get(key)

    def _set_cli_session(
        self,
        *,
        provider: str,
        model: str,
        profile_id: str,
        scribe_session_id: Optional[str],
        cli_session_id: Optional[str],
    ) -> None:
        if not cli_session_id:
            return
        key = self._cli_session_key(
            provider=provider,
            model=model,
            profile_id=profile_id,
            scribe_session_id=scribe_session_id,
        )
        with self._cli_sessions_lock:
            self._cli_sessions[key] = cli_session_id
            self._save_cli_sessions()

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

        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        max_retries = self.DEFAULT_MAX_RETRIES
        timeout_seconds = self.DEFAULT_TIMEOUT_SECONDS
        if isinstance(options.get("max_retries"), int):
            max_retries = max(0, min(3, int(options["max_retries"])))
        if isinstance(options.get("timeout_seconds"), int):
            timeout_seconds = max(30, min(900, int(options["timeout_seconds"])))

        resolved_model = self._resolve_model_alias(provider=provider, model=model)
        errors: List[str] = []
        started_at = time.perf_counter()
        for attempt in range(max_retries + 1):
            try:
                if profile.auth_mode == AuthMode.CLI_OAUTH:
                    result = self._invoke_cli_oauth(
                        profile,
                        provider=provider,
                        model=resolved_model,
                        payload=payload,
                        timeout_seconds=timeout_seconds,
                    )
                elif profile.auth_mode == AuthMode.API_KEY:
                    result = self._invoke_api_key(
                        profile,
                        provider=provider,
                        model=resolved_model,
                        payload=payload,
                        timeout_seconds=timeout_seconds,
                    )
                elif profile.auth_mode == AuthMode.OPENAI_COMPATIBLE:
                    result = self._invoke_openai_compatible(
                        profile,
                        provider=provider,
                        model=resolved_model,
                        payload=payload,
                        timeout_seconds=timeout_seconds,
                    )
                else:
                    result = self._invoke_mock(profile, provider=provider, model=resolved_model, payload=payload)

                result_meta = result.setdefault("meta", {})
                if isinstance(result_meta, dict):
                    if resolved_model != model:
                        result_meta["requested_model"] = model
                        result_meta["resolved_model"] = resolved_model
                    result_meta["attempt"] = attempt + 1
                    result_meta["retries"] = attempt
                    result_meta["latency_ms"] = int((time.perf_counter() - started_at) * 1000)
                    result_meta["degraded"] = bool(attempt > 0)
                    if errors:
                        result_meta["warnings"] = list(errors)
                return result
            except Exception as exc:  # pragma: no cover - defensive fallback
                errors.append(f"{type(exc).__name__}: {exc}")
                if attempt < max_retries:
                    continue
                fallback = self.profiles_store.resolve(provider="mock")
                degraded = self._invoke_mock(
                    fallback,
                    provider=provider,
                    model=model,
                    payload=payload,
                    error=errors[-1],
                )
                degraded_meta = degraded.setdefault("meta", {})
                if isinstance(degraded_meta, dict):
                    degraded_meta["attempt"] = attempt + 1
                    degraded_meta["retries"] = attempt
                    degraded_meta["latency_ms"] = int((time.perf_counter() - started_at) * 1000)
                    degraded_meta["degraded"] = True
                    degraded_meta["warnings"] = list(errors)
                return degraded

        fallback = self.profiles_store.resolve(provider="mock")
        return self._invoke_mock(
            fallback,
            provider=provider,
            model=model,
            payload=payload,
            error="unknown provider routing failure",
        )

    def _invoke_cli_oauth(
        self,
        profile: ProviderProfile,
        *,
        provider: str,
        model: str,
        payload: Dict[str, Any],
        timeout_seconds: int,
    ) -> Dict[str, Any]:
        command = str((profile.metadata or {}).get("command") or self._default_cli_command(provider))
        if not command or shutil.which(command) is None:
            raise RuntimeError(f"CLI command '{command}' is not available on PATH")

        prompt = self._build_cli_prompt(payload)
        context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
        scribe_session_id = str(context.get("session_id") or "").strip() or None
        prior_cli_session = self._get_cli_session(
            provider=provider,
            model=model,
            profile_id=profile.id,
            scribe_session_id=scribe_session_id,
        )

        if command == "codex":
            response_text, meta = self._run_codex_cli(
                command=command,
                model=model,
                prompt=prompt,
                timeout_seconds=timeout_seconds,
                resume_session_id=prior_cli_session,
            )
            resolved_cli_session = str(meta.get("thread_id") or prior_cli_session or "").strip() or None
        elif command == "claude":
            response_text, meta = self._run_claude_cli(
                command=command,
                model=model,
                prompt=prompt,
                timeout_seconds=timeout_seconds,
                resume_session_id=prior_cli_session,
            )
            resolved_cli_session = str(meta.get("session_id") or prior_cli_session or "").strip() or None
        else:
            raise RuntimeError(f"Unsupported CLI OAuth command: {command}")

        self._set_cli_session(
            provider=provider,
            model=model,
            profile_id=profile.id,
            scribe_session_id=scribe_session_id,
            cli_session_id=resolved_cli_session,
        )
        meta.update(
            {
                "auth_mode": profile.auth_mode.value,
                "profile_id": profile.id,
                "provider_profile": profile.provider,
                "bridge": "subscription_cli",
                "cli_session_id": resolved_cli_session,
                "cli_session_reused": bool(prior_cli_session),
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
        timeout_seconds: int,
    ) -> Dict[str, Any]:
        if provider == "openai":
            content = self._openai_response(
                model=model,
                messages=self._normalized_messages(payload),
                api_key=profile.api_key,
                base_url=profile.base_url,
                organization=profile.organization,
                system_prompt=str(payload.get("system") or "").strip(),
                timeout_seconds=timeout_seconds,
            )
        elif provider == "anthropic":
            content = self._anthropic_response(
                model=model,
                messages=self._normalized_messages(payload),
                api_key=profile.api_key,
                system_prompt=str(payload.get("system") or "").strip(),
                max_tokens=int((payload.get("options") or {}).get("max_tokens") or 1200),
                timeout_seconds=timeout_seconds,
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
        timeout_seconds: int,
    ) -> Dict[str, Any]:
        content = self._openai_response(
            model=model,
            messages=self._normalized_messages(payload),
            api_key=profile.api_key,
            base_url=profile.base_url,
            organization=profile.organization,
            system_prompt=str(payload.get("system") or "").strip(),
            timeout_seconds=timeout_seconds,
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
                f"Verify CLI OAuth/session for {provider}. This turn ran in degraded mode."
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

    def _resolve_model_alias(self, *, provider: str, model: str) -> str:
        alias_map = self.MODEL_ALIASES.get(provider, {})
        normalized_key = model.strip().lower()
        return alias_map.get(normalized_key, model)

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

    def _run_codex_cli(
        self,
        *,
        command: str,
        model: str,
        prompt: str,
        timeout_seconds: int,
        resume_session_id: Optional[str] = None,
    ) -> tuple[str, Dict[str, Any]]:
        args: List[str] = [command, "exec"]
        if resume_session_id:
            args.extend(["resume", "--skip-git-repo-check", "--json", "-c", 'model_reasoning_effort="high"', "-m", model, resume_session_id, prompt])
        else:
            args.extend(["--skip-git-repo-check", "--json", "-c", 'model_reasoning_effort="high"', "-m", model, prompt])
        process = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
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

        return last_text, {
            "cli_command": command,
            "thread_id": thread_id or resume_session_id,
            "warnings": errors,
            "reasoning_effort": "high",
            "session_reused": bool(resume_session_id),
        }

    def _run_claude_cli(
        self,
        *,
        command: str,
        model: str,
        prompt: str,
        timeout_seconds: int,
        resume_session_id: Optional[str] = None,
    ) -> tuple[str, Dict[str, Any]]:
        args: List[str] = [
            command,
            "--print",
            "--output-format",
            "json",
            "--strict-mcp-config",
            "--mcp-config",
            '{"mcpServers":{}}',
            "--model",
            model,
        ]
        if resume_session_id:
            args.extend(["--resume", resume_session_id])
        args.append(prompt)
        process = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        payload: Optional[Dict[str, Any]] = None

        def _extract_payload(parsed: Any) -> Optional[Dict[str, Any]]:
            if isinstance(parsed, dict):
                if "result" in parsed or "is_error" in parsed:
                    return parsed
                return None
            if isinstance(parsed, list):
                for item in reversed(parsed):
                    if isinstance(item, dict) and ("result" in item or "is_error" in item):
                        return item
            return None

        for line in reversed(process.stdout.splitlines()):
            line = line.strip()
            if not line or line[0] not in "{[":
                continue
            try:
                parsed = json.loads(line)
                extracted = _extract_payload(parsed)
                if extracted:
                    payload = extracted
                    break
            except json.JSONDecodeError:
                continue

        stdout_text = process.stdout.strip()
        stderr_text = process.stderr.strip()

        if payload is None and stdout_text:
            try:
                parsed = json.loads(stdout_text)
                payload = _extract_payload(parsed)
            except json.JSONDecodeError:
                payload = None

        if not isinstance(payload, dict):
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
            "session_id": payload.get("session_id") or resume_session_id,
            "duration_ms": payload.get("duration_ms"),
            "session_reused": bool(resume_session_id),
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
        timeout_seconds: int,
    ) -> str:
        if not api_key:
            raise RuntimeError("Missing API key for OpenAI-compatible invocation")

        client = OpenAI(api_key=api_key, base_url=base_url or None, organization=organization or None)
        response = client.responses.create(
            model=model,
            input=messages,
            instructions=system_prompt or None,
            timeout=timeout_seconds,
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
        timeout_seconds: int,
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
            timeout=timeout_seconds,
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
