import type { AppState } from '../types'
import { createStarterState } from '../seed/starterState'
import { parseAppState, saveState } from '../storage'
import { getSupabase, isCloudEnabled } from '../lib/supabase'

export { isCloudEnabled }

interface CloudRow {
  user_id: string
  state: unknown
  updated_at: string
}

/**
 * Lae kasutaja andmed Supabasest.
 * Kui pilves pole rida (uus kasutaja) → Argo/Salakivi algmall isikliku koopiana.
 */
export async function loadCloudState(userId: string): Promise<AppState> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('user_app_state')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error

  if (data?.state) {
    const parsed = parseAppState(data.state)
    saveState(parsed)
    return parsed
  }

  // Uus konto: alati värske algmall (mitte teise inimese localStorage).
  const initial = createStarterState()
  await saveCloudState(userId, initial)
  return initial
}

/** Salvesta kasutaja andmed Supabase'i (upsert). */
export async function saveCloudState(userId: string, state: AppState): Promise<void> {
  saveState(state)
  const supabase = getSupabase()
  const row: Pick<CloudRow, 'user_id' | 'state'> = {
    user_id: userId,
    state,
  }
  const { error } = await supabase.from('user_app_state').upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}
