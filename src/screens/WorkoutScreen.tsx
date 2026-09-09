import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AppState, DayLog, ExerciseLog, ExerciseTemplate, SetLog } from '../types'
import { formatDayMonth, parseDateKey, weekdayFull } from '../dates'
import {
  addMachineToExercise,
  getExercisesForPlan,
  getPlanForDate,
  getPhaseProgress,
  lastWeightForMachine,
  weightForSelectedMachine,
} from '../storage'
import { createMachine, exerciseRounds, getMachine, getPrimaryMachine } from '../exercises'
import { suggestedWeight, phaseToneKey } from '../phases'
import { RestTimer } from '../components/RestTimer'
import { afterSetAction } from '../workoutFlow'
import { publishSnapshot, subscribeCommands, type LiveCommand } from '../live/remote'
import { isWatchMode, lockPortrait, useScreenWakeLock } from '../orientation'
import { clearRestSession, loadRestSession, saveRestSession } from '../restSession'
import { useWorkoutKeepAlive } from '../keepAlive'

interface WorkoutScreenProps {
  state: AppState
  dateKey: string
  onBack: () => void
  onFinish: () => void
  onUpdateLog: (log: DayLog) => void
  onChangeState: (next: AppState) => void
  onRegisterLiveLog?: (getter: (() => DayLog | null) | null) => void
  compact?: boolean
}

interface AddPinkForm {
  exIndex: number
  setIndex: number
  name: string
  baseWeightKg: string
}

type Flow = 'pick' | 'ready' | 'active' | 'resting' | 'sauna'

function buildExerciseLog(
  ex: ExerciseTemplate,
  phase: AppState['phases'][number],
  state: AppState,
  dateKey: string,
): ExerciseLog {
  const machine = getPrimaryMachine(ex)
  return {
    exerciseId: ex.id,
    sets: Array.from({ length: exerciseRounds(ex) }, () => ({
      machineId: machine.id,
      weightKg: weightForSelectedMachine(state, ex, machine.id, dateKey, phase),
      reps: phase.setsMin,
      completed: false,
    })),
  }
}

function logMatchesExercises(existing: DayLog, exercises: ExerciseTemplate[]): boolean {
  if (existing.exercises.length !== exercises.length) return false
  return exercises.every((ex, index) => existing.exercises[index]?.exerciseId === ex.id)
}

function findExerciseLog(log: DayLog, exerciseId: string): ExerciseLog | undefined {
  return log.exercises.find((entry) => entry.exerciseId === exerciseId)
}

function buildInitialLog(state: AppState, dateKey: string): DayLog | null {
  const plan = getPlanForDate(state, dateKey)
  if (!plan) return null
  const exercises = getExercisesForPlan(state, plan.id)
  if (!exercises.length) return null

  const progress = getPhaseProgress(state, dateKey)
  const phase = progress.phase

  const existing = state.logs[dateKey]
  if (
    existing &&
    existing.planId === plan.id &&
    existing.phaseId === phase.id &&
    logMatchesExercises(existing, exercises)
  ) {
    return existing
  }

  return {
    dateKey,
    planId: plan.id,
    phaseId: phase.id,
    exercises: exercises.map((ex) => buildExerciseLog(ex, phase, state, dateKey)),
  }
}

function completedCount(log: DayLog, exerciseId: string): number {
  return findExerciseLog(log, exerciseId)?.sets.filter((s) => s.completed).length ?? 0
}

function isExerciseDone(log: DayLog, exerciseId: string): boolean {
  const entry = findExerciseLog(log, exerciseId)
  if (!entry) return false
  if (entry.finishedEarly) return true
  return Boolean(entry.sets.length && entry.sets.every((s) => s.completed))
}

function allExercisesDone(log: DayLog, exercises: ExerciseTemplate[]): boolean {
  return exercises.every((ex) => isExerciseDone(log, ex.id))
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h} h ${m} min ${String(s).padStart(2, '0')} s`
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s} s`
}

function workoutTotalMs(log: DayLog): number {
  if (log.startedAt && log.finishedAt) {
    const start = Date.parse(log.startedAt)
    const end = Date.parse(log.finishedAt)
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start
  }
  return Math.max(0, (log.workMs ?? 0) + (log.restMs ?? 0))
}

function nextIncompleteSet(log: DayLog, exerciseId: string): number {
  const sets = findExerciseLog(log, exerciseId)?.sets ?? []
  const idx = sets.findIndex((s) => !s.completed)
  return idx === -1 ? sets.length : idx
}

