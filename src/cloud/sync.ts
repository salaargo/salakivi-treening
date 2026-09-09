import type { AppState } from '../types'
import { createStarterState } from '../seed/starterState'
import { parseAppState, saveState } from '../storage'
import { getSupabase, isCloudEnabled } from '../lib/supabase'
import { isAdminEmail } from '../admin'
import { getLatestLiveSnapshot } from '../live/remote'

export { isCloudEnabled }

interface CloudRow {
  user_id: string
  state: unknown
  updated_at: string
}

export interface UserProfile {
  user_id: string
  email: string
  display_name: string
  created_at: string
  last_seen_at: string
}

export function normalizeDisplayName(value?: string | null): string {
  if (!value) return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, 40)
}

export function displayNameFromMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return ''
  const keys = ['display_name', 'full_name', 'name'] as const
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string') {
      const name = normalizeDisplayName(value)
      if (name) return name
    }
  }
  return ''
}

function mapProfile(row: Record<string, unknown>): UserProfile {
  return {
    user_id: String(row.user_id ?? ''),
    email: (row.email as string | null) ?? '—',
    display_name: normalizeDisplayName(row.display_name as string | null),
    created_at: String(row.created_at ?? ''),
    last_seen_at: String(row.last_seen_at ?? ''),
  }
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

export async function touchProfile(
  userId: string,
  email?: string | null,
  displayName?: string | null,
): Promise<void> {
  const supabase = getSupabase()
  const now = new Date().toISOString()
  const row: { user_id: string; last_seen_at: string; email?: string; display_name?: string } = {
    user_id: userId,
    last_seen_at: now,
  }
  if (email) row.email = email
  const name = normalizeDisplayName(displayName)
  if (name) row.display_name = name
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id', defaultToNull: false })
  if (error && !isMissingRelation(error)) {
    console.warn('profiles upsert', error.message)
  }
}

export async function loadMyProfile(userId: string): Promise<UserProfile | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, display_name, created_at, last_seen_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isMissingRelation(error)) return null
    throw error
  }
  if (!data) return null
  return mapProfile(data)
}

export async function saveDisplayName(userId: string, email: string | null, name: string): Promise<string> {
  const displayName = normalizeDisplayName(name)
  if (displayName.length < 2) throw new Error('Sisesta oma nimi (vähemalt 2 märki).')

  const supabase = getSupabase()
  const { error } = await supabase.from('profiles').upsert(
    {
      user_id: userId,
      email: email ?? undefined,
      display_name: displayName,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id', defaultToNull: false },
  )
  if (error) throw error

  const { error: metaError } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  })
  if (metaError) console.warn('auth metadata', metaError.message)
  return displayName
}

export async function applyProgramTemplateToUser(userId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.rpc('apply_program_template_to_user', {
    target_user_id: userId,
  })
  if (error) {
    if (isMissingRelation(error) || /function .+ does not exist/i.test(error.message)) {
      throw new Error('Näidiskava andmise funktsioon pole veel Supabases. Käivita supabase/migration_names.sql.')
    }
    throw error
  }
}

export async function listRegisteredUsers(): Promise<UserProfile[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, display_name, created_at, last_seen_at')
    .order('last_seen_at', { ascending: false })

  if (error) {
    if (isMissingRelation(error)) {
      throw new Error(
        'Admini tabelid pole veel Supabases. Käivita supabase/schema.sql (või supabase/migration_names.sql) SQL Editoris.',
      )
    }
    throw error
  }

  return (data ?? []).map((row) => mapProfile(row as Record<string, unknown>))
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
  const metaName = displayNameFromMetadata(auth.user?.user_metadata as Record<string, unknown> | undefined)
  void touchProfile(userId, email, metaName || undefined)

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
  const live = getLatestLiveSnapshot()
  const row: Pick<CloudRow, 'user_id' | 'state'> = {
    user_id: userId,
    state: live ? { ...state, __live: live } : state,
  }
  const { error } = await supabase.from('user_app_state').upsert(row, { onConflict: 'user_id' })
  if (error) throw error

  const { data: auth } = await supabase.auth.getUser()
  const email = auth.user?.email ?? null
  const metaName = displayNameFromMetadata(auth.user?.user_metadata as Record<string, unknown> | undefined)
  await touchProfile(userId, email, metaName || undefined)

  if (isAdminEmail(email)) {
    try {
      await publishProgramTemplate(state)
    } catch {
      /* Näidiskava tabelit pole veel või puudub õigus. */
    }
  }
}
