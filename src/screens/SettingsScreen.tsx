import { useState } from 'react'
import type {
  AppState,
  ExerciseMachine,
  ExerciseTemplate,
  Phase,
  PhaseId,
  TrainingGroup,
  Weekday,
  WeekTemplate,
  WorkoutPlan,
} from '../types'
import { createEmptyWeekTemplate, weekdayFull, startOfWeekMonday, toDateKey } from '../dates'
import {
  buildPhaseDescription,
  cycleWeeks,
  DEFAULT_REST_SECONDS,
} from '../phases'
import { createMachine, withDefaultMachine } from '../exercises'
import {
  getGroup,
  getPhaseProgressForGroup,
  getPhaseForGroup,
  WEEK_ORDER,
} from '../storage'

interface SettingsScreenProps {
  state: AppState
  onChange: (next: AppState) => void
  onBack: () => void
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function SettingsScreen({ state, onChange, onBack }: SettingsScreenProps) {
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingWeekId, setEditingWeekId] = useState<string | null>(null)
  const [editingPhaseId, setEditingPhaseId] = useState<PhaseId | null>(null)
  const editing = state.plans.find((p) => p.id === editingPlanId) ?? null
  const editingGroup = state.groups.find((g) => g.id === editingGroupId) ?? null
  const editingWeek = state.weeks.find((w) => w.id === editingWeekId) ?? null
  const editingPhase = state.phases.find((p) => p.id === editingPhaseId) ?? null
  const totalCycleWeeks = cycleWeeks(state.phases)

  function updatePhase(phaseId: PhaseId, patch: Partial<Phase>) {
    onChange({
      ...state,
      phases: state.phases.map((p) => {
        if (p.id !== phaseId) return p
        const next = { ...p, ...patch }
        if (next.setsMax < next.setsMin) next.setsMax = next.setsMin
        if (next.weeks < 1) next.weeks = 1
        if (next.setsMin < 1) next.setsMin = 1
        if (next.weightMultiplier <= 0) next.weightMultiplier = 0.01
        next.description = buildPhaseDescription(next)
        return next
      }),
    })
  }

  function updatePlan(planId: string, patch: Partial<WorkoutPlan>) {
    onChange({
      ...state,
      plans: state.plans.map((p) => (p.id === planId ? { ...p, ...patch } : p)),
    })
  }

  function updateExercise(
    planId: string,
    exIndex: number,
    patch: Partial<ExerciseTemplate>,
  ) {
    onChange({
      ...state,
      plans: state.plans.map((p) =>
        p.id !== planId
          ? p
          : {
              ...p,
              exercises: p.exercises.map((ex, i) =>
                i === exIndex ? { ...ex, ...patch } : ex,
              ),
            },
      ),
    })
  }

  function updateMachine(
    planId: string,
    exIndex: number,
    machineIndex: number,
    patch: Partial<ExerciseMachine>,
  ) {
    onChange({
      ...state,
      plans: state.plans.map((p) =>
        p.id !== planId
          ? p
          : {
              ...p,
              exercises: p.exercises.map((ex, i) =>
                i !== exIndex
                  ? ex
                  : {
                      ...ex,
                      machines: ex.machines.map((m, mi) =>
                        mi === machineIndex ? { ...m, ...patch } : m,
                      ),
                    },
              ),
            },
      ),
    })
  }

  function addMachine(planId: string, exIndex: number) {
    const machine = createMachine(`Pink ${Date.now() % 1000}`, 20)
    onChange({
      ...state,
      plans: state.plans.map((p) =>
        p.id !== planId
          ? p
          : {
              ...p,
              exercises: p.exercises.map((ex, i) =>
                i === exIndex ? { ...ex, machines: [...ex.machines, machine] } : ex,
              ),
            },
      ),
    })
  }

  function removeMachine(planId: string, exIndex: number, machineIndex: number) {
    onChange({
      ...state,
      plans: state.plans.map((p) =>
        p.id !== planId
          ? p
          : {
              ...p,
              exercises: p.exercises.map((ex, i) => {
                if (i !== exIndex || ex.machines.length <= 1) return ex
                return {
                  ...ex,
                  machines: ex.machines.filter((_, mi) => mi !== machineIndex),
                }
              }),
            },
      ),
    })
  }

  function updateGroup(groupId: string, patch: Partial<TrainingGroup>) {
    onChange({
      ...state,
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
      plans:
        typeof patch.name === 'string'
          ? state.plans.map((p) =>
              p.groupId === groupId ? { ...p, name: patch.name as string } : p,
            )
          : state.plans,
    })
  }

