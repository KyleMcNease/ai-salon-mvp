# AI Salon "SCRIBE" Orchestration Platform — Product Requirements Document (v0.2)

_Last updated: 2025-09-25 by ChatGPT_

---

## 1. Context & Intent

### 1.1 Purpose
AI Salon (codename **SCRIBE**) is the meta-layer that coordinates best-in-class foundation models (GPT‑5, Claude Code, Grok, future entrants) into an additive, safe, and auditable intelligence fabric. The platform must:
- Deliver **cross-session persistent memory** that every model can read/write.
- Support **multi-model orchestration** with interruptibility and Manus-style plan/act/verify loops.
- Provide **human-first controls** (visibility, stop, override) while enabling autonomous execution when authorized.
- Showcase **voice-enabled collaboration** so observers can experience the “cognitive salon” in real time.

### 1.2 Design Principles
1. **Additive Intelligence:** treat every model as a specialist; orchestrate for consensus rather than winner-take-all.
2. **Latent AGI Activation:** assume the primitives already exist (LLMs, tools, storage); provide the orchestration that unlocks them.
3. **Safety by Construction:** enforce immutable sources, execution sandboxes, and audit trails.
4. **Vendor Agnostic:** swap models/providers without breaking the contract.
5. **Composable Infrastructure:** local-first development, cloud-first deployment (AWS + Supabase for rapid iteration).

### 1.3 Current State
- Next.js 14 app scaffolded in `ai-salon/` with placeholder memory + adapters.
- Supabase adoption attempted but reverted; no persistent storage currently wired.
- Docs capture v0.1 plan but lack updated architecture, API contract, or task breakdown.

---

## 2. Target Outcomes (MVP-Δ Release)
1. **Memory Service Contract Implemented** — OpenAPI spec + Next.js client that reads/writes to a persistent store (Supabase → Aurora/Qdrant bridge).
2. **Single-Model Flow Stabilized** — ai-salon UI uses the Memory Service and Supabase to persist chats; GPT‑5 adapter working end-to-end.
3. **Panel Orchestration Skeleton** — Workflow scaffold (plan → parallel tasks → merge) with Manus-style actions logged and interruptible.
4. **Voice Demonstration** — Polly-integrated audio for assistant turns with synchronized transcripts.
5. **Observability & Safety** — basic audit log, plan tree visualization, and manual stop controls in UI.

Success Metric: run a 10-minute demo session where Kyle + GPT‑5 + Claude collaborate, memory persists between reloads, voice playback available, and plan tree view updates live.

---

## 3. System Architecture (High-Level)

### 3.1 Logical Layers
- **Client (Next.js / React):** chat UI, plan tree, voice player, operator controls.
- **Salon API (Next.js Route Handlers):** routing to providers, Memory Service proxy, Supabase integration, WebSocket events.
- **Memory Service (AWS Lambda / FastAPI, mocked locally):** authoritative context store, delta compression, plan kernel, event publisher.
- **Data Fabric:** Supabase PostgreSQL (dev) → AWS Aurora Serverless v2 (prod); Qdrant vector store (EC2) or Bedrock Knowledge Bases; S3 for audio & artifacts.
- **Event Fabric:** AWS EventBridge (prod) / In-app Event Bus (dev) broadcasting SCRIBE action events.

### 3.2 Key Components
- **Memory Contract:** request envelope `{version, tenant_id, session_id, actor, domain_tags[], model_caps, payload}` with `payload` supporting `context_entries`, `memory_nodes`, `plan_updates`, `media_artifacts`.
- **Planner Kernel:** Manus-style state machine (PLAN → EXECUTE → VERIFY → INTERRUPT). Plans persisted alongside context versions for resume/branching.
- **Provider Registry:** GPT‑5 (Azure OpenAI), Claude (Anthropic), Grok (X.AI), with capability metadata (max tokens, modalities, costs).
- **Voice Orchestrator:** Lambda triggered post-response to generate Polly (or provider-specific) audio; updates Memory Service with media metadata.
- **Supabase Layer:** tables for `sessions`, `messages`, `plans`, `artifacts`, `audits`; RLS enforced for multi-tenant readiness.

---

## 4. Detailed Requirements

### 4.1 Memory Service
- **APIs (initial Next.js mock, moving to AWS Lambda):**
  - `POST /memory/save-context`
  - `POST /memory/retrieve-context`
  - `POST /memory/save-plan`
  - `POST /memory/resolve-conflict`
  - `POST /memory/broadcast-update`
- **Features:**
  - Delta compression (Brotli) with `context_version` tracking per `(tenant, session, model)`.
  - CRDT-based merge for markdown/shared knowledge sync.
  - Importance scoring & decay scheduled job (EventBridge).
  - Conflict queue with human adjudication hook.

