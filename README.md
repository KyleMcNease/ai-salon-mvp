# AI Salon (SCRIBE) - Multi-LLM Chat Interface

> **2025-09 Update:** For the latest architecture and milestone plan, see `docs/AI_Salon_SCRIBE_PRD.md` and `docs/memory-service-openapi.yaml`.

## 🎯 Overview

AI Salon is a sophisticated chat interface that enables seamless interaction with multiple Large Language Models (OpenAI, Anthropic, xAI) with features including:

- **Multi-Provider Support**: Switch between GPT-4, Claude, and Grok models
- **Real-time Streaming**: Stream responses with token counting
- **Conversation Persistence**: PostgreSQL-backed conversation history
- **Cost Tracking**: Per-message and per-conversation cost calculation
- **Memory System**: Store and retrieve context across conversations
- **Modern UI**: Clean, responsive interface with Tailwind CSS

## 🏗️ Architecture

```
ai-salon/
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── api/           # API Routes
│   │   │   ├── chat/      # Chat endpoint (streaming/non-streaming)
│   │   │   ├── memory/    # Memory management
│   │   │   └── embeddings/# Vector embeddings
│   │   ├── layout.tsx     # Root layout
│   │   └── page.tsx       # Main chat interface
│   ├── components/        # React Components
│   │   ├── Composer.tsx   # Message input
│   │   ├── Transcript.tsx # Conversation display
│   │   ├── Sidebar.tsx    # Conversation list
│   │   └── MemoryDrawer.tsx # Memory management UI
│   ├── lib/               # Core Libraries
│   │   ├── adapters/      # LLM Provider Adapters
│   │   ├── db.ts          # Database operations
│   │   ├── types.ts       # TypeScript definitions
│   │   └── cost.ts        # Cost calculations
│   └── store/             # Zustand State Management
└── prisma/                # Database Schema
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- PostgreSQL database
- API keys for desired LLM providers

### Installation

1. **Clone and Install Dependencies**
```bash
cd /Users/kylemcnease/ClaudeSandbox/SCRIBE/ai-salon
npm install
```

2. **Configure Environment Variables**
```bash
cp .env.local.example .env.local
# Edit .env.local with your API keys and database URL
```

3. **Setup Database**
```bash
# Push schema to database
npm run db:push

# Or run migrations
npm run db:migrate
```

4. **Start Development Server**
```bash
npm run dev
# Open http://localhost:3000
```

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/ai_salon"

# LLM Providers
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
XAI_API_KEY="xai-..."

# Optional
OPENAI_EMBEDDINGS_API_KEY=""
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### Supported Models

| Provider | Model | Context Window | Input Cost/1k | Output Cost/1k |
|----------|-------|----------------|---------------|----------------|
| OpenAI | GPT-4 Turbo | 128k | $0.01 | $0.03 |
| OpenAI | GPT-4 | 8k | $0.03 | $0.06 |
| OpenAI | GPT-3.5 Turbo | 16k | $0.0005 | $0.0015 |
| Anthropic | Claude 3 Opus | 200k | $0.015 | $0.075 |
| Anthropic | Claude 3 Sonnet | 200k | $0.003 | $0.015 |
| Anthropic | Claude 3 Haiku | 200k | $0.00025 | $0.00125 |
| xAI | Grok-1 | 8k | $0.05 | $0.15 |

## 📡 API Endpoints

### Chat Endpoint
```typescript
POST /api/chat
{
  "messages": Message[],
  "provider": "openai" | "anthropic" | "xai",
  "model": string,
  "stream": boolean,
  "temperature": number,
  "maxTokens": number,
  "conversationId": string?
}
```

### Memory Endpoint
```typescript
POST /api/memory
GET /api/memory
DELETE /api/memory/:key
```

### Embeddings Endpoint
```typescript
POST /api/embeddings
{
  "text": string,
  "provider": "openai",
  "model": "text-embedding-3-small"
}
```

## 🔄 Git Workflow

### Initial Setup
```bash
# Initialize git repository
git init
git add .
git commit -m "Initial commit: AI Salon MVP structure"

# Add remote (create private repo on GitHub first)
git remote add origin https://github.com/yourusername/ai-salon.git
git branch -M main
git push -u origin main
```

### Development Workflow
```bash
# Create feature branch
git checkout -b feature/your-feature

# Make changes and commit
git add .
git commit -m "feat: description of changes"

# Push and create PR
git push origin feature/your-feature
```

### Commit Convention
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Build/config changes

## 🧪 Testing

```bash
# Run tests (to be implemented)
npm test

# Run type checking
npm run type-check

# Run linting
npm run lint
```

## 📈 Production Deployment

### Build for Production
```bash
npm run build
npm start
```

### Docker Deployment
```dockerfile
# Dockerfile (to be created)
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm ci --only=production
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 🔍 Monitoring & Analytics

- Cost tracking per conversation
- Token usage analytics
- Response time monitoring
- Error tracking and logging

## 🛣️ Roadmap

### Phase 1: MVP (Current)
- [x] Multi-provider chat interface
- [x] Streaming responses
- [x] Conversation persistence
- [x] Cost tracking

### Phase 2: Enhanced Features
- [ ] File uploads and processing
- [ ] RAG (Retrieval Augmented Generation)
- [ ] Function calling support
- [ ] Voice input/output

### Phase 3: Advanced Capabilities
- [ ] Agent orchestration
- [ ] Custom model fine-tuning
- [ ] Multi-modal support
- [ ] Collaborative features

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

Private repository - All rights reserved

## 🆘 Support

For issues or questions, create an issue in the GitHub repository.

---

**Note**: This is an MVP implementation. Production deployment requires additional security, monitoring, and optimization considerations.
