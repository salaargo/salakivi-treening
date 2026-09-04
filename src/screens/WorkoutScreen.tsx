import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppState, DayLog, ExerciseLog, ExerciseTemplate, SetLog } from '../types'
import { formatDayMonth, parseDateKey, weekdayFull } from '../dates'
import {
  addMachineToExercise,
  getExercisesForGroup,
  getGroupForDate,
  getPhaseProgressForGroup,
} from '../storage'
import { createMachine, exerciseRounds, getMachine, getPrimaryMachine } from '../exercises'
import { suggestedWeight } from '../phases'
import { RestTimer } from '../components/RestTimer'

interface WorkoutScreenProps {
  state: AppState
  dateKey: string
  onBack: () => void
  onFinish: () => void
  onUpdateLog: (log: DayLog) => void
  onChangeState: (next: AppState) => void
  onRegisterLiveLog?: (getter: (() => DayLog | null) | null) => void
}

interface AddPinkForm {
  exIndex: number
  setIndex: number
  name: string
  baseWeightKg: string
}

type Flow = 'pick' | 'ready' | 'active' | 'resting' | 'sauna'

function buildExerciseLog(ex: ExerciseTemplate, phase: AppState['phases'][number]): ExerciseLog {
  const machine = getPrimaryMachine(ex)
  return {
    exerciseId: ex.id,
    sets: Array.from({ length: exerciseRounds(ex) }, () => ({
      machineId: machine.id,
      weightKg: suggestedWeight(machine.baseWeightKg, phase.weightMultiplier),
      reps: phase.setsMin,
      completed: false,
    })),
  }
}

function logMatchesExercises(existing: DayLog, exercises: ExerciseTemplate[]): boolean {
  if (existing.exercises.length !== exercises.length) return false
  return exercises.every((ex, index) => {
    const logged = existing.exercises[index]
    return logged?.exerciseId === ex.id && logged.sets.length === exerciseRounds(ex)
  })
}

function findExerciseLog(log: DayLog, exerciseId: string): ExerciseLog | undefined {
  return log.exercises.find((entry) => entry.exerciseId === exerciseId)
}

function buildInitialLog(state: AppState, dateKey: string): DayLog | null {
  const group = getGroupForDate(state, dateKey)
  if (!group) return null
  const exercises = getExercisesForGroup(state, group.id)
  if (!exercises.length) return null

  const progress = getPhaseProgressForGroup(state, group.id, dateKey)
  const phase = progress.phase

  const existing = state.logs[dateKey]
  if (
    existing &&
    existing.groupId === group.id &&
    existing.phaseId === phase.id &&
    logMatchesExercises(existing, exercises)
  ) {
    return existing
  }

  return {
    dateKey,
    groupId: group.id,
    phaseId: phase.id,
    exercises: exercises.map((ex) => buildExerciseLog(ex, phase)),
  }
}

function completedCount(log: DayLog, exerciseId: string): number {
  return findExerciseLog(log, exerciseId)?.sets.filter((s) => s.completed).length ?? 0
}