function remainingSetParts(
  log: DayLog,
  items: { id: string; name: string }[],
): { name: string; left: number }[] {
  return items
    .map((ex) => {
      if (isExerciseDone(log, ex.id)) return null
      const left = findExerciseLog(log, ex.id)?.sets.filter((s) => !s.completed).length ?? 0
      return left > 0 ? { name: ex.name, left } : null
    })
    .filter((part): part is { name: string; left: number } => part !== null)
}

function remainingSetsHint(
  log: DayLog,
  items: { id: string; name: string }[],
): string {
  const parts = remainingSetParts(log, items)
  if (parts.length === 0) return 'Seeriad tehtud'
  return parts
    .map((p) => `${p.name} · ${p.left} ${p.left === 1 ? 'seeria' : 'seeriat'}`)
    .join('\n')
}

export function WorkoutScreen({
  state,
  dateKey,
  onBack,
  onFinish,
  onUpdateLog,
  onChangeState,
  onRegisterLiveLog,
  compact = false,
}: WorkoutScreenProps) {
  const date = parseDateKey(dateKey)
  const weekday = date.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const plan = getPlanForDate(state, dateKey)
  const progress = plan ? getPhaseProgress(state, dateKey) : null
  const phase = progress?.phase ?? null
  const liveExercises = useMemo(
    () => (plan ? getExercisesForPlan(state, plan.id) : []),
    [state, plan],
  )

  const restoredRest = loadRestSession(dateKey)
  const [log, setLog] = useState<DayLog | null>(() => buildInitialLog(state, dateKey))
  const [flow, setFlow] = useState<Flow>(() => {
    const initial = buildInitialLog(state, dateKey)
    if (!initial) return 'pick'
    const exercises = plan ? getExercisesForPlan(state, plan.id) : []
    if (initial.finishedAt || (exercises.length > 0 && allExercisesDone(initial, exercises))) {
      return 'sauna'
    }
    if (restoredRest) return 'resting'
    return 'pick'
  })
  const [selected, setSelected] = useState<number[]>(() => restoredRest?.selected ?? [])
  const [activeSlot, setActiveSlot] = useState(() => restoredRest?.activeSlot ?? 0)
  const [restSeconds, setRestSeconds] = useState(restoredRest?.durationSeconds ?? 60)
  const [restHint, setRestHint] = useState(restoredRest?.hint ?? '')
  const [restNext, setRestNext] = useState(restoredRest?.next ?? '')
  const [restEndsAt, setRestEndsAt] = useState<number | null>(restoredRest?.endsAt ?? null)
  const [showSetMenu, setShowSetMenu] = useState(false)
  const [addPink, setAddPink] = useState<AddPinkForm | null>(null)
  const keepAlive = Boolean(plan && (flow === 'ready' || flow === 'active' || flow === 'resting'))
  useScreenWakeLock(keepAlive)
  useWorkoutKeepAlive(keepAlive)

  useLayoutEffect(() => {
    void lockPortrait()
    return () => {
      try {
        screen.orientation?.unlock?.()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const publishNowRef = useRef<() => void>(() => {})

  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const tehtudArmed = useRef(false)
  const pendingAfterRest = useRef<'ready' | 'pick'>(restoredRest?.pending ?? 'ready')
  const sessionStartedAt = useRef<number | null>(
    log?.startedAt ? Date.parse(log.startedAt) || null : null,
  )
  const setStartedAt = useRef<number | null>(null)
  const lastTehtudAt = useRef<number | null>(null)
  const workMsAcc = useRef(log?.workMs ?? 0)
  const restMsAcc = useRef(log?.restMs ?? 0)
  const commandRef = useRef({
    flow: 'pick' as Flow,
    onStart: () => {},
    onTehtud: () => {},
    onSkipRest: () => {},
    onFinishEarly: () => {},
  })

  const commitLog = useCallback(
    (next: DayLog) => {
      setLog(next)
      onUpdateLog(next)
    },
    [onUpdateLog],
  )

  useEffect(() => {
    if (!onRegisterLiveLog) return
    onRegisterLiveLog(() => {
      if (!log) return null
      const now = Date.now()
      let workMs = workMsAcc.current
      let restMs = restMsAcc.current
      if (setStartedAt.current !== null) {
        workMs += now - setStartedAt.current
      }
      const started =
        sessionStartedAt.current !== null
          ? new Date(sessionStartedAt.current).toISOString()
          : log.startedAt ?? new Date(now).toISOString()
      return {
        ...log,
        startedAt: started,
        finishedAt: new Date(now).toISOString(),
        workMs,
        restMs,
        stoppedEarly: true,
      }
    })
    return () => onRegisterLiveLog(null)
  }, [log, onRegisterLiveLog])

  useEffect(() => {
    const rebuilt = buildInitialLog(state, dateKey)
    if (!rebuilt || !log) return
    if (!logMatchesExercises(log, liveExercises)) {
      commitLog(rebuilt)
    }
  }, [state, dateKey, liveExercises, log, commitLog])

  const endRest = useCallback(() => {
    clearRestSession()
    setRestEndsAt(null)
    if (pendingAfterRest.current === 'pick') {
      setSelected([])
      setActiveSlot(0)
      setFlow('pick')
      return
    }
    setFlow('ready')
  }, [])

  useEffect(() => {
    if (restEndsAt && restEndsAt <= Date.now() && flow === 'resting') endRest()
  }, [endRest, flow, restEndsAt])

  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'hidden') return
      void lockPortrait()
      const saved = loadRestSession(dateKey)
      if (!saved) return
      setRestEndsAt(saved.endsAt)
      setRestSeconds(saved.durationSeconds)
      setRestHint(saved.hint)
      setRestNext(saved.next)
      pendingAfterRest.current = saved.pending
      setSelected(saved.selected)
      setActiveSlot(saved.activeSlot)
      if (saved.endsAt <= Date.now()) endRest()
      else setFlow('resting')
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    window.addEventListener('online', onWake)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [dateKey, endRest])

  function extendRest(seconds: number) {
    setRestEndsAt((t) => {
      const next = (t ?? Date.now()) + seconds * 1000
      const session = loadRestSession(dateKey)
      if (session) saveRestSession({ ...session, endsAt: next, durationSeconds: session.durationSeconds + seconds })
      return next
    })
    setRestSeconds((s) => s + seconds)
  }

  const currentExIndex = selected[activeSlot] ?? selected[0]
  const currentEx: ExerciseTemplate | undefined =
    currentExIndex !== undefined ? liveExercises[currentExIndex] : undefined
  const currentLog = currentEx && log ? findExerciseLog(log, currentEx.id) : undefined
  const setIndex = currentEx && log ? nextIncompleteSet(log, currentEx.id) : 0
  const currentSet: SetLog | undefined = currentLog?.sets[setIndex]
  const setNumber = setIndex + 1
  const currentMachine =
    currentEx && currentSet
      ? getMachine(currentEx, currentSet.machineId) ?? getPrimaryMachine(currentEx)
      : null
  const totalRounds = currentEx ? exerciseRounds(currentEx) : 0

  const remainingExercises = useMemo(() => {
    if (!log) return []
    return liveExercises
      .map((ex, index) => ({ ex, index }))
      .filter(({ ex }) => !isExerciseDone(log, ex.id))
  }, [log, liveExercises])

  const selectedExercises = useMemo(
    () =>
      selected
        .map((index) => liveExercises[index])
        .filter((ex): ex is ExerciseTemplate => Boolean(ex)),
    [selected, liveExercises],
  )

  useEffect(() => {
    if (isWatchMode()) return
    const publish = () => {
      const other =
        selected.length === 2 ? liveExercises[selected[activeSlot === 0 ? 1 : 0]] : undefined
      publishSnapshot({
        v: 1,
        at: Date.now(),
        dateKey,
        flow,
        planName: plan?.name,
        exerciseName: currentEx?.name,
        otherName: other?.name,
        setNumber: currentEx ? setNumber : undefined,
        totalRounds: currentEx ? totalRounds : undefined,
        remainingHint: log ? remainingSetsHint(log, selectedExercises) : undefined,
        remainingParts: log ? remainingSetParts(log, selectedExercises) : undefined,
        nextHint: restNext || undefined,
        restSeconds,
        restEndsAt: restEndsAt ?? undefined,
        remainingSets:
          currentEx && log
            ? findExerciseLog(log, currentEx.id)?.sets.filter((s) => !s.completed).length
            : undefined,
        weightKg: currentSet?.weightKg,
        machineName: currentMachine?.name,
      })
    }
    publishNowRef.current = publish
    publish()
    const id = window.setInterval(publish, 400)
    const onWake = () => publish()
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [
    flow,
    dateKey,
    plan?.name,
    currentEx,
    selected,
    activeSlot,
    setNumber,
    totalRounds,
    log,
    restSeconds,
    restEndsAt,
    restNext,
    currentSet?.weightKg,
    currentMachine?.name,
    liveExercises,
    selectedExercises,
  ])

  useEffect(() => {
    return () => {
      if (!isWatchMode()) {
        publishSnapshot({ v: 1, at: Date.now(), dateKey, flow: 'idle' })
      }
    }
  }, [dateKey])

  useEffect(() => {
    return subscribeCommands((cmd: LiveCommand) => {
      const handlers = commandRef.current
      if (cmd.type === 'sync') publishNowRef.current()
      if (cmd.type === 'start' && handlers.flow === 'ready') handlers.onStart()
      if (cmd.type === 'tehtud' && handlers.flow === 'active') handlers.onTehtud()
      if (cmd.type === 'skip-rest' && handlers.flow === 'resting') handlers.onSkipRest()
      if (cmd.type === 'finish-exercise' && (handlers.flow === 'ready' || handlers.flow === 'active')) {
        handlers.onFinishEarly()
      }
    })
  }, [])

  if (!plan || !phase || !progress || !log || !liveExercises.length) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-icon" onClick={onBack}>
            ←
          </button>
          <h2>Puhkepäev</h2>
        </header>
        <p className="muted pad">
          {!plan
            ? 'Sellel päeval pole treeningkava.'
            : 'Kaval puuduvad harjutused — lisa need seadetes.'}
        </p>
      </div>
    )
  }

  const dayLog = log

  function toggleSelect(index: number) {
    const exercise = liveExercises[index]
    if (!exercise || isExerciseDone(dayLog, exercise.id)) return
    setSelected((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index)
      if (prev.length >= 2) return [prev[1], index]
      return [...prev, index]
    })
  }

  function beginSelected() {
    if (selected.length === 0) return
    setActiveSlot(0)
    setFlow('ready')
  }

  function recordStart() {
    const now = Date.now()
    if (sessionStartedAt.current === null) sessionStartedAt.current = now
    if (lastTehtudAt.current !== null) {
      restMsAcc.current += now - lastTehtudAt.current
      lastTehtudAt.current = null
    }
    setStartedAt.current = now
  }

  function recordTehtud() {
    const now = Date.now()
    if (setStartedAt.current !== null) {
      workMsAcc.current += now - setStartedAt.current
      setStartedAt.current = null
    }
    lastTehtudAt.current = now
  }

  function withFinishStats(next: DayLog): DayLog {
    const now = Date.now()
    if (setStartedAt.current !== null) {
      workMsAcc.current += now - setStartedAt.current
      setStartedAt.current = null
    }
    lastTehtudAt.current = null
    const started =
      sessionStartedAt.current !== null
        ? new Date(sessionStartedAt.current).toISOString()
        : next.startedAt ?? new Date(now).toISOString()
    if (sessionStartedAt.current === null) sessionStartedAt.current = now
    return {
      ...next,
      startedAt: started,
      finishedAt: new Date(now).toISOString(),
      workMs: workMsAcc.current,
      restMs: restMsAcc.current,
    }
  }

  function goToPicker() {
    setSelected([])
    setActiveSlot(0)
    if (allExercisesDone(dayLog, liveExercises)) {
      commitLog(withFinishStats(dayLog))
      setFlow('sauna')
      return
    }
    setFlow('pick')
  }

  function markSetComplete(exerciseId: string, si: number, next: DayLog): DayLog {
    return {
      ...next,
      exercises: next.exercises.map((ex) =>
        ex.exerciseId !== exerciseId
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, i) => (i === si ? { ...s, completed: true } : s)),
            },
      ),
    }
  }

  function startRest(pause: number, nextLog: DayLog, nextSlot: number) {
    const nextEx = liveExercises[selected[nextSlot]]
    const hint = remainingSetsHint(nextLog, selectedExercises)
    const nextName = nextEx?.name ?? currentEx?.name ?? ''
    const nextHint = nextName ? `Järgmisena: ${nextName}` : ''
    const endsAt = Date.now() + pause * 1000
    setRestSeconds(pause)
    setRestHint(hint)
    setRestNext(nextHint)
    setRestEndsAt(endsAt)
    pendingAfterRest.current = 'ready'
    setActiveSlot(nextSlot)
    saveRestSession({
      dateKey,
      endsAt,
      durationSeconds: pause,
      hint,
      next: nextHint,
      pending: 'ready',
      selected,
      activeSlot: nextSlot,
    })
    setFlow('resting')
  }

  function handleTehtud() {
    if (!currentEx || !currentSet) return

    recordTehtud()
    const next = markSetComplete(currentEx.id, setIndex, dayLog)
    const pause = Math.max(0, currentEx.restSeconds)
    const thisDone = isExerciseDone(next, currentEx.id)
    const otherSlot = activeSlot === 0 ? 1 : 0
    const otherExercise = selected.length === 2 ? liveExercises[selected[otherSlot]] : undefined
    const otherStillOpen = otherExercise ? !isExerciseDone(next, otherExercise.id) : false
    const action = afterSetAction({
      selectedLength: selected.length,
      activeSlot,
      thisDone,
      otherStillOpen,
      allDone: allExercisesDone(next, liveExercises),
    })

    if (action.kind === 'sauna') {
      commitLog(withFinishStats(next))
      setFlow('sauna')
      return
    }

    commitLog(next)

    if (action.kind === 'pick') {
      setSelected([])
      setActiveSlot(0)
      setFlow('pick')
      return
    }

    if (!action.rest || pause <= 0) {
      setActiveSlot(action.nextSlot)
      setFlow('ready')
      return
    }

    startRest(pause, next, action.nextSlot)
  }

  function handleFinishEarly() {
    if (!currentEx) return
    if (flow === 'active') recordTehtud()
    const next: DayLog = {
      ...dayLog,
      exercises: dayLog.exercises.map((ex) =>
        ex.exerciseId !== currentEx.id ? ex : { ...ex, finishedEarly: true },
      ),
    }

    if (selected.length === 2) {
      const other = selected.find((i) => i !== currentExIndex)
      const otherExercise = other !== undefined ? liveExercises[other] : undefined
      if (otherExercise && !isExerciseDone(next, otherExercise.id)) {
        commitLog(next)
        setSelected([other!])
        setActiveSlot(0)
        setShowSetMenu(false)
        setFlow('ready')
        return
      }
    }

    setShowSetMenu(false)
    if (allExercisesDone(next, liveExercises)) {
      commitLog(withFinishStats(next))
      setFlow('sauna')
      return
    }
    commitLog(next)
    setSelected([])
    setActiveSlot(0)
    setFlow('pick')
  }

  function jumpToSet(n: number) {
    if (!currentEx) return
    const logged = findExerciseLog(dayLog, currentEx.id)
    if (!logged) return
    const targetIndex = Math.max(0, Math.min(n - 1, logged.sets.length - 1))
    const next: DayLog = {
      ...dayLog,
      exercises: dayLog.exercises.map((ex) =>
        ex.exerciseId !== currentEx.id
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, i) => ({
                ...s,
                completed: i < targetIndex,
              })),
              finishedEarly: false,
            },
      ),
    }
    commitLog(next)
    setShowSetMenu(false)
    setFlow('ready')
  }

  function handleAllDone() {
    handleFinishEarly()
  }

  function patchSet(exerciseId: string, si: number, patch: Partial<SetLog>) {
    const next: DayLog = {
      ...dayLog,
      exercises: dayLog.exercises.map((ex) =>
        ex.exerciseId !== exerciseId
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, i) => {
                if (i === si) return { ...s, ...patch }
                if (i > si && !s.completed) return { ...s, ...patch }
                return s
              }),
            },
      ),
    }
    commitLog(next)
  }

  function switchSetMachine(exerciseId: string, si: number, machineId: string) {
    if (!phase) return
    const ex = liveExercises.find((item) => item.id === exerciseId)
    if (!ex) return
    if (machineId === '__add__') {
      const exIndex = liveExercises.findIndex((item) => item.id === exerciseId)
      setAddPink({ exIndex, setIndex: si, name: '', baseWeightKg: '' })
      return
    }
    const m = getMachine(ex, machineId) ?? getPrimaryMachine(ex)
    const weight = weightForSelectedMachine(state, ex, m.id, dateKey, phase)
    patchSet(exerciseId, si, { machineId: m.id, weightKg: weight })
  }

  function saveNewPink() {
    if (!addPink || !phase) return
    const name = addPink.name.trim()
    const base = Number(addPink.baseWeightKg)
    if (!name || !Number.isFinite(base) || base < 0) return
    const ex = liveExercises[addPink.exIndex]
    if (!ex) return
    const m = createMachine(name, base)
    onChangeState(addMachineToExercise(state, ex.id, m))
    const weight = suggestedWeight(m.baseWeightKg, phase.weightMultiplier)
    patchSet(ex.id, addPink.setIndex, { machineId: m.id, weightKg: weight })
    setAddPink(null)
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function onStartPointerDown() {
    longPressFired.current = false
    tehtudArmed.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      setShowSetMenu(true)
    }, 550)
  }

  function onStartPointerUp() {
    clearLongPress()
    if (longPressFired.current) return
    if (flow === 'ready') {
      recordStart()
      tehtudArmed.current = false
      setFlow('active')
    }
  }

  function onTehtudPointerDown() {
    tehtudArmed.current = true
  }

  function onTehtudPointerUp() {
    if (!tehtudArmed.current) return
    tehtudArmed.current = false
    if (flow !== 'active') return
    handleTehtud()
  }

  function onTehtudPointerCancel() {
    tehtudArmed.current = false
  }

  commandRef.current = {
    flow,
    onStart: onStartPointerUp,
    onTehtud: handleTehtud,
    onSkipRest: endRest,
    onFinishEarly: handleFinishEarly,
  }

  if (flow === 'sauna') {
    const totalMs = workoutTotalMs(dayLog)
    const workMs = dayLog.workMs ?? 0
    const restMs = dayLog.restMs ?? 0
    const missed = liveExercises.filter((ex) => !isExerciseDone(dayLog, ex.id))
    return (
      <div className="screen sauna-screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-icon" onClick={onBack}>
            ←
          </button>
          <h2>{plan.name}</h2>
        </header>
        <div className="sauna-hero">
          <p className="sauna-word">{missed.length ? 'Peatatud' : 'Sauna!'}</p>
          <p className="muted">
            {missed.length
              ? 'Tänane treening on lõpetatud. Tegemata harjutused on logis punased.'
              : 'Selle päeva treeningud on läbi.'}
          </p>

          {missed.length > 0 && (
            <ul className="missed-list">
              {missed.map((ex) => {
                const doneSets = completedCount(dayLog, ex.id)
                const total = findExerciseLog(dayLog, ex.id)?.sets.length ?? exerciseRounds(ex)
                return (
                  <li key={ex.id} className="missed-row">
                    <span className="missed-mark">✕</span>
                    <div>
                      <p className="plan-name">{ex.name}</p>
                      <p className="muted small">
                        Tegemata · {doneSets}/{total} seeriat
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="sauna-stats">
            <div className="sauna-stat-row">
              <span className="muted">Kogu trenn</span>
              <strong>{formatDuration(totalMs)}</strong>
            </div>
            <div className="sauna-stat-row">
              <span className="muted">Harjutused</span>
              <strong>{formatDuration(workMs)}</strong>
            </div>
            <div className="sauna-stat-row">
              <span className="muted">Pausid</span>
              <strong>{formatDuration(restMs)}</strong>
            </div>
          </div>

          <button type="button" className="btn btn-hero" onClick={onFinish}>
            Valmis
          </button>
        </div>
      </div>
    )
  }

  if (flow === 'resting') {
    return (
      <div className="screen workout-screen">
        <RestTimer
          endsAt={restEndsAt ?? Date.now() + restSeconds * 1000}
          durationSeconds={Math.max(1, restSeconds)}
          remainingHint={restHint}
          nextHint={restNext}
          onComplete={endRest}
          onSkip={endRest}
          onExtend={extendRest}
        />
      </div>
    )
  }

  if (flow === 'pick') {
    return (
      <div className="screen workout-screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-icon" onClick={onBack}>
            ←
          </button>
          <div className="topbar-title">
            <h2>{plan.name}</h2>
            <p className="muted small">
              {weekdayFull(weekday)} · {formatDayMonth(date)}
            </p>
          </div>
            <span className="phase-pill" data-phase={phaseToneKey(phase.id)}>
              {phase.name}
            </span>
        </header>

        <p className="muted pad">
          Vali harjutus (või kaks, et teha segamini). Segamini: paus ainult pärast teist harjutust.
        </p>

        <ul className="pick-list">
          {liveExercises.map((ex, index) => {
            const logged = findExerciseLog(dayLog, ex.id)
            const done = isExerciseDone(dayLog, ex.id)
            const doneSets = completedCount(dayLog, ex.id)
            const total = logged?.sets.length ?? exerciseRounds(ex)
            const isOn = selected.includes(index)
            const finishedEarly = Boolean(dayLog.finishedAt) && !done
            const earlyDone = Boolean(logged?.finishedEarly)
            return (
              <li key={ex.id}>
                <button
                  type="button"
                  className={`pick-row ${isOn ? 'is-selected' : ''} ${done ? 'is-done' : ''} ${finishedEarly ? 'is-missed' : ''}`}
                  onClick={() => toggleSelect(index)}
                  disabled={done || Boolean(dayLog.finishedAt)}
                >
                  <span className={`pick-check ${finishedEarly ? 'is-missed' : ''}`}>
                    {done ? '✓' : finishedEarly ? '✕' : isOn ? '●' : '○'}
                  </span>
                  <div>
                    <p className="plan-name">{ex.name}</p>
                    <p className="muted small">
                      {done
                        ? earlyDone
                          ? `Tehtud · ${doneSets}/${total} seeriat`
                          : 'Tehtud'
                        : finishedEarly
                          ? `Tegemata · ${doneSets}/${total} seeriat`
                          : `${doneSets}/${total} seeriat`}
                      {isOn && selected.length === 2
                        ? ` · segamini #${selected.indexOf(index) + 1}`
                        : ''}
                    </p>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>

        {remainingExercises.length === 0 && (
          <button
            type="button"
            className="btn btn-primary full"
            onClick={() => {
              commitLog(withFinishStats(dayLog))
              setFlow('sauna')
            }}
          >
            Lõpeta → Sauna!
          </button>
        )}

        {selected.length > 0 && remainingExercises.length > 0 && (
          <div className="tehtud-dock">
            <button type="button" className="btn btn-tehtud-lg watch-start" onClick={beginSelected}>
              Start
            </button>
          </div>
        )}
      </div>
    )
  }

  const setsToShow =
    compact && currentLog
      ? currentLog.sets
          .map((set, si) => ({ set, si }))
          .filter(({ si }) => si === setIndex)
      : currentLog
        ? currentLog.sets.map((set, si) => ({ set, si }))
        : []

  return (
    <div className="screen workout-screen guided-workout">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={goToPicker}>
          ←
        </button>
        <div className="topbar-title">
          <h2>{currentEx?.name ?? plan.name}</h2>
          <p className="muted small">
            Seeria <strong>{setNumber}</strong> / {totalRounds}
            {selected.length === 2 ? ' · segamini' : ''}
          </p>
        </div>
      </header>

      {currentEx && currentLog && (
        <div className="guided-card">
          {selected.length === 2 && (
            <div className="mix-tabs">
              {selected.map((ei, slot) => (
                <button
                  key={ei}
                  type="button"
                  className={`mix-tab ${slot === activeSlot ? 'is-on' : ''}`}
                  onClick={() => setActiveSlot(slot)}
                  disabled={flow === 'active'}
                >
                  {liveExercises[ei]?.name}
                </button>
              ))}
            </div>
          )}

          <h3 className="guided-title">{currentEx.name}</h3>

          {currentSet && currentMachine && (
            <div className="workout-now">
              <div className="workout-now-row">
                <span className="muted">Pink</span>
                <strong>
                  {currentMachine.name} ({currentMachine.baseWeightKg} kg baas)
                </strong>
              </div>
              <div className="workout-now-row">
                <span className="muted">Raskus</span>
                <strong>{currentSet.weightKg} kg</strong>
              </div>
              <div className="workout-now-row">
                <span className="muted">Seeria</span>
                <strong>
                  {setNumber} / {totalRounds}
                </strong>
              </div>
              <div className="workout-now-row">
                <span className="muted">Kordust korraga</span>
                <strong>
                  {phase.setsMin}–{phase.setsMax}
                </strong>
              </div>
              <div className="workout-now-row">
                <span className="muted">Paus</span>
                <strong>
                  {selected.length === 2 ? 'pärast 2. harjutust · ' : ''}
                  {currentEx.restSeconds}s
                </strong>
              </div>
            </div>
          )}

          <p className="muted small">
            Pink ja raskus esimesel seerial lähevad automaatselt ka järgmistesse. Hoia Starti, et
            hüpata seeriale.
          </p>

          <div className="set-list">
            {setsToShow.map(({ set, si }) => {
              const rowMachine =
                getMachine(currentEx, set.machineId) ?? getPrimaryMachine(currentEx)
              const targetKg = suggestedWeight(rowMachine.baseWeightKg, phase.weightMultiplier)
              const isCurrent = si === setIndex && !set.completed
              const pinkId = `pink-${currentEx.id}-${si}`
              const kgId = `kg-${currentEx.id}-${si}`
              return (
                <div
                  key={si}
                  className={`set-row ${set.completed ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}
                >
                  <div className="field set-pink-field">
                    <label htmlFor={pinkId}>Pink</label>
                    <select
                      id={pinkId}
                      value={set.machineId}
                      onChange={(e) => switchSetMachine(currentEx.id, si, e.target.value)}
                      disabled={set.completed || (flow === 'active' && !isCurrent)}
                    >
                      {currentEx.machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                      <option value="__add__">+ Lisa pink…</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={kgId}>kg</label>
                    <input
                      id={kgId}
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      value={set.weightKg}
                      onChange={(e) =>
                        patchSet(currentEx.id, si, {
                          weightKg: Number(e.target.value) || 0,
                        })
                      }
                      disabled={set.completed || (flow === 'active' && !isCurrent)}
                    />
                  </div>
                  <div className="field set-round-field">
                    <label>Seeria</label>
                    <span className="set-round-num">{si + 1}</span>
                  </div>
                  <span className="set-status" aria-hidden>
                    {set.completed ? '✓' : isCurrent ? '→' : ''}
                  </span>
                  {!set.completed && isCurrent && (
                    <span className="muted small set-hint">
                      {lastWeightForMachine(state, currentEx, rowMachine.id, dateKey) != null
                        ? `eelmine ${lastWeightForMachine(state, currentEx, rowMachine.id, dateKey)} kg`
                        : `soovitus ${targetKg} kg`}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="tehtud-dock">
        {flow === 'ready' && (
          <button
            type="button"
            className="btn btn-tehtud-lg watch-start"
            onPointerDown={onStartPointerDown}
            onPointerUp={onStartPointerUp}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onContextMenu={(e) => e.preventDefault()}
          >
            Start
          </button>
        )}
        {flow === 'active' && (
          <button
            type="button"
            className="btn btn-tehtud-lg"
            onPointerDown={onTehtudPointerDown}
            onPointerUp={onTehtudPointerUp}
            onPointerLeave={onTehtudPointerCancel}
            onPointerCancel={onTehtudPointerCancel}
            onClick={(e) => e.preventDefault()}
          >
            Tehtud
          </button>
        )}
        {(flow === 'ready' || flow === 'active') && (
          <button type="button" className="btn btn-ghost full" onClick={handleFinishEarly}>
            Lõpeta harjutus
          </button>
        )}
      </div>

      {showSetMenu && currentLog && (
        <div className="timer-overlay" role="dialog" aria-label="Muuda seeriat">
          <div className="timer-card add-pink-card">
            <p className="timer-label">Seeria</p>
            <p className="muted small">Vali, mitmenda seeriaga jätkad, või lõpeta harjutus varem.</p>
            <div className="set-jump-grid">
              {currentLog.sets.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`btn btn-secondary set-jump ${i + 1 === setNumber ? 'is-current' : ''}`}
                  onClick={() => jumpToSet(i + 1)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary full" onClick={handleAllDone}>
              Lõpeta harjutus
            </button>
            <button type="button" className="btn btn-ghost full" onClick={() => setShowSetMenu(false)}>
              Tagasi
            </button>
          </div>
        </div>
      )}

      {addPink && (
        <div className="timer-overlay" role="dialog" aria-label="Lisa pink">
          <div className="timer-card add-pink-card">
            <p className="timer-label">Uus pink</p>
            <div className="field block">
              <label htmlFor="new-pink-name">Pink</label>
              <input
                id="new-pink-name"
                type="text"
                value={addPink.name}
                onChange={(e) => setAddPink({ ...addPink, name: e.target.value })}
              />
            </div>
            <div className="field block">
              <label htmlFor="new-pink-kg">Baas kg</label>
              <input
                id="new-pink-kg"
                type="number"
                step="0.5"
                value={addPink.baseWeightKg}
                onChange={(e) => setAddPink({ ...addPink, baseWeightKg: e.target.value })}
              />
            </div>
            <div className="timer-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAddPink(null)}>
                Tagasi
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveNewPink}
                disabled={!addPink.name.trim() || addPink.baseWeightKg === ''}
              >
                Salvesta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
