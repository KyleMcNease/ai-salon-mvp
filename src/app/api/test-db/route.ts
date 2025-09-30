import { NextResponse } from 'next/server'
import { testSupabaseConnection, config } from '@/lib/supabase'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    // Test Supabase connection
    const supabaseTest = await testSupabaseConnection()

    // Test Prisma connection
    let prismaTest
    try {
      const profileCount = await prisma.profile.count()
      prismaTest = {
        success: true,
        message: `Prisma connection successful. Found ${profileCount} profiles.`
      }
    } catch (error) {
      prismaTest = {
        success: false,
        message: `Prisma connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      supabase: {
        ...supabaseTest,
        config: {
          url: config.url,
          isLocal: config.isLocal,
          hasServiceRole: config.hasServiceRole
        }
      },
      prisma: prismaTest,
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL ? '[CONFIGURED]' : '[MISSING]',
        SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '[MISSING]'
      }
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Database test failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}