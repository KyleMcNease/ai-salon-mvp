# 🆕 Creating Fresh Supabase Project

Since your current cloud Supabase project is having issues and you don't have any data yet, creating a fresh project is the best approach.

## ✅ Why This Makes Sense

- **No data loss risk** - Your database is empty
- **Clean configuration** - No legacy issues to debug
- **Better organization** - Fresh start for AI Salon MVP
- **Easier maintenance** - Known good configuration

## 🚀 Step-by-Step Process

### 1. Authenticate with Supabase
```bash
supabase login
```
This opens your browser for authentication.

### 2. Create New Project
**Via Supabase Dashboard (Recommended):**
1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Click **"New Project"**
3. Choose your organization
4. Name: **"ai-salon-mvp"**
5. Create a strong database password (save it!)
6. Choose your preferred region
7. Click **"Create new project"**

Wait for project creation (usually 2-3 minutes).

### 3. Link Local Setup to New Project
```bash
npm run supabase:link
```

This script will:
- Prompt for your project reference ID
- Prompt for your database password
- Link your local setup to the new project
- Create `.env.production` with correct URLs
- Guide you through the final steps

### 4. Get API Keys
1. Go to your new project dashboard
2. Navigate to **Settings → API**
3. Copy the **anon key** and **service role key**
4. Update `.env.production` with these keys

### 5. Deploy Your Schema
```bash
# Switch to production environment and push schema
npm run dev:production
npm run db:push
```

### 6. Test Everything
```bash
# Test the new production connection
curl http://localhost:3000/api/test-db
```

## 🔄 Development Workflows

### Local Development
```bash
npm run dev:local    # Uses local Supabase (127.0.0.1)
```

### Production Testing
```bash
npm run dev:production    # Uses new cloud project
```

### Switch Between Environments
- **Local**: Uses `.env.local` automatically
- **Production**: Run `npm run dev:production` to copy `.env.production` to `.env`

## 🔌 MCP Configuration

Your MCP setup will work with both:

### Local Development
```json
{
  "mcpServers": {
    "supabase-local": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"]
    }
  }
}
```

### Production
```json
{
  "mcpServers": {
    "supabase-prod": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase", "--read-only"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "your-access-token"
      }
    }
  }
}
```

## 🎯 Benefits of Fresh Project

1. **Clean URLs** - No confusion with old project references
2. **Fresh API keys** - No authentication issues
3. **Latest features** - New project gets latest Supabase features
4. **Better organization** - Dedicated project for this MVP
5. **Easier debugging** - Known clean state

## 📋 Checklist

- [ ] Login to Supabase CLI (`supabase login`)
- [ ] Create new project via dashboard
- [ ] Run `npm run supabase:link`
- [ ] Update `.env.production` with API keys
- [ ] Deploy schema with `npm run db:push`
- [ ] Test connection with `/api/test-db`
- [ ] Verify MCP integration works

Your fresh Supabase project will be much more reliable and easier to work with!