# AI Salon — README

## Overview

AI Salon is an MVP implementation of the Cognitive Salon concept — a unified interface for interacting with multiple AI providers (OpenAI, Anthropic, xAI) in one place, with persistent conversation memory and an extendable component structure.

## Features

* **Multi-provider support**: Easily switch between OpenAI, Anthropic, and xAI.
* **App Router API routes**: `/api/chat`, `/api/memory`, and `/api/embeddings` endpoints.
* **Modular architecture**: Components, adapters, and lib utilities are cleanly separated.
* **In-memory store**: Minimal store for conversation state, ready to be swapped for a database.
* **Environment config**: `.env.local.example` includes keys for each provider.

## Project Structure

```
ai-salon/
  src/
    app/           # Next.js App Router pages & API routes
    components/    # UI components
    lib/           # Core logic, adapters, and utilities
    store/         # State management
  .env.local.example
  commit_push.py

docs/
  AI_Salon_MVP.md  # Full build plan and notes
```

## Getting Started

1. Clone the repo or download the ZIP from GitHub.
2. Install dependencies:

```bash
npm install
```

3. Copy `.env.local.example` to `.env.local` and fill in your API keys.
4. Run the development server:

```bash
npm run dev
```

## Deployment

* Use `commit_push.py` to commit and push changes to the current branch.
* Recommended: create a new branch for features, open a Pull Request, and merge into `main` after review.

## Roadmap

* Real provider integrations for chat and embeddings.
* Persistent memory using Postgres + Prisma.
* Richer UI for managing and searching conversation history.
* Additional analytics and conversation insights.

## License

MIT
