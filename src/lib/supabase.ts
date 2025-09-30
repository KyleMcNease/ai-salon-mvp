import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.')
}

// Client-side Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server-side Supabase client with service role key (for admin operations)
export const supabaseAdmin = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// Database helper - check connection status
export async function testSupabaseConnection() {
  try {
    // Test basic connectivity with a simple query
    const { data, error } = await supabase
      .from('Profile')
      .select('id')
      .limit(1)

    if (error) {
      // If table doesn't exist, that's OK - means connection works but tables not created via Supabase
      if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
        return {
          success: true,
          message: 'Supabase connection successful (tables managed by Prisma)'
        }
      }
      throw error
    }

    return {
      success: true,
      message: `Supabase connection successful. Found ${data?.length || 0} profiles.`
    }
  } catch (error) {
    return {
      success: false,
      message: `Supabase connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

// Environment detection
export const isLocalSupabase = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')

export const config = {
  url: supabaseUrl,
  isLocal: isLocalSupabase,
  hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY
}