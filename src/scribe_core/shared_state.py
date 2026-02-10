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

    def load(self, session_id: str) -> Dict[str, Any]:
        path = self._path(session_id)
        if not path.exists():
            return {"session_id": session_id, "messages": [], "updated_at": None}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {"session_id": session_id, "messages": [], "updated_at": None}
        if not isinstance(payload, dict):
            return {"session_id": session_id, "messages": [], "updated_at": None}
        payload.setdefault("session_id", session_id)
        payload.setdefault("messages", [])
        payload.setdefault("updated_at", None)
        return payload

    def save(self, session_id: str, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {
            "session_id": session_id,
            "messages": messages,
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
        return self.save(session_id, messages)
