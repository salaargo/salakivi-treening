import { getSupabase, isCloudEnabled } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { isWatchMode } from '../orientation'

export type RemoteCommandType = 'start' | 'tehtud' | 'skip-rest' | 'finish-exercise' | 'stop' | 'sync'

export interface LiveSnapshot {
  v: 1
  at: number
  dateKey: string
  flow: 'idle' | 'pick' | 'ready' | 'active' | 'resting' | 'sauna'
  planName?: string
  exerciseName?: string
  otherName?: string
  setNumber?: number
  totalRounds?: number
  remainingHint?: string
  remainingParts?: { name: string; left: number }[]
  nextHint?: string
  restSeconds?: number
  restEndsAt?: number
  remainingSets?: number
  seq?: number
  weightKg?: number
  machineName?: string
}

export interface LiveCommand {
  id: string
  type: RemoteCommandType
  at: number
}

const BC_NAME = 'salakivi-live'
const SNAP_KEY = 'salakivi-live-snap-v1'
const CMD_KEY = 'salakivi-live-cmd-v1'
const TABLE = 'live_remote'

type Envelope = { kind: 'snap'; snap: LiveSnapshot } | { kind: 'cmd'; cmd: LiveCommand }

const snapListeners = new Set<(snap: LiveSnapshot) => void>()
const cmdListeners = new Set<(cmd: LiveCommand) => void>()
const seenCommands = new Set<string>()

let bc: BroadcastChannel | null = null
let supabaseChannel: RealtimeChannel | null = null
let currentUserId: string | null = null
let tableMissing = false
let lastSnap: LiveSnapshot | null = null
let publishSeq = 0

function snapRank(snap: LiveSnapshot): number {
  return snap.seq ?? snap.at
}

/** Vanem hetkeseis ei tohi kella Start/Tehtud peale tagasi keerata. */
function applySnap(snap: LiveSnapshot): boolean {
  if (!snap || snap.v !== 1) return false
  if (lastSnap && snapRank(snap) < snapRank(lastSnap)) return false
  lastSnap = snap
  if (!isWatchMode()) {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(snap))
    } catch {
      /* ignore quota */
    }
  }
  snapListeners.forEach((fn) => fn(snap))
  return true
}

function emit(env: Envelope): void {
  if (env.kind === 'snap') {
    applySnap(env.snap)
    return
  }
  if (!env.cmd?.id || seenCommands.has(env.cmd.id)) return
  seenCommands.add(env.cmd.id)
  if (seenCommands.size > 80) {
    const first = seenCommands.values().next().value
    if (first) seenCommands.delete(first)
  }
  cmdListeners.forEach((fn) => fn(env.cmd))
}

function getBc(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!bc) {
    bc = new BroadcastChannel(BC_NAME)
    bc.addEventListener('message', (ev: MessageEvent<Envelope>) => {
      if (ev.data?.kind === 'snap' || ev.data?.kind === 'cmd') emit(ev.data)
    })
  }
  return bc
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

/** Kella jaoks: viimane seis jääb kehtima, pausi lõppaeg tiksub kohalikult. */
export function snapshotIsFresh(snap: LiveSnapshot | null, now = Date.now()): snap is LiveSnapshot {
  if (!snap || snap.flow === 'idle') return false
  if (snap.flow === 'resting' && snap.restEndsAt && snap.restEndsAt > now - 4000) return true
  if (snap.flow === 'ready' || snap.flow === 'active' || snap.flow === 'pick' || snap.flow === 'sauna') {
    return true
  }
  return now - snap.at < 120000
}

