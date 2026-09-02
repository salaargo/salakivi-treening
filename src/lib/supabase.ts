import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function isCloudEnabled(): boolean {
  return Boolean(url && anonKey)
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isCloudEnabled()) {
    throw new Error('Supabase pole seadistatud (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
  if (!client) {
    client = createClient(url!, anonKey!)
  }
  return client
}
