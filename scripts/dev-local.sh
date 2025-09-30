#!/bin/bash

# Local development setup script
echo "🚀 Starting AI Salon with local Supabase..."

# Export environment variables for local development
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_ANON_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"

# Check if Supabase is running
if ! curl -s http://127.0.0.1:54321/health > /dev/null; then
  echo "⚠️  Supabase local instance not running. Starting it..."
  supabase start
  sleep 5
fi

echo "✅ Environment configured for local Supabase"
echo "📊 Database URL: $DATABASE_URL"
echo "🔗 Supabase URL: $SUPABASE_URL"
echo ""

# Start the development server
npm run dev