function isExerciseDone(log: DayLog, exerciseId: string): boolean {
  const sets = findExerciseLog(log, exerciseId)?.sets
  return Boolean(sets?.length && sets.every((s) => s.completed))
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

export function WorkoutScreen({
  state,
  dateKey,
  onBack,
  onFinish,
  onUpdateLog,
  onChangeState,
  onRegisterLiveLog,
}: WorkoutScreenProps) {
  const date = parseDateKey(dateKey)
  const weekday = date.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const group = getGroupForDate(state, dateKey)
  const progress = group ? getPhaseProgressForGroup(state, group.id, dateKey) : null
  const phase = progress?.phase ?? null
  const liveExercises = group ? getExercisesForGroup(state, group.id) : []

  const [log, setLog] = useState<DayLog | null>(() => buildInitialLog(state, dateKey))
  const [flow, setFlow] = useState<Flow>(() => {
    const initial = buildInitialLog(state, dateKey)
    if (!initial) return 'pick'
    const exercises = group ? getExercisesForGroup(state, group.id) : []
    if (initial.finishedAt || (exercises.length > 0 && allExercisesDone(initial, exercises))) {
      return 'sauna'
    }
    return 'pick'
  })
  const [selected, setSelected] = useState<number[]>([])
  const [activeSlot, setActiveSlot] = useState(0)
  const [restSeconds, setRestSeconds] = useState(60)
  const [showSetMenu, setShowSetMenu] = useState(false)
  const [addPink, setAddPink] = useState<AddPinkForm | null>(null)

  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const tehtudArmed = useRef(false)
  const pendingAfterRest = useRef<'ready' | 'pick'>('ready')
  const sessionStartedAt = useRef<number | null>(
    log?.startedAt ? Date.parse(log.startedAt) || null : null,
  )
  const setStartedAt = useRef<number | null>(null)
  const lastTehtudAt = useRef<number | null>(null)
  const workMsAcc = useRef(log?.workMs ?? 0)
  const restMsAcc = useRef(log?.restMs ?? 0)

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
    if (pendingAfterRest.current === 'pick') {
      setSelected([])
      setActiveSlot(0)
      setFlow('pick')
      return
    }
    setFlow('ready')
  }, [])

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

  if (!group || !phase || !progress || !log || !liveExercises.length) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-icon" onClick={onBack}>
            ←
          </button>
          <h2>Puhkepäev</h2>
        </header>
        <p className="muted pad">
          {!group
            ? 'Sellel päeval pole treeninggruppi.'
            : 'Grupil puuduvad harjutused — lisa kava seadetes.'}
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

  function markExerciseAllDone(exerciseId: string): DayLog {
    return {
      ...dayLog,
      exercises: dayLog.exercises.map((ex) =>
        ex.exerciseId !== exerciseId
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s) => ({ ...s, completed: true })),
            },
      ),
    }
  }

  function handleTehtud() {
    if (!currentEx || !currentSet) return

    recordTehtud()
    const next = markSetComplete(currentEx.id, setIndex, dayLog)
    const pause = Math.max(0, currentEx.restSeconds)
    const thisDone = isExerciseDone(next, currentEx.id)

    if (allExercisesDone(next, liveExercises)) {
      commitLog(withFinishStats(next))
      setFlow('sauna')
      return
    }

    let nextSlot = activeSlot
    let goPick = false

    if (selected.length === 2) {
      const otherSlot = activeSlot === 0 ? 1 : 0
      const otherIndex = selected[otherSlot]
      const otherExercise = liveExercises[otherIndex]
      const otherStillOpen = otherExercise ? !isExerciseDone(next, otherExercise.id) : false
      if (otherStillOpen) {
        nextSlot = otherSlot
      } else if (thisDone) {
        goPick = true
      }
    } else if (thisDone) {
      goPick = true
    }

    commitLog(next)
    if (goPick) {
      pendingAfterRest.current = 'pick'
    } else {
      setActiveSlot(nextSlot)
      pendingAfterRest.current = 'ready'
    }

    if (pause <= 0) {
      endRest()
      return
    }

    setRestSeconds(pause)
    setFlow('resting')
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
            },
      ),
    }
    commitLog(next)
    setShowSetMenu(false)
    setFlow('ready')
  }

  function handleAllDone() {
    if (!currentEx) return
    recordTehtud()
    const next = markExerciseAllDone(currentEx.id)
    if (selected.length === 2) {
      const other = selected.find((i) => i !== currentExIndex)!
      const otherExercise = liveExercises[other]
      if (otherExercise && !isExerciseDone(next, otherExercise.id)) {
        commitLog(next)
        setSelected([other])
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
    setFlow('pick')
  }

  function patchSet(exerciseId: string, si: number, patch: Partial<SetLog>) {
    const next: DayLog = {
      ...dayLog,
      exercises: dayLog.exercises.map((ex) =>
        ex.exerciseId !== exerciseId
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, i) => (i === si ? { ...s, ...patch } : s)),
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
    const weight = suggestedWeight(m.baseWeightKg, phase.weightMultiplier)
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
      // Väldi, et sama puudutus vajutaks kohe uuele Tehtud-nupule
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
          <h2>{group.name}</h2>
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
        <RestTimer seconds={restSeconds} onComplete={endRest} onSkip={endRest} />
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
            <h2>{group.name}</h2>
            <p className="muted small">
              {weekdayFull(weekday)} · {formatDayMonth(date)}
            </p>
          </div>
          {selected.length > 0 ? (
            <button type="button" className="btn btn-corner-start" onClick={beginSelected}>
              Start
            </button>
          ) : (
            <span className="phase-pill" data-phase={phase.id}>
              {phase.name}
            </span>
          )}
        </header>

        <p className="muted pad">
          Vali harjutus (või kaks, et teha segamini). Järjekord on sinu kavas.
        </p>

        <ul className="pick-list">
          {liveExercises.map((ex, index) => {
            const logged = findExerciseLog(dayLog, ex.id)
            const done = isExerciseDone(dayLog, ex.id)
            const doneSets = completedCount(dayLog, ex.id)
            const total = logged?.sets.length ?? exerciseRounds(ex)
            const isOn = selected.includes(index)
            const finishedEarly = Boolean(dayLog.finishedAt) && !done
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
                        ? 'Tehtud'
                        : finishedEarly
                          ? `Tegemata · ${doneSets}/${total} seeriat`
                          : `${doneSets}/${total} kordust`}
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
      </div>
    )
  }

  // ready | active

  return (
    <div className="screen workout-screen guided-workout">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={goToPicker}>
          ←
        </button>
        <div className="topbar-title">
          <h2>{currentEx?.name ?? group.name}</h2>
          <p className="muted small">
            Kordus <strong>{setNumber}</strong> / {totalRounds}
            {selected.length === 2 ? ' · segamini' : ''}
          </p>
        </div>
        {flow === 'ready' && (
          <button
            type="button"
            className="btn btn-corner-start"
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
            className="btn btn-corner-done"
            onPointerDown={onTehtudPointerDown}
            onPointerUp={onTehtudPointerUp}
            onPointerLeave={onTehtudPointerCancel}
            onPointerCancel={onTehtudPointerCancel}
            onClick={(e) => e.preventDefault()}
          >
            Tehtud
          </button>
        )}
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
                <span className="muted">Kordi</span>
                <strong>
                  {totalRounds} korda · {setNumber}. kordus
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
                <strong>{currentEx.restSeconds}s</strong>
              </div>
            </div>
          )}

          <p className="muted small">
            Vali iga korduse juures pink. Hoia Starti peal, et muuta kordust või märkida kõik tehtud.
          </p>

          <div className="set-list">
            {currentLog.sets.map((set, si) => {
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
                    <span className="muted small set-hint">soovitus {targetKg} kg</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showSetMenu && currentLog && (
        <div className="timer-overlay" role="dialog" aria-label="Muuda kordust">
          <div className="timer-card add-pink-card">
            <p className="timer-label">Kordus</p>
            <p className="muted small">Vali, mitmenda kordusega jätkad, või märgi kõik tehtud.</p>
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
              Kõik tehtud
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