export function readStoredSnapshot(): LiveSnapshot | null {
  if (lastSnap) return lastSnap
  if (isWatchMode()) return null
  try {
    const raw = localStorage.getItem(SNAP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveSnapshot
    if (parsed?.v === 1) {
      lastSnap = parsed
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function getLatestLiveSnapshot(): LiveSnapshot | null {
  return lastSnap ?? readStoredSnapshot()
}

function liveFromState(state: unknown): LiveSnapshot | null {
  if (!state || typeof state !== 'object') return null
  const snap = (state as { __live?: LiveSnapshot }).__live
  return snap?.v === 1 ? snap : null
}

async function persistCloud(snap: LiveSnapshot): Promise<void> {
  if (!isCloudEnabled() || !currentUserId) return
  const supabase = getSupabase()

  if (!tableMissing) {
    try {
      const { error } = await supabase.from(TABLE).upsert(
        {
          user_id: currentUserId,
          snap,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      if (error && isMissingRelation(error)) tableMissing = true
      else if (!error) return
    } catch {
      /* võrk */
    }
  }
}

export async function pullRemoteSnapshot(userId?: string | null): Promise<LiveSnapshot | null> {
  const uid = userId ?? currentUserId
  if (!isCloudEnabled() || !uid) return readStoredSnapshot()
  const supabase = getSupabase()

  if (!tableMissing) {
    try {
      const { data, error } = await supabase.from(TABLE).select('snap').eq('user_id', uid).maybeSingle()
      if (error) {
        if (isMissingRelation(error)) tableMissing = true
      } else {
        const snap = data?.snap as LiveSnapshot | undefined
        if (snap?.v === 1) {
          applySnap(snap)
          return lastSnap
        }
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const { data } = await supabase.from('user_app_state').select('state').eq('user_id', uid).maybeSingle()
    const snap = liveFromState(data?.state)
    if (snap) {
      applySnap(snap)
      return lastSnap
    }
  } catch {
    /* ignore */
  }
  return readStoredSnapshot()
}

export async function connectLiveRemote(userId: string | null): Promise<void> {
  getBc()
  window.addEventListener('storage', onStorage)
  currentUserId = userId

  if (!isCloudEnabled() || !userId) {
    if (supabaseChannel && isCloudEnabled()) {
      void getSupabase().removeChannel(supabaseChannel)
    }
    supabaseChannel = null
    return
  }

  const supabase = getSupabase()
  if (supabaseChannel) {
    void supabase.removeChannel(supabaseChannel)
    supabaseChannel = null
  }

  const channel = supabase.channel(`salakivi-live-${userId}`, {
    config: { broadcast: { ack: false, self: false }, presence: { key: userId } },
  })
  const live = channel as unknown as {
    on: (type: string, filter: { event: string }, fn: (payload: { payload?: Envelope }) => void) => void
    subscribe: (cb?: (status: string) => void) => Promise<unknown>
    send: RealtimeChannel['send']
    track?: (state: Record<string, unknown>) => Promise<unknown>
  }
  live.on('broadcast', { event: 'live' }, (payload) => {
    const env = payload.payload
    if (env?.kind === 'snap' || env?.kind === 'cmd') emit(env)
  })
  await live.subscribe()
  supabaseChannel = channel
  void pullRemoteSnapshot(userId)
}

function onStorage(ev: StorageEvent): void {
  if (ev.key === SNAP_KEY && ev.newValue) {
    try {
      emit({ kind: 'snap', snap: JSON.parse(ev.newValue) as LiveSnapshot })
    } catch {
      /* ignore */
    }
  }
  if (ev.key === CMD_KEY && ev.newValue) {
    try {
      emit({ kind: 'cmd', cmd: JSON.parse(ev.newValue) as LiveCommand })
    } catch {
      /* ignore */
    }
  }
}

export function publishSnapshot(snap: LiveSnapshot): void {
  const stamped: LiveSnapshot = { ...snap, seq: ++publishSeq, at: Date.now() }
  applySnap(stamped)
  getBc()?.postMessage({ kind: 'snap', snap: stamped } satisfies Envelope)
  void supabaseChannel?.send({
    type: 'broadcast',
    event: 'live',
    payload: { kind: 'snap', snap: stamped },
  })
  void persistCloud(stamped)
}

export function sendCommand(type: LiveCommand['type']): void {
  const cmd: LiveCommand = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    at: Date.now(),
  }
  try {
    localStorage.setItem(CMD_KEY, JSON.stringify(cmd))
  } catch {
    /* ignore */
  }
  getBc()?.postMessage({ kind: 'cmd', cmd } satisfies Envelope)
  emit({ kind: 'cmd', cmd })
  void supabaseChannel?.send({
    type: 'broadcast',
    event: 'live',
    payload: { kind: 'cmd', cmd },
  })
}

export function subscribeSnapshot(onSnap: (snap: LiveSnapshot) => void): () => void {
  snapListeners.add(onSnap)
  const stored = readStoredSnapshot()
  if (stored) onSnap(stored)
  return () => {
    snapListeners.delete(onSnap)
  }
}

export function subscribeCommands(onCmd: (cmd: LiveCommand) => void): () => void {
  cmdListeners.add(onCmd)
  return () => {
    cmdListeners.delete(onCmd)
  }
}
