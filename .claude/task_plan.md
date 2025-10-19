# Scribe AI-Salon – Working Plan & Guardrails

## Core Principle
This repository is **pure Scribe**. Absolutely no code, strings, modules, or configuration from the legacy `ii-agent` project may be introduced here. All paths, imports, and build steps must remain under the Scribe namespaces (`scribe_core`, `scribe_agents`, `apps/scribe-web`, `frontend`, etc.).

### Enforced Guardrails
- `.claude/hooks/validate_write_paths.py` blocks writes to legacy locations (e.g., `src/ii_agent/**`, `adapters/ii_bridge/**`).
- `scripts/ci/no-legacy-namespace.sh` runs first in CI and fails on any `ii_agent` / `ii-agent` reference.
- `.github/workflows/ci.yml` installs/builds with PNPM, then runs pytest; **do not** modify the workflow to reintroduce legacy steps.

## High-Level Roadmap (T1 → T5)

| Task | Goal (Scribe-native) |
| ---- | -------------------- |
| T1 | Rebuild Anthropic message+tool orchestration under `src/scribe_core/llm` + `src/scribe_agents/runtime`. |
| T2 | Implement Anthropic Agents API (jobs) with Scribe’s provider router and storage. |
| T3 | Voice mode: STT/TTS services, NeuTTS/ElevenLabs adapters, and UI wiring under `scribe_agents.voice` / `frontend`. |
| T4 | Safe-Mode: capability registry, segmented memory, Safe Shelf. Store segmented context in Supabase-compatible layer. |
| T5 | Declarative model registry (`config/models.yml`), mid-chat `@model` switching, and synced frontend model picker. |

Each task must build directly on the Scribe codebase; when referencing prior work, import only concepts—not files—from the legacy repo.

## Working Conventions
1. **Namespace discipline** – All Python modules live under `src/scribe_core` or `src/scribe_agents`. Frontend work stays in `frontend/`.
2. **Provider access** – Clients are surfaced via `scribe_core.provider_router`. If a helper is missing, add it here, not via `ii-agent` imports.
3. **Storage** – Use Scribe storage contracts (Supabase / local stubs). Do not rely on `ii_agent.core.storage` APIs.
4. **Testing** – Add or update tests in `tests/scribe_core/**` or `tests/scribe_agents/**`. No tests should import `ii_agent`.
5. **Docs** – README & docs must continue to state the zero-legacy policy. Mentioning `ii-agent` is only allowed to reiterate that it is unsupported.

## Execution Notes
- Keep context small by using `rg`, `fd`, and targeted `sed` snippets.
- Document findings in `.claude/notes/<task>.md` as needed.
- When in doubt, prefer rebuilding the feature over porting files.

Stay disciplined: **if a file path begins with `src/ii_agent` or contains `ii-agent`, stop immediately and rework the approach.**
