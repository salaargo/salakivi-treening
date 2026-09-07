import { getSupabase, isCloudEnabled } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type RemoteCommandType = 'start' | 'tehtud' | 'skip-rest' | 'finish-exercise' | 'stop'

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
  nextHint?: string
  restSeconds?: number
  restEndsAt?: number
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
const FRESH_MS = 8000

type Envelope = { kind: 'snap'; snap: LiveSnapshot } | { kind: 'cmd'; cmd: LiveCommand }

const snapListeners = new Set<(snap: LiveSnapshot) => void>()
const cmdListeners = new Set<(cmd: LiveCommand) => void>()
const seenCommands = new Set<string>()

let bc: BroadcastChannel | null = null
let supabaseChannel: RealtimeChannel | null = null

function emit(env: Envelope): void {
  if (env.kind === 'snap') {
    snapListeners.forEach((fn) => fn(env.snap))
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

export function snapshotIsFresh(snap: LiveSnapshot | null, now = Date.now()): snap is LiveSnapshot {
  return Boolean(snap && now - snap.at < FRESH_MS && snap.flow !== 'idle')
}

export function readStoredSnapshot(): LiveSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveSnapshot
    return parsed?.v === 1 ? parsed : null
  } catch {
    return null
  }
}

export async function connectLiveRemote(userId: string | null): Promise<void> {
  getBc()
  window.addEventListener('storage', onStorage)

  if (!isCloudEnabled() || !userId) {
    supabaseChannel = null
    return
  }

  const supabase = getSupabase()
  const channel = supabase.channel(`salakivi-live-${userId}`, {
    config: { broadcast: { ack: false, self: false } },
  })
  const live = channel as unknown as {
    on: (type: string, filter: { event: string }, fn: (payload: { payload?: Envelope }) => void) => void
    subscribe: () => Promise<unknown>
    send: RealtimeChannel['send']
  }
  live.on('broadcast', { event: 'live' }, (payload) => {
    const env = payload.payload
    if (env?.kind === 'snap' || env?.kind === 'cmd') emit(env)
  })
  await live.subscribe()
  supabaseChannel = channel
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
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(snap))
  } catch {
    /* ignore quota */
  }
  getBc()?.postMessage({ kind: 'snap', snap } satisfies Envelope)
  void supabaseChannel?.send({
    type: 'broadcast',
    event: 'live',
    payload: { kind: 'snap', snap },
  })
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
  void supabaseChannel?.send({
    type: 'broadcast',
    event: 'live',
    payload: { kind: 'cmd', cmd },
  })
}

export function subscribeSnapshot(onSnap: (snap: LiveSnapshot) => void): () => void {
  snapListeners.add(onSnap)
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
