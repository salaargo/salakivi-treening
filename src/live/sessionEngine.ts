import type { DayLog, ExerciseLog, SetLog } from '../types'
import { afterSetAction } from '../workoutFlow'

export interface SessionExercise {
  id: string
  name: string
  restSeconds: number
}

export interface LiveSession {
  v: 2
  dateKey: string
  flow: 'idle' | 'pick' | 'ready' | 'active' | 'resting' | 'sauna'
  selected: number[]
  activeSlot: number
  log: DayLog
  restEndsAt?: number
  restSeconds: number
  restHint: string
  restNext: string
  pendingAfterRest: 'ready' | 'pick'
  sessionStartedAt: number | null
  workMs: number
  restMs: number
  setStartedAt: number | null
  lastTehtudAt: number | null
  planName: string
  exercises: SessionExercise[]
  /** Iga Start/Tehtud/pausi-vahe. Vanem telefoni seis ei tohi uuemate käskude peale kirjutada. */
  rev?: number
}

function findExerciseLog(log: DayLog, exerciseId: string): ExerciseLog | undefined {
  return log.exercises.find((entry) => entry.exerciseId === exerciseId)
}

export function completedSetCount(log?: DayLog | null): number {
  if (!log) return 0
  return log.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.completed).length, 0)
}

function withRev(prev: LiveSession, next: LiveSession): LiveSession {
  if (next === prev) return prev
  return { ...next, rev: (prev.rev ?? 0) + 1 }
}

function nextIncompleteSet(log: DayLog, exerciseId: string): number {
  const sets = findExerciseLog(log, exerciseId)?.sets ?? []
  const idx = sets.findIndex((s) => !s.completed)
  return idx === -1 ? sets.length : idx
}

function isExerciseDone(log: DayLog, exerciseId: string): boolean {
  const entry = findExerciseLog(log, exerciseId)
  if (!entry) return false
  if (entry.finishedEarly) return true
  return Boolean(entry.sets.length && entry.sets.every((s) => s.completed))
}

function allExercisesDone(log: DayLog, exercises: SessionExercise[]): boolean {
  return exercises.every((ex) => isExerciseDone(log, ex.id))
}

function remainingSetParts(
  log: DayLog,
  items: SessionExercise[],
): { name: string; left: number }[] {
  return items
    .map((ex) => {
      if (isExerciseDone(log, ex.id)) return null
      const left = findExerciseLog(log, ex.id)?.sets.filter((s) => !s.completed).length ?? 0
      return left > 0 ? { name: ex.name, left } : null
    })
    .filter((part): part is { name: string; left: number } => part !== null)
}

function remainingSetsHint(log: DayLog, items: SessionExercise[]): string {
  const parts = remainingSetParts(log, items)
  if (parts.length === 0) return 'Seeriad tehtud'
  return parts
    .map((p) => `${p.name} · ${p.left} ${p.left === 1 ? 'seeria' : 'seeriat'}`)
    .join('\n')
}

function selectedExercises(session: LiveSession): SessionExercise[] {
  return session.selected
    .map((index) => session.exercises[index])
    .filter((ex): ex is SessionExercise => Boolean(ex))
}

function markSetComplete(exerciseId: string, si: number, log: DayLog): DayLog {
  return {
    ...log,
    exercises: log.exercises.map((ex) =>
      ex.exerciseId !== exerciseId
        ? ex
        : {
            ...ex,
            sets: ex.sets.map((s, i) => (i === si ? { ...s, completed: true } : s)),
          },
    ),
  }
}

function recordStart(session: LiveSession, now: number): LiveSession {
  let restMs = session.restMs
  let lastTehtudAt = session.lastTehtudAt
  if (lastTehtudAt != null) {
    restMs += now - lastTehtudAt
    lastTehtudAt = null
  }
  const startedAt =
    session.sessionStartedAt ??
    (session.log.startedAt ? Date.parse(session.log.startedAt) : now)
  return {
    ...session,
    sessionStartedAt: startedAt,
    restMs,
    lastTehtudAt,
    setStartedAt: now,
    flow: 'active',
    log: {
      ...session.log,
      startedAt: session.log.startedAt ?? new Date(startedAt).toISOString(),
    },
  }
}

function recordTehtud(session: LiveSession, now: number): LiveSession {
  let workMs = session.workMs
  if (session.setStartedAt != null) workMs += now - session.setStartedAt
  return {
    ...session,
    workMs,
    setStartedAt: null,
    lastTehtudAt: now,
  }
}

function startRest(session: LiveSession, pause: number, nextLog: DayLog, nextSlot: number, now: number): LiveSession {
  const selected = selectedExercises(session)
  const nextEx = session.exercises[session.selected[nextSlot]]
  const hint = remainingSetsHint(nextLog, selected)
  const nextName = nextEx?.name ?? ''
  const nextHint = nextName ? `Järgmisena: ${nextName}` : ''
  const endsAt = now + pause * 1000
  return {
    ...session,
    log: nextLog,
    restSeconds: pause,
    restHint: hint,
    restNext: nextHint,
    restEndsAt: endsAt,
    pendingAfterRest: 'ready',
    activeSlot: nextSlot,
    flow: 'resting',
  }
}

function endRest(session: LiveSession): LiveSession {
  if (session.pendingAfterRest === 'pick') {
    return {
      ...session,
      restEndsAt: undefined,
      selected: [],
      activeSlot: 0,
      flow: 'pick',
    }
  }
  return {
    ...session,
    restEndsAt: undefined,
    flow: 'ready',
  }
}

