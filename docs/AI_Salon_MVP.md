# AI Salon (SCRIBE) — MVP Build Plan & Starter Code (v0.1)

**File:** `docs/AI_Salon_MVP.md`

This Markdown file contains the full build plan, directory structure, environment configuration, schema definitions, adapter stubs, API routes, UI components, and implementation notes for the MVP Cognitive Salon.

**Directory Layout:**

```
project_root/
  docs/
    AI_Salon_MVP.md
  ai-salon/
    .env.local.example
    src/
      app/
        layout.tsx
        page.tsx
        api/
          chat/route.ts
          memory/route.ts
          embeddings/route.ts
      components/
        Composer.tsx
        Transcript.tsx
        MemoryDrawer.tsx
        Sidebar.tsx
        CostBadge.tsx
      lib/
        bus.ts
        memory.ts
        db.ts
        cost.ts
        adapters/
          index.ts
          openai.ts
          anthropic.ts
          xai.ts
        types.ts
      store/
        useAppStore.ts
    prisma/
    README.md
```

All code blocks and instructions from the original plan are preserved inside `docs/AI_Salon_MVP.md` for reference. The `ai-salon/` directory is ready to receive files exactly as outlined.

**Git Workflow Requirement:**

- Before pushing any changes, they must be approved in a review step.
- All commits should be made to a **private Git repository** for version tracking and security.
- Recommended process:
  1. Create a new branch for each feature or fix.
  2. Submit a Pull Request for review before merge to `main`.
  3. Tag releases that align with key milestones (e.g., MVP complete, v0.2, etc.).
- Include `.env.local` in `.gitignore` to protect API keys.

This ensures that even if this chat session ends or hits token limits, you can continue development directly from the Markdown file, follow the directory scaffolding above, and maintain a secure, trackable workflow via Git.

