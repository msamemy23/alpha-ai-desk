// Re-export server-side Supabase client from main supabase module
// This file exists so API routes can import from '@/lib/supabase-service'
export { getServiceClient } from './supabase'
