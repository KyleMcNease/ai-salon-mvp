"""Provider profile persistence and lookup helpers for Scribe."""

from __future__ import annotations

import json
import os
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from pydantic import BaseModel, Field


class AuthMode(str, Enum):
    """Authentication mode used to reach a model provider."""

    API_KEY = "api_key"
    CLI_OAUTH = "cli_oauth"
    OPENAI_COMPATIBLE = "openai_compatible"
    MOCK = "mock"


class ProviderProfile(BaseModel):
    """Runtime settings for a provider credential/profile slot."""

    id: str
    provider: str
    auth_mode: AuthMode = AuthMode.API_KEY
    enabled: bool = True
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    organization: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    def redacted(self) -> Dict[str, Any]:
        payload = self.model_dump()
        if payload.get("api_key"):
            payload["api_key"] = "********"
        return payload


class ProviderProfileUpdate(BaseModel):
    """PATCH-style update payload for provider profile changes."""

    provider: str
    auth_mode: AuthMode
    enabled: bool = True
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    organization: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ProviderProfilesStore:
    """File-backed provider profile registry."""

    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = path or Path("data/provider_profiles.json")
        self._profiles: Optional[Dict[str, ProviderProfile]] = None

    def _default_profiles(self) -> Dict[str, ProviderProfile]:
        return {
            "anthropic:default": ProviderProfile(
                id="anthropic:default",
                provider="anthropic",
                auth_mode=AuthMode.CLI_OAUTH,
                api_key=os.getenv("ANTHROPIC_API_KEY"),
                metadata={"command": "claude", "notes": "Claude subscription OAuth via Claude Code CLI"},
            ),
            "openai:default": ProviderProfile(
                id="openai:default",
                provider="openai",
                auth_mode=AuthMode.CLI_OAUTH,
                api_key=os.getenv("OPENAI_API_KEY"),
                organization=os.getenv("OPENAI_ORG_ID"),
                metadata={"command": "codex", "notes": "ChatGPT/Codex subscription OAuth via Codex CLI"},
            ),
            "local:gpt-oss": ProviderProfile(
                id="local:gpt-oss",
                provider="local",
                auth_mode=AuthMode.OPENAI_COMPATIBLE,
                api_key=os.getenv("LOCAL_OPENAI_API_KEY") or "local-dev",
                base_url=os.getenv("LOCAL_OPENAI_BASE_URL") or "http://127.0.0.1:11434/v1",
                metadata={"notes": "Local OpenAI-compatible endpoint (Ollama/vLLM/llama.cpp)"},
            ),
            "mock:default": ProviderProfile(
                id="mock:default",
                provider="mock",
                auth_mode=AuthMode.MOCK,
                enabled=True,
                metadata={"notes": "Safe offline fallback for development"},
            ),
        }

    def _ensure_loaded(self) -> Dict[str, ProviderProfile]:
        if self._profiles is not None:
            return self._profiles

        if not self.path.exists():
            self._profiles = self._default_profiles()
            self.save()
            return self._profiles

        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            self._profiles = self._default_profiles()
            self.save()
            return self._profiles

        profiles: Dict[str, ProviderProfile] = {}
        items: Iterable[Any]
        if isinstance(raw, dict):
            if "profiles" in raw and isinstance(raw["profiles"], list):
                items = raw["profiles"]
            else:
                items = raw.values()
        elif isinstance(raw, list):
            items = raw
        else:
            items = []

        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                profile = ProviderProfile(**item)
            except Exception:
                continue
            profiles[profile.id] = profile

        if not profiles:
            profiles = self._default_profiles()

        self._profiles = profiles
        return self._profiles

    def save(self) -> None:
        profiles = self._ensure_loaded()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "profiles": [profile.model_dump() for profile in sorted(profiles.values(), key=lambda p: p.id)]
        }
        self.path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def list_profiles(self, *, redact: bool = True) -> list[Dict[str, Any]]:
        profiles = self._ensure_loaded()
        output = []
        for profile in sorted(profiles.values(), key=lambda p: p.id):
            output.append(profile.redacted() if redact else profile.model_dump())
        return output

    def get(self, profile_id: str) -> Optional[ProviderProfile]:
        return self._ensure_loaded().get(profile_id)

    def resolve(self, *, provider: str, profile_id: Optional[str] = None) -> Optional[ProviderProfile]:
        profiles = self._ensure_loaded()

        if profile_id:
            profile = profiles.get(profile_id)
            if profile and profile.enabled:
                return profile
            return None

        default_id = f"{provider}:default"
        profile = profiles.get(default_id)
        if profile and profile.enabled:
            return profile

        for item in profiles.values():
            if item.enabled and item.provider == provider:
                return item
        return None

    def upsert(self, profile_id: str, update: ProviderProfileUpdate) -> ProviderProfile:
        profiles = self._ensure_loaded()
        profile = ProviderProfile(
            id=profile_id,
            provider=update.provider,
            auth_mode=update.auth_mode,
            enabled=update.enabled,
            api_key=update.api_key,
            base_url=update.base_url,
            organization=update.organization,
            metadata=update.metadata,
        )
        profiles[profile_id] = profile
        self.save()
        return profile