function applyTehtud(session: LiveSession, now: number): LiveSession {
  const currentExIndex = session.selected[session.activeSlot] ?? session.selected[0]
  const currentEx = currentExIndex !== undefined ? session.exercises[currentExIndex] : undefined
  if (!currentEx || session.flow !== 'active') return session

  const setIndex = nextIncompleteSet(session.log, currentEx.id)
  const currentSet: SetLog | undefined = findExerciseLog(session.log, currentEx.id)?.sets[setIndex]
  if (!currentSet) return session

  let next = recordTehtud(session, now)
  const nextLog = markSetComplete(currentEx.id, setIndex, next.log)
  const pause = Math.max(0, currentEx.restSeconds)
  const thisDone = isExerciseDone(nextLog, currentEx.id)
  const otherSlot = session.activeSlot === 0 ? 1 : 0
  const otherExercise =
    session.selected.length === 2 ? session.exercises[session.selected[otherSlot]] : undefined
  const otherStillOpen = otherExercise ? !isExerciseDone(nextLog, otherExercise.id) : false
  const thisCompleted = findExerciseLog(nextLog, currentEx.id)?.sets.filter((s) => s.completed).length ?? 0
  const otherCompleted = otherExercise
    ? findExerciseLog(nextLog, otherExercise.id)?.sets.filter((s) => s.completed).length ?? 0
    : 0
  const firstEx = session.exercises[session.selected[0]]
  const firstStillOpen = firstEx ? !isExerciseDone(nextLog, firstEx.id) : false
  const action = afterSetAction({
    selectedLength: session.selected.length,
    activeSlot: session.activeSlot,
    otherSlot,
    thisCompleted,
    otherCompleted,
    thisDone,
    otherStillOpen,
    allDone: allExercisesDone(nextLog, session.exercises),
    firstStillOpen,
  })

  if (action.kind === 'sauna') {
    return finishSession({ ...next, log: nextLog }, now)
  }

  next = { ...next, log: nextLog }

  if (action.kind === 'pick') {
    return {
      ...next,
      selected: [],
      activeSlot: 0,
      flow: 'pick',
    }
  }

  if (!action.rest || pause <= 0) {
    return {
      ...next,
      activeSlot: action.nextSlot,
      flow: 'ready',
    }
  }

  return startRest(next, pause, nextLog, action.nextSlot, now)
}

function finishSession(session: LiveSession, now: number): LiveSession {
  let workMs = session.workMs
  if (session.setStartedAt != null) workMs += now - session.setStartedAt
  let restMs = session.restMs
  if (session.lastTehtudAt != null) restMs += now - session.lastTehtudAt
  const started =
    session.sessionStartedAt != null
      ? new Date(session.sessionStartedAt).toISOString()
      : session.log.startedAt ?? new Date(now).toISOString()
  return {
    ...session,
    workMs,
    restMs,
    setStartedAt: null,
    lastTehtudAt: null,
    flow: 'sauna',
    restEndsAt: undefined,
    log: {
      ...session.log,
      startedAt: started,
      finishedAt: new Date(now).toISOString(),
      workMs,
      restMs,
    },
  }
}

export function applySessionCommand(
  session: LiveSession,
  type: 'start' | 'tehtud' | 'skip-rest' | 'finish-exercise' | 'stop' | 'sync',
  now = Date.now(),
): LiveSession {
  if (type === 'sync' || type === 'stop' || type === 'finish-exercise') return session
  if (type === 'start') {
    let next = session
    if (next.flow === 'resting') next = endRest(next)
    if (next.flow !== 'ready') return session
    return withRev(session, recordStart(next, now))
  }
  if (type === 'tehtud') return withRev(session, applyTehtud(session, now))
  if (type === 'skip-rest') {
    if (session.flow !== 'resting') return session
    return withRev(session, endRest(session))
  }
  return session
}

export function sessionToSnapshot(session: LiveSession): {
  v: 1
  at: number
  dateKey: string
  flow: LiveSession['flow']
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
  weightKg?: number
  session: LiveSession
} {
  const currentExIndex = session.selected[session.activeSlot] ?? session.selected[0]
  const currentEx = currentExIndex !== undefined ? session.exercises[currentExIndex] : undefined
  const other =
    session.selected.length === 2
      ? session.exercises[session.selected[session.activeSlot === 0 ? 1 : 0]]
      : undefined
  const selected = selectedExercises(session)
  const setIndex = currentEx ? nextIncompleteSet(session.log, currentEx.id) : 0
  const currentSet = currentEx ? findExerciseLog(session.log, currentEx.id)?.sets[setIndex] : undefined
  return {
    v: 1,
    at: Date.now(),
    dateKey: session.dateKey,
    flow: session.flow,
    planName: session.planName,
    exerciseName: currentEx?.name,
    otherName: other?.name,
    setNumber: currentEx ? setIndex + 1 : undefined,
    totalRounds: currentEx
      ? findExerciseLog(session.log, currentEx.id)?.sets.length
      : undefined,
    remainingHint: remainingSetsHint(session.log, selected.length ? selected : session.exercises),
    remainingParts: remainingSetParts(session.log, selected.length ? selected : session.exercises),
    nextHint: session.restNext || undefined,
    restSeconds: session.restSeconds,
    restEndsAt: session.restEndsAt,
    remainingSets: currentEx
      ? findExerciseLog(session.log, currentEx.id)?.sets.filter((s) => !s.completed).length
      : undefined,
    weightKg: currentSet?.weightKg,
    session,
  }
}

export function isPhoneLikelyAsleep(snap: { at: number } | null, now = Date.now()): boolean {
  if (!snap) return true
  return now - snap.at > 2200
}
