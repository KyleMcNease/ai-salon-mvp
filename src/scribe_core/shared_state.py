"""Shared conversation state store for multi-agent SCRIBE sessions."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


class SharedSessionStore:
    """Persist shared conversation history in SQLite with WAL and safe transactions."""

    def __init__(self, root: Path | None = None, *, db_path: Path | None = None) -> None:
        self.root = root or Path("data/shared_sessions")
        self.db_path = db_path or (self.root / "sessions.sqlite3")
        self._lock = threading.RLock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=5.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        return conn

    def _init_db(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    messages_json TEXT NOT NULL,
                    memory_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _legacy_json_path(self, session_id: str) -> Path:
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

    def _default_payload(self, session_id: str) -> Dict[str, Any]:
        return {
            "session_id": session_id,
            "messages": [],
            "memory": self._default_memory(),
            "updated_at": None,
        }

    def _deserialize_row(self, session_id: str, row: sqlite3.Row) -> Dict[str, Any]:
        try:
            messages = json.loads(str(row["messages_json"]))
            memory = json.loads(str(row["memory_json"]))
        except Exception:
            return self._default_payload(session_id)

        if not isinstance(messages, list):
            messages = []

        return {
            "session_id": session_id,
            "messages": messages,
            "memory": self._normalize_memory(memory),
            "updated_at": row["updated_at"],
        }

    def _load_legacy_json(self, session_id: str) -> Dict[str, Any] | None:
        path = self._legacy_json_path(session_id)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        messages = payload.get("messages")
        if not isinstance(messages, list):
            messages = []
        memory = self._normalize_memory(payload.get("memory"))
        updated_at = payload.get("updated_at")
        normalized = {
            "session_id": session_id,
            "messages": messages,
            "memory": memory,
            "updated_at": updated_at if isinstance(updated_at, str) else None,
        }
        return normalized

    def load(self, session_id: str) -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT session_id, messages_json, memory_json, updated_at FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if row is not None:
                return self._deserialize_row(session_id, row)

        legacy = self._load_legacy_json(session_id)
        if legacy is not None:
            self.save(session_id, list(legacy.get("messages") or []), memory=legacy.get("memory"))
            with self._lock, self._connect() as conn:
                row = conn.execute(
                    "SELECT session_id, messages_json, memory_json, updated_at FROM sessions WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
                if row is not None:
                    return self._deserialize_row(session_id, row)

        return self._default_payload(session_id)

    def save(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        *,
        memory: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        existing = self.load(session_id)
        effective_memory = self._normalize_memory(memory if memory is not None else existing.get("memory"))
        now = datetime.now(timezone.utc).isoformat()
        effective_memory["updated_at"] = now
        payload = {
            "session_id": session_id,
            "messages": messages if isinstance(messages, list) else [],
            "memory": effective_memory,
            "updated_at": now,
        }

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions(session_id, messages_json, memory_json, updated_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    messages_json = excluded.messages_json,
                    memory_json = excluded.memory_json,
                    updated_at = excluded.updated_at
                """,
                (
                    session_id,
                    json.dumps(payload["messages"], ensure_ascii=True),
                    json.dumps(payload["memory"], ensure_ascii=True),
                    now,
                ),
            )

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
