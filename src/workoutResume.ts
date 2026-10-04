import type { DayLog, ExerciseLog, SetLog } from './types'
import { completedSetCount } from './live/sessionEngine'
import type { LiveSnapshot } from './live/remote'
import type { RestSession } from './restSession'
import { isExerciseLogDone } from './storage'

export type ResumeFlow = 'pick' | 'ready' | 'active' | 'resting' | 'sauna'

export interface WorkoutBoot {
  log: DayLog | null
  flow: ResumeFlow
  selected: number[]
  activeSlot: number
  restSeconds: number
  restHint: string
  restNext: string
  restEndsAt: number | null
  pendingAfterRest: 'ready' | 'pick'
  sessionStartedAt: number | null
  workMs: number
  restMs: number
  setStartedAt: number | null
  lastTehtudAt: number | null
  rev: number
  epoch: number
}

/** Kui Start jäi pooleli ja brauser suleti, ära lisa terve paus tööajaks. */
const STALE_ACTIVE_MS = 90_000

function mergeSets(a: SetLog[], b: SetLog[]): SetLog[] {
  const len = Math.max(a.length, b.length)
  const out: SetLog[] = []
  for (let i = 0; i < len; i++) {
    const left = a[i]
    const right = b[i]
    if (!left) {
      out.push(right)
      continue
    }
    if (!right) {
      out.push(left)
      continue
    }
    if (left.completed && !right.completed) out.push(left)
    else if (right.completed && !left.completed) out.push(right)
    else if (left.completed && right.completed) out.push(left)
    else out.push(right.weightKg !== left.weightKg ? right : left)
  }
  return out
}

function mergeExerciseLogs(a: ExerciseLog[], b: ExerciseLog[]): ExerciseLog[] {
  const byId = new Map<string, ExerciseLog>()
  for (const ex of a) byId.set(ex.exerciseId, ex)
  for (const ex of b) {
    const prev = byId.get(ex.exerciseId)
    if (!prev) {
      byId.set(ex.exerciseId, ex)
      continue
    }
    byId.set(ex.exerciseId, {
      exerciseId: ex.exerciseId,
      sets: mergeSets(prev.sets, ex.sets),
      finishedEarly: Boolean(prev.finishedEarly || ex.finishedEarly) || undefined,
    })
  }
  const order = a.length >= b.length ? a : b
  const seen = new Set<string>()
  const out: ExerciseLog[] = []
  for (const ex of order) {
    const merged = byId.get(ex.exerciseId)
    if (!merged || seen.has(ex.exerciseId)) continue
    seen.add(ex.exerciseId)
    out.push(merged)
  }
  for (const [id, ex] of byId) {
    if (seen.has(id)) continue
    out.push(ex)
  }
  return out
}

function timestamp(log: DayLog): number {
  return Date.parse(log.finishedAt ?? log.startedAt ?? '') || 0
}

function preferMeta(a: DayLog, b: DayLog): DayLog {
  const aSets = completedSetCount(a)
  const bSets = completedSetCount(b)
  if (bSets !== aSets) return bSets > aSets ? b : a
  const aTime = timestamp(a)
  const bTime = timestamp(b)
  if (bTime !== aTime) return bTime > aTime ? b : a
  if (a.startedAt && !b.startedAt) return a
  if (b.startedAt && !a.startedAt) return b
  return a
}

/** Sama päeva logid: säilita rohkem tehtud seeriaid, ära kaota pooleli seisu. */
export function mergeDayLogs(a: DayLog, b: DayLog): DayLog {
  const richer = preferMeta(a, b)
  const exercises = mergeExerciseLogs(a.exercises, b.exercises)
  return {
    ...richer,
    exercises,
    startedAt: a.startedAt ?? b.startedAt,
    finishedAt: richer.finishedAt,
    workMs: Math.max(a.workMs ?? 0, b.workMs ?? 0) || richer.workMs,
    restMs: Math.max(a.restMs ?? 0, b.restMs ?? 0) || richer.restMs,
    stoppedEarly: richer.stoppedEarly,
  }
}

export function mergeAppLogs(
  cloudLogs: Record<string, DayLog>,
  localLogs: Record<string, DayLog>,
  liveLog?: DayLog | null,
): Record<string, DayLog> {
  const out: Record<string, DayLog> = { ...cloudLogs }
  for (const [key, local] of Object.entries(localLogs)) {
    const cloud = out[key]
    out[key] = cloud ? mergeDayLogs(cloud, local) : local
  }
  if (liveLog?.dateKey) {
    const existing = out[liveLog.dateKey]
    out[liveLog.dateKey] = existing ? mergeDayLogs(existing, liveLog) : liveLog
  }
  return out
}

