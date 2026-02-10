# Scribe AI-Salon Runtime

SCRIBE is now structured as a closed-loop personal runtime where multiple agents can share one local conversation state surface.

Primary mode:
- Subscription OAuth via local CLIs (`codex`, `claude`)
- Shared local session state (`data/shared_sessions`)
- No direct provider API calls required for day-to-day turns

Fallback mode:
- API-key provider calls are still available when you explicitly configure them

## What's inside

- **scribe_core/** – provider routing, profile management, and shared-state stores
- **scribe_agents/** – Agent-S personas/orchestrator, salon coordination, tool library, and voice adapters
- **apps/scribe-web/** – WebSocket handlers and HTTP routes for salon and research entry points
- **apps/scribe_api/** – FastAPI endpoints for shared-state duet turns
- **frontend/** – Next.js duet workbench and orchestration UI

## Getting started

```bash
pip install -e .
uvicorn apps.scribe_api.app:app --reload
```

### Login once to subscription CLIs

```bash
codex login
claude setup-token
```

The default provider profiles are `cli_oauth`:
- `openai:default` -> `codex exec`
- `anthropic:default` -> `claude --print`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` for the shared duet surface.

Optional research-app bridge:
- set `NEXT_PUBLIC_RESEARCH_APP_URL` (for example `http://localhost:3001`) to enable one-click open/embed from the hidden Research panel in SCRIBE.

## Core endpoints

- `GET /api/models` model catalog grouped by provider
- `GET /api/provider-profiles` list redacted provider profiles
- `PUT /api/provider-profiles/{profile_id}` update profile mode/credentials
- `GET /api/sessions/{session_id}` fetch local shared transcript
- `GET /api/sessions/{session_id}/events` replay-compatible event stream derived from shared transcript
- `POST /api/duet/turn` append one user turn and run configured agents sequentially on shared state
- `WS /ws` legacy UI compatibility (`workspace_info`, `init_agent`, `query`, `edit_query`, `review_result`, `enhance_prompt`, `cancel`) mapped to the same shared duet engine

## Voice, Safe Mode, and Salon

All Agent-S tooling is exposed under `scribe_agents.agent_s`. The salon runtime (`apps/scribe-web/api/ws/handlers.py`) also routes through `ProviderRouter`, and now shares the same provider profile layer as duet turns.

## Guardrails

- `.claude/hooks/validate_write_paths.py` denies write attempts outside the allowed Scribe namespaces.
- `.github/workflows/ci.yml` invokes `scripts/ci/no-legacy-namespace.sh` to ensure legacy namespaces do not creep back into the tree.

## Notes

- Provider profiles are persisted at `data/provider_profiles.json`.
- Shared transcripts are persisted at `data/shared_sessions/<session_id>.json`.
- Local `gpt-oss` or other private models can be wired through the `openai_compatible` profile mode.