### 4.2 Supabase Integration (Phase 0 Stabilization)
- Configure Supabase client (`NEXT_PUBLIC_SUPABASE_URL`, service role key via server-side env).
- Schema migration (SQL + Prisma schema mirror) covering:
  - `profiles`, `sessions`, `messages`, `plans`, `plan_steps`, `artifacts`, `memory_nodes`, `audits`.
- Replace in-memory memory functions with Supabase-backed implementations.
- Unit tests against local Supabase (or Supabase test harness) for CRUD + pagination.

### 4.3 ai-salon Frontend Enhancements
- **Chat View:** streaming responses, persisted transcripts, memory drawer referencing Memory Service.
- **Plan Tree Drawer:** visualizes Manus loop (stage, owner model, timestamps).
- **Voice Player:** audio playback per assistant turn; WebSocket/Server-Sent Events signal when audio ready.
- **Control Bar:** pause/resume plan, force summarize, trigger federated search (federal RAG hook).

### 4.4 Orchestration Workflow
- Implement `panelSession` controller:
  1. Fetch snapshot from Memory Service.
  2. Launch model tasks in barriered parallelism (Step Functions in prod, Promise.all mock in dev).
  3. Deduplicate via vector similarity + SimHash.
  4. Log conflicts → Memory Service queue.
  5. Emit consolidated result to client + Supabase.

### 4.5 Voice Integration
- Add `voice` module using AWS SDK v3 Polly client (mocked locally).
- Store generated audio in S3 (dev fallback: local `/tmp/audio`), persist metadata to Supabase `artifacts`.
- UI subscribes to memory updates to fetch audio URL; degrade gracefully if processing fails.

### 4.6 Observability & Safety
- Audit log entries on every tool invocation / model response.
- Manual stop triggers cancellation signals to ongoing tasks.
- Configurable guardrails for token budgets, execution timeouts, sandbox limits.

---

## 5. Milestones & Deliverables

| Milestone | Description | Key Deliverables | Target |
|-----------|-------------|------------------|--------|
| **M0 – Stabilize Data Layer** | Restore Supabase integration & schema migrations | Prisma schema + SQL migrations, Supabase client, tests, updated `.env.example` | Week 1 |
| **M1 – Memory Service Contract** | OpenAPI spec + Next.js route mock implementing save/retrieve with compression | `docs/memory-service-openapi.yaml`, `/api/memory/*` handlers, shared types | Week 2 |
| **M2 – Single-Model E2E** | GPT‑5 chat flows through Memory Service + Supabase | Updated adapters, streaming UI, audit log, persisted sessions | Week 3 |
| **M3 – Panel Skeleton & Voice** | Parallel orchestration scaffold + Polly audio pipeline | `panelSession` controller, voice Lambda mock, UI audio playback | Week 4 |
| **M4 – Demo Hardening** | Conflict resolution queue, plan tree UI, operator controls, polish | Dashboard updates, observability, demo script | Week 5 |

---

## 6. Implementation Notes
- **Branching:** create feature branches per milestone (e.g., `feature/m0-supabase-stabilization`).
- **Testing:**
  - Unit tests (`vitest`) for memory functions & adapters.
  - Integration harness simulating multi-model session.
  - Voice pipeline smoke test (mock Polly in CI).
- **Tooling:** prefer `pnpm` (consider migrating from npm) for workspace management; use `supabase` CLI for local dev.
- **Deployment:** Next.js on Vercel (preview) → AWS Amplify or custom ECS for prod once Memory Service externalized.

---

## 7. Open Questions / Follow-Ups
1. Confirm final deployment target for Memory Service (Lambda vs Fargate) before Week 3.
2. Determine priority order for additional domain connectors (federal RAG vs research corpus).
3. Select default voices per agent (differentiate GPT‑5/Claude/Grok in demo).
4. Validate security posture for Supabase service role usage in Next.js API routes.

---

## 8. Appendices
- **A. References:** Manus AI forensic notes, AI Salon architecture dossiers, federal RAG runbook.
- **B. Glossary:**
  - **Plan Kernel:** Manus-inspired task graph persisted in memory service.
  - **Barriered Parallelism:** models execute simultaneously but outputs merged only after all complete.
  - **Conflict Queue:** list of contradictory statements awaiting human adjudication.
- **C. Artifacts to Produce Next:**
  - OpenAPI spec file.
  - Prisma schema + migration scripts.
  - Supabase SQL seed.
  - Memory Service client library (`lib/memoryService.ts`).
  - Panel orchestration controller.
  - Voice orchestration Lambda stub.

---

_End of PRD_
