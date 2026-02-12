"""Shared conversation state store for multi-agent SCRIBE sessions."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


class SharedSessionStore:
    """Persist shared conversation history in local JSON files."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path("data/shared_sessions")

    def _path(self, session_id: str) -> Path:
        return self.root / f"{session_id}.json"

    def _default_memory(self) -> Dict[str, Any]:
        return {
            "summary": "",
            "key_facts": [],
            "user_preferences": [],
            "agent_notes": [],
            "updated_at": None,
        }

    def _normalize_memory(self, memory: Any) -> Dict[str, Any]:
        base = self._default_memory()
        if not isinstance(memory, dict):
            return base

        summary = memory.get("summary")
        base["summary"] = str(summary).strip() if isinstance(summary, str) else ""

        for field_name in ("key_facts", "user_preferences", "agent_notes"):
            items = memory.get(field_name)
            if not isinstance(items, list):
                continue
            cleaned = [str(item).strip() for item in items if isinstance(item, str) and item.strip()]
            base[field_name] = cleaned

        updated_at = memory.get("updated_at")
        if isinstance(updated_at, str) and updated_at.strip():
            base["updated_at"] = updated_at
        return base

    def load(self, session_id: str) -> Dict[str, Any]:
        path = self._path(session_id)
        if not path.exists():
            return {
                "session_id": session_id,
                "messages": [],
                "memory": self._default_memory(),
                "updated_at": None,
            }
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {
                "session_id": session_id,
                "messages": [],
                "memory": self._default_memory(),
                "updated_at": None,
            }
        if not isinstance(payload, dict):
            return {
                "session_id": session_id,
                "messages": [],
                "memory": self._default_memory(),
                "updated_at": None,
            }
        payload.setdefault("session_id", session_id)
        payload.setdefault("messages", [])
        payload["memory"] = self._normalize_memory(payload.get("memory"))
        payload.setdefault("updated_at", None)
        return payload

    def save(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        *,
        memory: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        self.root.mkdir(parents=True, exist_ok=True)
        existing = self.load(session_id)
        effective_memory = self._normalize_memory(memory if memory is not None else existing.get("memory"))
        effective_memory["updated_at"] = datetime.now(timezone.utc).isoformat()
        payload = {
            "session_id": session_id,
            "messages": messages,
            "memory": effective_memory,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._path(session_id).write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
        return payload

    def append(self, session_id: str, message: Dict[str, Any]) -> Dict[str, Any]:
        current = self.load(session_id)
        messages = current.get("messages")
        if not isinstance(messages, list):
            messages = []
        messages.append(message)
        return self.save(session_id, messages, memory=current.get("memory"))

    def update_memory(
        self,
        session_id: str,
        *,
        summary: str | None = None,
        key_facts: List[str] | None = None,
        user_preferences: List[str] | None = None,
        agent_notes: List[str] | None = None,
        merge: bool = True,
    ) -> Dict[str, Any]:
        current = self.load(session_id)
        messages = current.get("messages")
        if not isinstance(messages, list):
            messages = []
        memory = self._normalize_memory(current.get("memory"))

        if not merge:
            memory = self._default_memory()

        if summary is not None:
            memory["summary"] = summary.strip()
        if key_facts is not None:
            memory["key_facts"] = [item.strip() for item in key_facts if item.strip()]
        if user_preferences is not None:
            memory["user_preferences"] = [item.strip() for item in user_preferences if item.strip()]
        if agent_notes is not None:
            memory["agent_notes"] = [item.strip() for item in agent_notes if item.strip()]

        return self.save(session_id, messages, memory=memory)
