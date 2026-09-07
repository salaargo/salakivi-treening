import type { AppState } from '../types'
import { createStarterState } from '../seed/starterState'
import { parseAppState, saveState } from '../storage'
import { getSupabase, isCloudEnabled } from '../lib/supabase'
import { isAdminEmail } from '../admin'

export { isCloudEnabled }

interface CloudRow {
  user_id: string
  state: unknown
  updated_at: string
}

export interface UserProfile {
  user_id: string
  email: string
  created_at: string
  last_seen_at: string
}

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|does not exist|schema cache/i.test(message)
  )
}

/** Kavad/faasid/nädalamallid ilma treeninglogideta — uue kasutaja näidis. */
export function programOnlyState(state: AppState): AppState {
  return {
    phases: state.phases,
    plans: state.plans,
    weeks: state.weeks,
    useRotatingWeeks: state.useRotatingWeeks,
    cycleStartDate: state.cycleStartDate,
    logs: {},
  }
}

async function loadProgramTemplate(): Promise<AppState | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.from('program_template').select('state').eq('id', 1).maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return null
    throw error
  }
  if (!data?.state) return null
  return programOnlyState(parseAppState(data.state))
}

export async function publishProgramTemplate(state: AppState): Promise<void> {
  const supabase = getSupabase()
  const { data: auth } = await supabase.auth.getUser()
  const row = {
    id: 1,
    state: programOnlyState(state),
    updated_by: auth.user?.id ?? null,
  }
  const { error } = await supabase.from('program_template').upsert(row, { onConflict: 'id' })
  if (error) throw error
}

export async function touchProfile(userId: string, email?: string | null): Promise<void> {
  const supabase = getSupabase()
  const now = new Date().toISOString()
  const row: { user_id: string; last_seen_at: string; email?: string } = {
    user_id: userId,
    last_seen_at: now,
  }
  if (email) row.email = email
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id' })
  if (error && !isMissingRelation(error)) {
    console.warn('profiles upsert', error.message)
  }
}

export async function listRegisteredUsers(): Promise<UserProfile[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, created_at, last_seen_at')
    .order('last_seen_at', { ascending: false })

  if (error) {
    if (isMissingRelation(error)) {
      throw new Error(
        'Admini tabelid pole veel Supabases. Käivita supabase/schema.sql (või supabase/migration_admin.sql) SQL Editoris.',
      )
    }
    throw error
  }

  return (data ?? []).map((row) => ({
    user_id: row.user_id as string,
    email: (row.email as string | null) ?? '—',
    created_at: row.created_at as string,
    last_seen_at: row.last_seen_at as string,
  }))
}

/**
 * Lae kasutaja andmed Supabasest.
 * Uus kasutaja saab Argo avaldatud näidiskavad (ilma logideta).
 */
export async function loadCloudState(userId: string): Promise<AppState> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('user_app_state')
    .select('state, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error

  const { data: auth } = await supabase.auth.getUser()
  const email = auth.user?.email ?? null
  void touchProfile(userId, email)

  if (data?.state) {
    const parsed = parseAppState(data.state)
    saveState(parsed)
    if (isAdminEmail(email)) {
      void ensureTemplateFromAdmin(parsed)
    }
    return parsed
  }

  const fromTemplate = await loadProgramTemplate()
  const initial = fromTemplate ?? createStarterState()
  await saveCloudState(userId, initial)
  return initial
}

async function ensureTemplateFromAdmin(state: AppState): Promise<void> {
  try {
    const existing = await loadProgramTemplate()
    if (existing) return
    await publishProgramTemplate(state)
  } catch {
    /* Tabelit pole veel või puudub õigus — äpp jääb tööle. */
  }
}

/** Salvesta kasutaja andmed Supabase'i (upsert). Admin uuendab ka näidiskava. */
export async function saveCloudState(userId: string, state: AppState): Promise<void> {
  saveState(state)
  const supabase = getSupabase()
  const row: Pick<CloudRow, 'user_id' | 'state'> = {
    user_id: userId,
    state,
  }
  const { error } = await supabase.from('user_app_state').upsert(row, { onConflict: 'user_id' })
  if (error) throw error

  const { data: auth } = await supabase.auth.getUser()
  const email = auth.user?.email ?? null
  await touchProfile(userId, email)

  if (isAdminEmail(email)) {
    try {
      await publishProgramTemplate(state)
    } catch {
      /* Näidiskava tabelit pole veel või puudub õigus. */
    }
  }
}
