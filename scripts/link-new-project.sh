#!/bin/bash

echo "🔗 Linking to new Supabase project..."

# Get the new project reference ID from user
echo "📋 Please provide your new project details:"
read -p "Project Reference ID (from Settings > General): " PROJECT_REF
read -p "Database Password: " -s DB_PASSWORD
echo ""

# Validate inputs
if [ -z "$PROJECT_REF" ]; then
  echo "❌ Project reference ID is required"
  exit 1
fi

if [ -z "$DB_PASSWORD" ]; then
  echo "❌ Database password is required"
  exit 1
fi

echo "🔗 Linking local Supabase to project: $PROJECT_REF"

# Link the project
supabase link --project-ref $PROJECT_REF

if [ $? -eq 0 ]; then
  echo "✅ Successfully linked to project!"

  # Create new environment file for production
  echo "📝 Creating .env.production..."
  cat > .env.production << EOF
# Production Supabase Configuration
SUPABASE_URL=https://${PROJECT_REF}.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://${PROJECT_REF}.supabase.co
DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require

# Get these from Settings > API in your Supabase dashboard
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Your existing API keys
OPENAI_API_KEY=sk-REPLACE_ME
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
XAI_API_KEY=sk-xai-REPLACE_ME

# Model defaults
MODEL_NAME_OPENAI=gpt-4o-mini
MODEL_NAME_ANTHROPIC=claude-sonnet-4-20250514
MODEL_NAME_XAI=grok-4-0709

# App Configuration
NEXT_PUBLIC_APP_NAME="AI Salon"
EOF

  echo "✅ Created .env.production with new project details"
  echo ""
  echo "📋 Next steps:"
  echo "1. Go to your Supabase dashboard: https://app.supabase.com/project/${PROJECT_REF}"
  echo "2. Copy the anon key and service role key from Settings > API"
  echo "3. Update .env.production with those keys"
  echo "4. Run: npm run db:push (to deploy schema to new project)"
  echo "5. Run: npm run dev (to test with new project)"

else
  echo "❌ Failed to link project. Check your project reference ID."
  exit 1
fi