  function updateWeek(weekId: string, patch: Partial<WeekTemplate>) {
    onChange({
      ...state,
      weeks: state.weeks.map((w) => (w.id === weekId ? { ...w, ...patch } : w)),
    })
  }

  function assignWeekDay(weekId: string, weekday: Weekday, groupId: string | null) {
    onChange({
      ...state,
      weeks: state.weeks.map((w) =>
        w.id !== weekId ? w : { ...w, days: { ...w.days, [weekday]: groupId } },
      ),
    })
  }

  function addWeek() {
    const week = createEmptyWeekTemplate(`Nädal ${state.weeks.length + 1}`)
    onChange({ ...state, weeks: [...state.weeks, week] })
    setEditingWeekId(week.id)
  }

  function removeWeek(weekId: string) {
    if (state.weeks.length <= 2) return
    onChange({
      ...state,
      weeks: state.weeks.filter((w) => w.id !== weekId),
    })
    if (editingWeekId === weekId) setEditingWeekId(null)
  }

  function addGroup() {
    const group: TrainingGroup = {
      id: newId('group'),
      name: `Grupp ${state.groups.length + 1}`,
      cycleStartDate: toDateKey(startOfWeekMonday(new Date())),
    }
    onChange({ ...state, groups: [...state.groups, group] })
    setEditingGroupId(group.id)
  }

  function removeGroup(groupId: string) {
    if (state.groups.length <= 1) return
    const fallback = state.groups.find((g) => g.id !== groupId)!.id
    onChange({
      ...state,
      groups: state.groups.filter((g) => g.id !== groupId),
      plans: state.plans.map((p) =>
        p.groupId === groupId ? { ...p, groupId: fallback } : p,
      ),
      weeks: state.weeks.map((w) => ({
        ...w,
        days: Object.fromEntries(
          Object.entries(w.days).map(([day, id]) => [day, id === groupId ? null : id]),
        ) as WeekTemplate['days'],
      })),
    })
    if (editingGroupId === groupId) setEditingGroupId(null)
  }

  function addPlan() {
    const group = state.groups[0]
    if (!group) return
    const plan: WorkoutPlan = {
      id: newId('plan'),
      name: group.name,
      groupId: group.id,
      exercises: [withDefaultMachine('Harjutus', 20, DEFAULT_REST_SECONDS, newId('ex'))],
    }
    onChange({ ...state, plans: [...state.plans, plan] })
    setEditingPlanId(plan.id)
  }

  function removePlan(planId: string) {
    onChange({
      ...state,
      plans: state.plans.filter((p) => p.id !== planId),
    })
    if (editingPlanId === planId) setEditingPlanId(null)
  }

  function addExercise(planId: string) {
    const ex = withDefaultMachine('Uus harjutus', 20, DEFAULT_REST_SECONDS, newId('ex'))
    onChange({
      ...state,
      plans: state.plans.map((p) =>
        p.id === planId ? { ...p, exercises: [...p.exercises, ex] } : p,
      ),
    })
  }

  function removeExercise(planId: string, exIndex: number) {
    onChange({
      ...state,
      plans: state.plans.map((p) =>
        p.id === planId
          ? { ...p, exercises: p.exercises.filter((_, i) => i !== exIndex) }
          : p,
      ),
    })
  }

