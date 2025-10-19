# AI Salon SCRIBE — Implementation Log

_This log tracks major updates across the SCRIBE build so any agent (ChatGPT, Claude, Grok) or human collaborator can quickly understand project state._

## 2025-09-25 — ChatGPT
- Added **SCRIBE PRD v0.2** documenting AGI orchestration goals, milestones, and architecture (`docs/AI_Salon_SCRIBE_PRD.md`).
- Authored **Memory Service OpenAPI draft** defining envelope contract, endpoints, and payload schemas (`docs/memory-service-openapi.yaml`).
- Introduced **Prisma data model** for profiles, sessions, plans, memory nodes, artifacts, and audit logs (`prisma/schema.prisma`).
- Created **Supabase-ready environment template** (`.env.example`) and installed `@supabase/supabase-js` in project dependencies (`package.json`, `package-lock.json`).
- Published **TypeScript memory types** plus a **MemoryService client stub** to interact with the future backend (`src/types/memory.ts`, `src/lib/memoryService.ts`).
- Updated root README with pointer to new documentation (`README.md`).
- Replaced legacy database helpers with Prisma-backed session/message/memory utilities (`src/lib/db.ts`) and stood up the **memory API mock routes** (`src/app/api/memory/*`) that persist context, plans, media, and audit events through the new schema.
- Logged the evolving workstream to keep all agents aligned (`docs/UPDATE_LOG.md`).
- Refactored `/api/chat` to POST-based orchestration with Memory Service persistence and streaming capture (`src/app/api/chat/route.ts`), and updated the streamed chat hook/page to pass session + tenant identifiers into the new contract (`src/hooks/useStreamedChat.ts`, `src/app/page.tsx`).
- Chat UI now hydrates from the shared memory service, reloading history after each exchange and honoring persisted session IDs (override via `?session=`) for longitudinal demos (`src/app/page.tsx`).
- Introduced ElevenLabs voice pipeline stub (`src/lib/voice.ts`, `src/app/api/voice/route.ts`) so assistant turns can trigger TTS and broadcast audio artifacts into shared memory; added env scaffolding for ElevenLabs/HeyGen.

> Next Focus: run Supabase/Aurora migrations (`npx prisma migrate dev`), hook the voice endpoint into the chat loop (plus HeyGen avatar orchestration), and surface the Manus-style plan tree in the UI. Note: `npx prisma generate` can fail in the sandbox due to cache write permissions—run locally if needed.

## 2025-09-27 — ChatGPT
- Hardened the voice pipeline with agent-aware ElevenLabs voice selection and persisted audio artifacts/events in memory (`src/app/api/voice/route.ts`, `src/server/agents.ts`, `.env.example`).
- Introduced HeyGen video generation helper plus REST surface so salon turns can spawn avatar renders and poll status (`src/lib/heygen.ts`, `src/app/api/heygen/talk/route.ts`, `src/app/page.tsx`).
- Refreshed the chat UI with identity cards, inline audio playback, and HeyGen controls anchored to session memory state (`src/app/page.tsx`, `src/components/AgentIdentityCard.tsx`).
- Delivered narrator module upgrades: PDF cleanup heuristics, optional PDF2Audio GPT scripting, and UI toggle for enhanced scripts (`src/app/api/narrator/extract/route.ts`, `src/app/narrator/page.tsx`, `src/lib/pdf2audio.ts`, `src/types/pdf2audio.ts`).
- Added arXiv-aware ingestion: normalized ID detection, metadata lookup, auto PDF resolution, and UI surfacing of abstracts (`src/lib/arxiv.ts`, `src/app/api/narrator/extract/route.ts`, `src/app/narrator/page.tsx`, `src/types/arxiv.ts`).
- Expanded tooling/infra: project-level ESLint config, tightened TypeScript settings, pdf-parse declarations, and env scaffolding for new services (`.eslintrc.json`, `tsconfig.json`, `types/pdf-parse.d.ts`, `.env.example`).
-  **ArXiv Integration** 
- Added normalization + metadata helper (src/lib/arxiv.ts, src/types/arxiv.ts) to resolve arXiv IDs, fetch Atom metadata, and build canonical PDF/abs URLs. Narrator API now detects arXiv inputs automatically, fetches metadata, downloads the proper PDF, and returns abstract/authors alongside the existing sections and optional PDF2Audio script (src/app/api/ narrator/extract/route.ts). Narrator UI renders arXiv details (title, authors, abstract links) when available, alongside the GPT-enhanced script toggle (src/app/narrator/page.tsx).

> Next Focus: link the local Supabase to the new cloud project, surface the Manus plan-tree UI, consider arXiv-reader ingestion for metadata enrichment, and productionize HeyGen/PDF2Audio credentials.

### Upcoming (per PRD)
- Link local Supabase instance to new cloud project and push Prisma migrations (PRD M0).
- Build Manus plan tree UI/visualizer and hook into Memory Service plan updates (PRD M3).
- Add safety/observability UI elements (stop controls, plan audit trail) for demo hardening (PRD M4).
- Integrate optional arXiv reader workflows if deeper metadata/nav required.

## 2025-10-14 — ChatGPT
- Swapped the mock voice container for the real NeuTTS-Air integration. The FastAPI service now streams audio for GET/POST `/speak.wav`, exposes `/health`, and falls back to bundled samples until custom references are supplied. Model loading happens in a background thread so health checks immediately return `{ "status": "initializing" }` until weights finish downloading (`voice/app.py`).
- Docker image installs `curl`, clones upstream NeuTTS, adds the FastAPI app, and the compose stack builds it via the main `Dockerfile` with a healthcheck pinned to IPv4 (`voice/Dockerfile`, `docker-compose.yml`).
- `/api/voice` now prefers the local NeuTTS endpoint at `http://127.0.0.1:9009/speak.wav`, falling back to ElevenLabs if the local service is unavailable, while persisting artifacts in the Memory Service as before (`src/app/api/voice/route.ts`).
- Verified synthesis end-to-end with `curl -4 http://127.0.0.1:9009/speak.wav` (writes `/tmp/neutts-test.wav`) and with the new `/health` checks.

## 2025-10-15 — ChatGPT
- Added a declarative model registry backed by `config/models.yml` with runtime loader utilities (`src/config/modelRegistry.ts`) and exposed it via `/api/models` so UI and services share a single source of truth.
- Updated the chat UI with a model picker that respects Safe Mode (local-only filtering), integrates with the new registry, and carries selection through the optimistic chat flow (`src/app/page.tsx`, `src/components/Composer.tsx`).
- Extended the streaming chat route to honor explicit model selections, tag memories with scope + model metadata, and execute additional `@model` mentions with attribution events (`src/app/api/chat/route.ts`, `src/hooks/useStreamedChat.ts`).
- Introduced a local OpenAI-compatible adapter (`src/lib/adapters/local.ts`) and registry-aware provider routing for Safe Mode switching.
- Surface provider health badges in the picker via `/api/health` polling and propagated tool overrides (`#tool=something`) from the prompt to the chat route so Safe Mode can block cloud tools while preserving metadata.
