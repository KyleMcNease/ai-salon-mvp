# Local Supabase Setup - AI Salon MVP

## ✅ Setup Complete

Your AI Salon MVP now has a fully configured local Supabase environment that works alongside your existing Prisma setup.

## What's Configured

### 🗄️ Database Stack
- **Supabase Local**: Running on `http://127.0.0.1:54321`
- **PostgreSQL**: Local database on port `54322`
- **Prisma**: ORM managing database schema and queries
- **Supabase Client**: Available for auth, storage, and realtime features

### 🔧 Services Running
- **API Gateway**: `http://127.0.0.1:54321`
- **Database**: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- **Studio**: `http://127.0.0.1:54323` (Database management UI)
- **Email Testing**: `http://127.0.0.1:54324` (Mailpit)

### 📝 Scripts Available
```bash
# Start development with local Supabase
npm run dev:local

# Supabase management
npm run supabase:start
npm run supabase:stop
npm run supabase:status

# Database management
npm run db:push      # Push Prisma schema to database
npm run db:studio    # Open Prisma Studio
```

## Usage

### Development Workflow
1. **Start local development**:
   ```bash
   npm run dev:local
   ```
   This automatically:
   - Starts Supabase if not running
   - Sets up environment variables
   - Starts Next.js development server

2. **Access services**:
   - App: `http://localhost:3000`
   - Database UI: `http://127.0.0.1:54323`
   - API Test: `http://localhost:3000/api/test-db`

### Database Management
- **Schema changes**: Use Prisma migrations (`npm run db:migrate`)
- **Direct DB access**: Use Supabase Studio (`http://127.0.0.1:54323`)
- **Data seeding**: Use Prisma seed script (`npm run db:seed`)

## Architecture

### Hybrid Setup Benefits
- **Prisma**: Handles schema management, type safety, and complex queries
- **Supabase**: Provides auth, realtime, storage, and edge functions
- **Local Development**: Full stack runs locally with hot reload

### Files Created/Modified
- `supabase/config.toml` - Supabase configuration
- `src/lib/supabase.ts` - Supabase client setup
- `scripts/dev-local.sh` - Local development script
- `.env.local` - Local environment variables
- `src/app/api/test-db/route.ts` - Connection test endpoint

## Next Steps

### To Connect to Cloud Supabase
1. Update `.env` with your cloud Supabase credentials
2. Run `npm run dev` (without `:local`) to use cloud instance
3. Push your schema: `npm run db:push`

### 🔌 MCP Integration Configured ✅

The Model Context Protocol (MCP) is now set up to work with your local Supabase instance, allowing AI assistants like Claude to directly query and interact with your database.

#### Available MCP Servers
1. **Local Postgres MCP**: Direct database access via SQL queries
2. **Cloud Supabase MCP**: Full Supabase API access (for production)

#### MCP Configuration Files
- `mcp-config.json` - Complete MCP server configuration
- `scripts/test-mcp.js` - MCP connection test script

#### Testing MCP Connection
```bash
# Test the MCP server connection
npm run mcp:test

# Manually start MCP server for AI tool connection
npm run mcp:local
```

#### MCP Server Output Example
```json
{
  "result": {
    "tools": [
      {
        "name": "query",
        "description": "Run a read-only SQL query",
        "inputSchema": {
          "type": "object",
          "properties": {
            "sql": { "type": "string" }
          }
        }
      }
    ]
  }
}
```

#### Using with AI Tools
Your `mcp-config.json` file contains the configuration for:
- **Claude Desktop**: Copy config to Claude's settings
- **Cursor**: Use the MCP server settings
- **Other MCP-compatible tools**: Use the connection string directly

## Status Check
Run `http://localhost:3000/api/test-db` to verify:
- ✅ Prisma connection (should show success with 0 profiles)
- ⚠️ Supabase REST API (expected to show error since tables managed by Prisma)

This setup gives you the best of both worlds: Prisma's excellent DX for database operations and Supabase's powerful additional services.