  if (editingPhase) {
    const weightPct = Math.round(editingPhase.weightMultiplier * 100)
    return (
      <div className="screen">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setEditingPhaseId(null)}
            aria-label="Tagasi"
          >
            ←
          </button>
          <h2>Muuda faasi</h2>
        </header>

        <div className="settings-block">
          <span className="phase-pill" data-phase={editingPhase.id}>
            {editingPhase.name}
          </span>
          <p className="muted small">{editingPhase.description}</p>
        </div>

        <div className="field block">
          <label htmlFor="phase-name">Nimi</label>
          <input
            id="phase-name"
            type="text"
            autoComplete="off"
            value={editingPhase.name}
            onChange={(e) => updatePhase(editingPhase.id, { name: e.target.value })}
          />
        </div>

        <div className="field block">
          <label htmlFor="phase-weeks">Kestus (nädalat)</label>
          <div className="stepper">
            <button
              type="button"
              className="btn btn-stepper"
              onClick={() =>
                updatePhase(editingPhase.id, { weeks: Math.max(1, editingPhase.weeks - 1) })
              }
            >
              −
            </button>
            <input
              id="phase-weeks"
              type="number"
              min={1}
              value={editingPhase.weeks}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                updatePhase(editingPhase.id, { weeks: Math.max(1, Math.round(n)) })
              }}
            />
            <button
              type="button"
              className="btn btn-stepper"
              onClick={() => updatePhase(editingPhase.id, { weeks: editingPhase.weeks + 1 })}
            >
              +
            </button>
          </div>
        </div>

        <div className="field-row field-row-2">
          <div className="field">
            <label htmlFor="phase-sets-min">Kordused min</label>
            <input
              id="phase-sets-min"
              type="number"
              min={1}
              value={editingPhase.setsMin}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                updatePhase(editingPhase.id, { setsMin: Math.max(1, Math.round(n)) })
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="phase-sets-max">Kordused max</label>
            <input
              id="phase-sets-max"
              type="number"
              min={1}
              value={editingPhase.setsMax}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                updatePhase(editingPhase.id, { setsMax: Math.max(1, Math.round(n)) })
              }}
            />
          </div>
        </div>

        <div className="field block">
          <label htmlFor="phase-weight">Raskus (% baasist)</label>
          <div className="stepper">
            <button
              type="button"
              className="btn btn-stepper"
              onClick={() =>
                updatePhase(editingPhase.id, {
                  weightMultiplier: Math.max(0.05, (weightPct - 5) / 100),
                })
              }
            >
              −
            </button>
            <input
              id="phase-weight"
              type="number"
              min={5}
              step={5}
              value={weightPct}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                updatePhase(editingPhase.id, {
                  weightMultiplier: Math.max(5, Math.round(n)) / 100,
                })
              }}
            />
            <button
              type="button"
              className="btn btn-stepper"
              onClick={() =>
                updatePhase(editingPhase.id, {
                  weightMultiplier: (weightPct + 5) / 100,
                })
              }
            >
              +
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (editingWeek) {
    return (
      <div className="screen">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setEditingWeekId(null)}
            aria-label="Tagasi"
          >
            ←
          </button>
          <h2>Koosta nädal</h2>
        </header>

        <label className="field block">
          <span>Nimi</span>
          <input
            type="text"
            value={editingWeek.name}
            onChange={(e) => updateWeek(editingWeek.id, { name: e.target.value })}
          />
        </label>

        <p className="muted small pad">Vali igale päevale treeninggrupp või puhkepäev.</p>

        <ul className="assign-list">
          {WEEK_ORDER.map((day) => {
            const groupId = editingWeek.days[day] ?? null
            const group = groupId ? getGroup(state, groupId) : null
            return (
              <li key={day} className="assign-block">
                <div className="assign-row">
                  <span>{weekdayFull(day)}</span>
                  <select
                    value={groupId ?? ''}
                    onChange={(e) =>
                      assignWeekDay(editingWeek.id, day, e.target.value || null)
                    }
                  >
                    <option value="">Puhkepäev</option>
                    {state.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                {group && (
                  <p className="assign-phase muted small">
                    Grupp: <strong>{group.name}</strong>
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        {state.weeks.length > 2 && (
          <button
            type="button"
            className="btn btn-ghost danger full"
            onClick={() => removeWeek(editingWeek.id)}
          >
            Kustuta nädal
          </button>
        )}
      </div>
    )
  }

  if (editingGroup) {
    const progress = getPhaseProgressForGroup(state, editingGroup.id)
    const planCount = state.plans.filter((p) => p.groupId === editingGroup.id).length
    return (
      <div className="screen">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setEditingGroupId(null)}
            aria-label="Tagasi"
          >
            ←
          </button>
          <h2>Muuda gruppi</h2>
        </header>

        <label className="field block">
          <span>Nimi</span>
          <input
            type="text"
            value={editingGroup.name}
            onChange={(e) => updateGroup(editingGroup.id, { name: e.target.value })}
          />
        </label>

        <div className="settings-block">
          <h3>Faasi edenemine</h3>
          <p className="muted small">
            Faas jookseb kalendri järgi. Ring: {totalCycleWeeks} nädalat, pärast viimast faasi
            algab Start uuesti.
          </p>
          <p>
            Praegu:{' '}
            <span className="phase-pill" data-phase={progress.phase.id}>
              {progress.phase.name}
            </span>{' '}
            · nädal {progress.weekInPhase}/{progress.phase.weeks}
          </p>
          <p className="muted small">
            {planCount} kava grupis · harjutused tulevad grupi kavadest
          </p>
        </div>

        {state.groups.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost danger full"
            onClick={() => removeGroup(editingGroup.id)}
          >
            Kustuta grupp
          </button>
        )}
      </div>
    )
  }

  if (editing) {
    const group = getGroup(state, editing.groupId)
    const progress = getPhaseProgressForGroup(state, editing.groupId)
    return (
      <div className="screen">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setEditingPlanId(null)}
            aria-label="Tagasi"
          >
            ←
          </button>
          <h2>Muuda kava</h2>
        </header>

        <label className="field block">
          <span>Grupp</span>
          <select
            value={editing.groupId}
            onChange={(e) => {
              const groupId = e.target.value
              const groupName =
                state.groups.find((g) => g.id === groupId)?.name ?? editing.name
              updatePlan(editing.id, { groupId, name: groupName })
            }}
          >
            {state.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small pad">
          {group?.name ?? 'Grupp'}: faas <strong>{progress.phase.name}</strong>
        </p>

        <div className="exercise-stack">
          {editing.exercises.map((ex, exIndex) => {
            const nameId = `${editing.id}-name-${exIndex}`
            const roundsId = `${editing.id}-rounds-${exIndex}`
            const restId = `${editing.id}-rest-${exIndex}`
            return (
              <section key={`${editing.id}-ex-${exIndex}-${ex.id}`} className="exercise-card compact">
                <div className="field block">
                  <label htmlFor={nameId}>Harjutus</label>
                  <input
                    id={nameId}
                    name={nameId}
                    type="text"
                    autoComplete="off"
                    value={ex.name}
                    onChange={(e) =>
                      updateExercise(editing.id, exIndex, { name: e.target.value })
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor={roundsId}>Seeriat</label>
                  <div className="stepper">
                    <button
                      type="button"
                      className="btn btn-stepper"
                      aria-label="Vähenda kordade arvu"
                      onClick={() =>
                        updateExercise(editing.id, exIndex, {
                          rounds: Math.max(1, ex.rounds - 1),
                        })
                      }
                    >
                      −
                    </button>
                    <input
                      id={roundsId}
                      name={roundsId}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={1}
                      autoComplete="off"
                      value={ex.rounds}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') {
                          updateExercise(editing.id, exIndex, { rounds: 1 })
                          return
                        }
                        const n = Number(raw)
                        if (!Number.isFinite(n)) return
                        updateExercise(editing.id, exIndex, {
                          rounds: Math.max(1, Math.round(n)),
                        })
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-stepper"
                      aria-label="Suurenda kordade arvu"
                      onClick={() =>
                        updateExercise(editing.id, exIndex, {
                          rounds: ex.rounds + 1,
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                </div>

                {ex.machines.map((machine, machineIndex) => {
                  const pinkId = `${editing.id}-pink-${exIndex}-${machineIndex}`
                  const kgId = `${editing.id}-kg-${exIndex}-${machineIndex}`
                  return (
                    <div key={machine.id} className="machine-block">
                      <div className="field-row field-row-2">
                        <div className="field">
                          <label htmlFor={pinkId}>Pink</label>
                          <input
                            id={pinkId}
                            name={pinkId}
                            type="text"
                            autoComplete="off"
                            value={machine.name}
                            onChange={(e) =>
                              updateMachine(editing.id, exIndex, machineIndex, {
                                name: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={kgId}>Baas kg</label>
                          <input
                            id={kgId}
                            name={kgId}
                            type="number"
                            inputMode="decimal"
                            step="0.5"
                            autoComplete="off"
                            value={machine.baseWeightKg}
                            onChange={(e) => {
                              const n = Number(e.target.value)
                              updateMachine(editing.id, exIndex, machineIndex, {
                                baseWeightKg: Number.isFinite(n) ? n : 0,
                              })
                            }}
                          />
                        </div>
                      </div>
                      {ex.machines.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost danger"
                          onClick={() => removeMachine(editing.id, exIndex, machineIndex)}
                        >
                          Eemalda pink
                        </button>
                      )}
                    </div>
                  )
                })}

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => addMachine(editing.id, exIndex)}
                >
                  Lisa pink
                </button>

                <div className="field">
                  <label htmlFor={restId}>Paus s</label>
                  <div className="stepper">
                    <button
                      type="button"
                      className="btn btn-stepper"
                      aria-label="Vähenda pausi"
                      onClick={() =>
                        updateExercise(editing.id, exIndex, {
                          restSeconds: Math.max(0, ex.restSeconds - 5),
                        })
                      }
                    >
                      −
                    </button>
                    <input
                      id={restId}
                      name={restId}
                      type="number"
                      inputMode="numeric"
                      step={5}
                      min={0}
                      autoComplete="off"
                      value={ex.restSeconds}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') {
                          updateExercise(editing.id, exIndex, { restSeconds: 0 })
                          return
                        }
                        const n = Number(raw)
                        if (!Number.isFinite(n)) return
                        updateExercise(editing.id, exIndex, {
                          restSeconds: Math.max(0, Math.round(n)),
                        })
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-stepper"
                      aria-label="Suurenda pausi"
                      onClick={() =>
                        updateExercise(editing.id, exIndex, {
                          restSeconds: ex.restSeconds + 5,
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost danger"
                  onClick={() => removeExercise(editing.id, exIndex)}
                >
                  Eemalda harjutus
                </button>
              </section>
            )
          })}
        </div>

        <button type="button" className="btn btn-secondary full" onClick={() => addExercise(editing.id)}>
          Lisa harjutus
        </button>
        <button type="button" className="btn btn-ghost danger full" onClick={() => removePlan(editing.id)}>
          Kustuta kava
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Tagasi">
          ←
        </button>
        <h2>Seaded</h2>
      </header>

      <section className="settings-block">
        <div className="section-head">
          <h3>Nädala mallid</h3>
          <button type="button" className="btn btn-secondary" onClick={addWeek}>
            Lisa
          </button>
        </div>
        <p className="muted small">
          Koosta vähemalt 2 nädalat. Kalendris käivad need kordamööda (Nädal 1 → 2 → … → 1).
          Päevale vali treeninggrupp.
        </p>
        <ul className="plan-list">
          {state.weeks.map((w, index) => {
            const trainingDays = WEEK_ORDER.filter((d) => w.days[d]).length
            return (
              <li key={w.id}>
                <button type="button" className="plan-row" onClick={() => setEditingWeekId(w.id)}>
                  <div>
                    <p className="plan-name">{w.name}</p>
                    <p className="muted small">
                      Mall {index + 1}/{state.weeks.length} · {trainingDays} treeningpäeva
                    </p>
                  </div>
                  <span className="chevron">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="settings-block">
        <div className="section-head">
          <h3>Grupid</h3>
          <button type="button" className="btn btn-secondary" onClick={addGroup}>
            Lisa
          </button>
        </div>
        <ul className="plan-list">
          {state.groups.map((g) => {
            const progress = getPhaseProgressForGroup(state, g.id)
            const planCount = state.plans.filter((p) => p.groupId === g.id).length
            return (
              <li key={g.id}>
                <button type="button" className="plan-row" onClick={() => setEditingGroupId(g.id)}>
                  <div>
                    <p className="plan-name">{g.name}</p>
                    <p className="muted small">
                      {planCount} kava · {progress.phase.name}
                    </p>
                  </div>
                  <span className="phase-pill" data-phase={progress.phase.id}>
                    {progress.phase.name}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="settings-block">
        <div className="section-head">
          <h3>Treeningkavad</h3>
          <button type="button" className="btn btn-secondary" onClick={addPlan}>
            Lisa
          </button>
        </div>
        <p className="muted small">Kava harjutused kuuluvad gruppi — treeningpäeval jooksevad grupi kavade harjutused.</p>
        <ul className="plan-list">
          {state.plans.map((p) => {
            const group = getGroup(state, p.groupId)
            const phase = getPhaseForGroup(state, p.groupId)
            return (
              <li key={p.id}>
                <button type="button" className="plan-row" onClick={() => setEditingPlanId(p.id)}>
                  <div>
                    <p className="plan-name">{group?.name ?? 'Grupp'}</p>
                    <p className="muted small">{p.exercises.length} harjutust</p>
                  </div>
                  <span className="phase-pill" data-phase={phase.id}>
                    {phase.name}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="settings-block">
        <h3>Faasid</h3>
        <p className="muted small">
          Muuda kestust, kordusi ja raskust. Ring kokku {totalCycleWeeks} nädalat, siis algab
          uuesti.
        </p>
        <ul className="plan-list">
          {state.phases.map((p) => (
            <li key={p.id}>
              <button type="button" className="plan-row" onClick={() => setEditingPhaseId(p.id)}>
                <div>
                  <p className="plan-name">{p.name}</p>
                  <p className="muted small">
                    {p.weeks} näd · {p.setsMin}–{p.setsMax} kordust ·{' '}
                    {Math.round(p.weightMultiplier * 100)}%
                  </p>
                </div>
                <span className="phase-pill" data-phase={p.id}>
                  {p.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