export function dayLogInProgress(log: DayLog | null | undefined): boolean {
  if (!log || log.finishedAt) return false
  if (log.startedAt) return true
  return log.exercises.some((ex) => ex.sets.some((set) => set.completed) || ex.finishedEarly)
}

function emptyBoot(log: DayLog | null, flow: ResumeFlow, epoch: number, extra: Partial<WorkoutBoot> = {}): WorkoutBoot {
  return {
    log,
    flow,
    selected: [],
    activeSlot: 0,
    restSeconds: 60,
    restHint: '',
    restNext: '',
    restEndsAt: null,
    pendingAfterRest: 'ready',
    sessionStartedAt: log?.startedAt ? Date.parse(log.startedAt) || null : null,
    workMs: log?.workMs ?? 0,
    restMs: log?.restMs ?? 0,
    setStartedAt: null,
    lastTehtudAt: null,
    rev: 0,
    epoch,
    ...extra,
  }
}

/**
 * Taasta treeningu voog pärast brauseri sulgemist / uuesti sisselogimist.
 * Eelistab kella/telefoni live-seanssi, siis pausi, muidu harjutuste valikut (tehtud seeriad jäävad).
 */
export function bootWorkout(opts: {
  dateKey: string
  log: DayLog | null
  exercises: { id: string }[]
  snap: LiveSnapshot | null
  rest: RestSession | null
  now?: number
}): WorkoutBoot {
  const now = opts.now ?? Date.now()
  const log = opts.log
  if (!log) return emptyBoot(null, 'pick', now)

  const allDone =
    opts.exercises.length > 0 && opts.exercises.every((ex) => isExerciseLogDone(log, ex.id))
  if (log.finishedAt || allDone) {
    return emptyBoot(log, 'sauna', now)
  }

  const snap = opts.snap
  if (
    snap?.session?.v === 2 &&
    snap.dateKey === opts.dateKey &&
    snap.flow !== 'idle' &&
    snap.session.log
  ) {
    const merged = mergeDayLogs(log, snap.session.log)
    const session = snap.session
    let flow: ResumeFlow = session.flow === 'idle' ? 'pick' : session.flow
    let restEndsAt = session.restEndsAt ?? null
    let setStartedAt = session.setStartedAt
    const lastTehtudAt = session.lastTehtudAt
    let selected = session.selected ?? []
    let activeSlot = session.activeSlot ?? 0

    if (flow === 'sauna') {
      return emptyBoot(merged, 'sauna', snap.epoch ?? now, { rev: session.rev ?? 0 })
    }

    if (flow === 'active' && setStartedAt != null && now - setStartedAt > STALE_ACTIVE_MS) {
      flow = 'ready'
      setStartedAt = null
    }

    if (flow === 'resting') {
      if (!restEndsAt || restEndsAt <= now) {
        flow = session.pendingAfterRest === 'pick' ? 'pick' : 'ready'
        restEndsAt = null
        if (flow === 'pick') {
          selected = []
          activeSlot = 0
        }
      }
    }

    return {
      log: merged,
      flow,
      selected,
      activeSlot,
      restSeconds: session.restSeconds ?? 60,
      restHint: session.restHint ?? '',
      restNext: session.restNext ?? '',
      restEndsAt,
      pendingAfterRest: session.pendingAfterRest ?? 'ready',
      sessionStartedAt:
        session.sessionStartedAt ?? (merged.startedAt ? Date.parse(merged.startedAt) : null),
      workMs: session.workMs,
      restMs: session.restMs,
      setStartedAt,
      lastTehtudAt,
      rev: session.rev ?? 0,
      epoch: snap.epoch ?? now,
    }
  }

  const rest = opts.rest
  if (rest && rest.dateKey === opts.dateKey) {
    const ended = rest.endsAt <= now
    const flow: ResumeFlow = ended ? (rest.pending === 'pick' ? 'pick' : 'ready') : 'resting'
    return emptyBoot(log, flow, now, {
      selected: ended && rest.pending === 'pick' ? [] : rest.selected,
      activeSlot: rest.activeSlot,
      restSeconds: rest.durationSeconds,
      restHint: rest.hint,
      restNext: rest.next,
      restEndsAt: ended ? null : rest.endsAt,
      pendingAfterRest: rest.pending,
    })
  }

  return emptyBoot(log, 'pick', now)
}
