import { useEffect, useState } from 'react'
import type {
  AppState,
  ExerciseMachine,
  ExerciseTemplate,
  Phase,
  PhaseId,
  Weekday,
  WeekTemplate,
  WorkoutPlan,
} from '../types'
import { createEmptyWeekTemplate, weekdayFull } from '../dates'
import {
  buildPhaseDescription,
  cycleWeeks,
  createPhase,
  DEFAULT_REST_SECONDS,
  phaseToneKey,
} from '../phases'
import { createMachine, withDefaultMachine } from '../exercises'
import { getPhaseProgress, getPlan, WEEK_ORDER } from '../storage'
import { watchUrl } from '../orientation'
import { getSupabase } from '../lib/supabase'
import { saveDisplayName } from '../cloud/sync'
import { AdminUsersPanel } from './AdminUsersPanel'

interface SettingsScreenProps {
  state: AppState
  onChange: (next: AppState) => void
  onBack: () => void
  userEmail?: string
  userId?: string
  displayName?: string
  onDisplayNameChange?: (name: string) => void
  onLogout?: () => void
  isAdmin?: boolean
  onStats?: () => void
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function SettingsScreen({
  state,
  onChange,
  onBack,
  userEmail,
  userId,
  displayName = '',
  onDisplayNameChange,
  onLogout,
  isAdmin = false,
  onStats,
}: SettingsScreenProps) {
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [editingWeekId, setEditingWeekId] = useState<string | null>(null)
  const [editingPhaseId, setEditingPhaseId] = useState<PhaseId | null>(null)
  const [nameDraft, setNameDraft] = useState(displayName)
  const [nameStatus, setNameStatus] = useState<string | null>(null)
  const [nameBusy, setNameBusy] = useState(false)
  const editing = state.plans.find((p) => p.id === editingPlanId) ?? null
  const editingWeek = state.weeks.find((w) => w.id === editingWeekId) ?? null
  const editingPhase = state.phases.find((p) => p.id === editingPhaseId) ?? null
  const totalCycleWeeks = cycleWeeks(state.phases)
  const phaseProgress = getPhaseProgress(state)
  const galaxyHref = watchUrl('round')
  const appleHref = watchUrl('square')

  useEffect(() => {
    setNameDraft(displayName)
  }, [displayName])

  async function handleSaveName() {
    if (!userEmail) return
    setNameBusy(true)
    setNameStatus(null)
    try {
      const supabase = getSupabase()
      const { data } = await supabase.auth.getUser()
      const userId = data.user?.id
      if (!userId) throw new Error('Sisselogimine puudub.')
      const saved = await saveDisplayName(userId, userEmail, nameDraft)
      onDisplayNameChange?.(saved)
      setNameDraft(saved)
      setNameStatus('Nimi salvestatud.')
    } catch (err) {
      setNameStatus(err instanceof Error ? err.message : 'Nime salvestamine ebaõnnestus.')
    } finally {
      setNameBusy(false)
    }
  }

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

  function addPhase() {
    const phase = createPhase(`Faas ${state.phases.length + 1}`)
    onChange({ ...state, phases: [...state.phases, phase] })
    setEditingPhaseId(phase.id)
  }

  function removePhase(phaseId: PhaseId) {
    if (state.phases.length <= 1) return
    const phases = state.phases.filter((p) => p.id !== phaseId)
    onChange({ ...state, phases })
    if (editingPhaseId === phaseId) setEditingPhaseId(null)
  }

  function movePhase(phaseId: PhaseId, direction: -1 | 1) {
    const index = state.phases.findIndex((p) => p.id === phaseId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= state.phases.length) return
    const phases = [...state.phases]
    const [item] = phases.splice(index, 1)
    phases.splice(nextIndex, 0, item)
    onChange({ ...state, phases })
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

  function updateWeek(weekId: string, patch: Partial<WeekTemplate>) {
    onChange({
      ...state,
      weeks: state.weeks.map((w) => (w.id === weekId ? { ...w, ...patch } : w)),
    })
  }

  function assignWeekDay(weekId: string, weekday: Weekday, planId: string | null) {
    onChange({
      ...state,
      weeks: state.weeks.map((w) =>
        w.id !== weekId ? w : { ...w, days: { ...w.days, [weekday]: planId } },
      ),
    })
  }

  function addWeek() {
    const week = createEmptyWeekTemplate(`Nädal ${state.weeks.length + 1}`)
    onChange({ ...state, weeks: [...state.weeks, week], useRotatingWeeks: true })
    setEditingWeekId(week.id)
  }

  function removeWeek(weekId: string) {
    const minWeeks = state.useRotatingWeeks ? 2 : 1
    if (state.weeks.length <= minWeeks) return
    const weeks = state.weeks.filter((w) => w.id !== weekId)
    onChange({
      ...state,
      weeks,
      useRotatingWeeks: weeks.length > 1 ? state.useRotatingWeeks : false,
    })
    if (editingWeekId === weekId) setEditingWeekId(null)
  }

  function setUseRotatingWeeks(on: boolean) {
    if (on) {
      let weeks = state.weeks
      if (weeks.length < 2) {
        weeks = [...weeks, createEmptyWeekTemplate(`Nädal ${weeks.length + 1}`)]
      }
      onChange({ ...state, weeks, useRotatingWeeks: true })
      return
    }
    onChange({ ...state, useRotatingWeeks: false })
  }

  function addPlan() {
    const plan: WorkoutPlan = {
      id: newId('plan'),
      name: 'Uus kava',
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
          <span className="phase-pill" data-phase={phaseToneKey(editingPhase.id)}>
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

        <div className="field-row field-row-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => movePhase(editingPhase.id, -1)}
            disabled={state.phases[0]?.id === editingPhase.id}
          >
            Üles
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => movePhase(editingPhase.id, 1)}
            disabled={state.phases[state.phases.length - 1]?.id === editingPhase.id}
          >
            Alla
          </button>
        </div>
        <p className="muted small">Järjekord määrab, millises järjestuses faasid kalendris käivad.</p>

        {state.phases.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost danger full"
            onClick={() => {
              const ok = window.confirm(
                `Kustuta faas „${editingPhase.name}”? Ring jookseb ülejäänud faasidega.`,
              )
              if (ok) removePhase(editingPhase.id)
            }}
          >
            Kustuta faas
          </button>
        )}
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

        <p className="muted small pad">Vali igale päevale treeningkava või puhkepäev.</p>

        <ul className="assign-list">
          {WEEK_ORDER.map((day) => {
            const planId = editingWeek.days[day] ?? null
            const plan = planId ? getPlan(state, planId) : null
            return (
              <li key={day} className="assign-block">
                <div className="assign-row">
                  <span>{weekdayFull(day)}</span>
                  <select
                    value={planId ?? ''}
                    onChange={(e) =>
                      assignWeekDay(editingWeek.id, day, e.target.value || null)
                    }
                  >
                    <option value="">Puhkepäev</option>
                    {state.plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {plan && (
                  <p className="assign-phase muted small">
                    Kava: <strong>{plan.name}</strong>
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        {(state.useRotatingWeeks ? state.weeks.length > 2 : state.weeks.length > 1) && (
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

  if (editing) {
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

        <section className="settings-block">
          <div className="field block">
            <label htmlFor="plan-name">Treeningkava nimi</label>
            <input
              id="plan-name"
              type="text"
              autoComplete="off"
              placeholder="nt Tõuke, Esmaspäev…"
              value={editing.name}
              onChange={(e) => updatePlan(editing.id, { name: e.target.value })}
            />
          </div>
          <p className="muted small">
            See nimi nähtub nädalavaates ja treeningus. Praegu faas:{' '}
            <strong>{phaseProgress.phase.name}</strong>
          </p>
        </section>

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

      {isAdmin && <AdminUsersPanel state={state} adminUserId={userId} />}

      <section className="settings-block">
        <h3>Abi</h3>
        <p className="muted small">Kuidas treenida, seadeid muuta ja kella kasutada.</p>
        <a
          className="btn btn-secondary full"
          href={`${import.meta.env.BASE_URL}Salakivi-Treening-kasutusjuhend.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          Kasutusjuhend (PDF)
        </a>
        {onStats && (
          <button type="button" className="btn btn-secondary full" onClick={onStats}>
            Ajalugu / statistika
          </button>
        )}
      </section>

      <section className="settings-block">
        <h3>Nutikell</h3>
        <p className="muted small">
          Avage kellas brauseris vastav kellavaade ja logige samasse kontosse. Telefonis valige
          harjutus ja pink — kellas on Start, Tehtud, pausitaimer ja järelejäänud seeriad. Galaxy
          Watch: ümar sihverplaat. Apple Watchil ei ole tavalist brauserit nagu telefonis — linki
          saab avada iPhone’i sõnumist/meilist (puuduta linki kellas) või uuemal watchOS-il Safari
          kaudu, kui see on kellas olemas. Täisväärtuslik treeningjuhtimine töötab kindlamalt Galaxy
          Watchi brauseris.
        </p>
        <div className="home-actions">
          <a className="btn btn-secondary full" href={galaxyHref}>
            Galaxy Watch (ümar)
          </a>
          <button
            type="button"
            className="btn btn-ghost full"
            onClick={() => {
              void navigator.clipboard?.writeText(galaxyHref).then(
                () => window.alert('Galaxy Watchi link on kopeeritud.'),
                () => window.alert(galaxyHref),
              )
            }}
          >
            Kopeeri Galaxy link
          </button>
          <a className="btn btn-secondary full" href={appleHref}>
            Apple Watch (kandiline)
          </a>
          <button
            type="button"
            className="btn btn-ghost full"
            onClick={() => {
              void navigator.clipboard?.writeText(appleHref).then(
                () => window.alert('Apple Watchi link on kopeeritud.'),
                () => window.alert(appleHref),
              )
            }}
          >
            Kopeeri Apple link
          </button>
        </div>
      </section>

      {userEmail && (
        <section className="settings-block account-block">
          <p className="muted small">Sisse logitud</p>
          {displayName && <p className="plan-name">{displayName}</p>}
          <p className={displayName ? 'muted small user-email' : 'plan-name'}>{userEmail}</p>
          <div className="field block">
            <label htmlFor="settings-name">Nimi avalehel</label>
            <input
              id="settings-name"
              type="text"
              autoComplete="name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={40}
              placeholder="Sinu eesnimi"
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary full"
            onClick={() => void handleSaveName()}
            disabled={nameBusy}
          >
            {nameBusy ? 'Salvestan…' : 'Salvesta nimi'}
          </button>
          {nameStatus && <p className="muted small">{nameStatus}</p>}
          {onLogout && (
            <button type="button" className="btn btn-ghost danger full" onClick={onLogout}>
              Logi välja
            </button>
          )}
        </section>
      )}

      <section className="settings-block starter-note">
        <h3>Sinu treeningkava</h3>
        <p className="muted small">
          Sinu isiklikud treeningkavad. Saad ise kavasid ja nädalaid muuta. Nädalapäevale vali
          treeningkava (nt Tõuke = esmaspäev).
        </p>
      </section>

      <section className="settings-block">
        <div className="section-head">
          <h3>Nädala mall</h3>
          {state.useRotatingWeeks && (
            <button type="button" className="btn btn-secondary" onClick={addWeek}>
              Lisa
            </button>
          )}
        </div>

        <label className="toggle-row">
          <span>
            <strong>Vahelduvad nädalamallid</strong>
            <span className="muted small block">
              Väljas = iga nädal sama kava (ainult faas muutub). Sees = Nädal 1 → 2 → … kordamööda.
            </span>
          </span>
          <input
            type="checkbox"
            checked={state.useRotatingWeeks}
            onChange={(e) => setUseRotatingWeeks(e.target.checked)}
          />
        </label>

        <p className="muted small">
          {state.useRotatingWeeks
            ? 'Kalendris käivad mallid kordamööda. Päevale vali treeningkava.'
            : 'Kasutusel on üks nädala kava igal kalendrinädalal. Päevale vali treeningkava.'}
        </p>
        <ul className="plan-list">
          {(state.useRotatingWeeks ? state.weeks : state.weeks.slice(0, 1)).map((w, index) => {
            const trainingDays = WEEK_ORDER.filter((d) => w.days[d]).length
            return (
              <li key={w.id}>
                <button type="button" className="plan-row" onClick={() => setEditingWeekId(w.id)}>
                  <div>
                    <p className="plan-name">{w.name}</p>
                    <p className="muted small">
                      {state.useRotatingWeeks
                        ? `Mall ${index + 1}/${state.weeks.length} · ${trainingDays} treeningpäeva`
                        : `${trainingDays} treeningpäeva · kehtib igal nädalal`}
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
          <h3>Treeningkavad</h3>
          <button type="button" className="btn btn-secondary" onClick={addPlan}>
            Lisa
          </button>
        </div>
        <p className="muted small">
          Ava kava, et muuta nime, harjutusi ja pinke. Nimi on see, mis nähtub kalendris (nt Tõuke).
        </p>
        <ul className="plan-list">
          {state.plans.map((p) => (
            <li key={p.id}>
              <button type="button" className="plan-row" onClick={() => setEditingPlanId(p.id)}>
                <div>
                  <p className="plan-name">{p.name}</p>
                  <p className="muted small">{p.exercises.length} harjutust · muuda nime ›</p>
                </div>
                <span className="phase-pill" data-phase={phaseToneKey(phaseProgress.phase.id)}>
                  {phaseProgress.phase.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-block">
        <div className="section-head">
          <h3>Faasid</h3>
          <button type="button" className="btn btn-secondary" onClick={addPhase}>
            Lisa
          </button>
        </div>
        <p className="muted small">
          Lisa, muuda või kustuta faase. Ring kokku {totalCycleWeeks} nädalat, siis algab uuesti.
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
                <span className="phase-pill" data-phase={phaseToneKey(p.id)}>
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
