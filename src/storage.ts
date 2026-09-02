import type {
  AppState,
  ExerciseMachine,
  ExerciseTemplate,
  PhaseId,
  PhaseProgress,
  TrainingGroup,
  Weekday,
  WeekTemplate,
  WorkoutPlan,
} from './types'
import {
  addDays,
  createDefaultState,
  createEmptyWeekTemplate,
  parseDateKey,
  startOfWeekMonday,
  toDateKey,
} from './dates'
import {
  cycleWeeks,
  DEFAULT_PHASES,
  DEFAULT_REST_SECONDS,
  buildPhaseDescription,
  getFirstCycleWeekOfPhase,
  getPhaseForCycleWeek,
  getWeekInPhase,
} from './phases'
import type { Phase } from './types'

const STORAGE_KEY = 'salakivi-treening-v8'
const LEGACY_KEYS = [
  'salakivi-treening-v7',
  'salakivi-treening-v6',
  'salakivi-treening-v5',
  'salakivi-treening-v4',
  'salakivi-treening-v3',
  'salakivi-treening-v2',
  'salakivi-treening-v1',
]

const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function defaultCycleStart(): string {
  return toDateKey(startOfWeekMonday(new Date()))
}

function emptyDays(): WeekTemplate['days'] {
  return { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }
}

function normalizePlan(
  raw: Record<string, unknown>,
  fallbackGroupId: string,
): WorkoutPlan | null {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  const exercisesRaw = Array.isArray(raw.exercises) ? raw.exercises : []
  const seenIds = new Set<string>()
  const exercises = exercisesRaw
    .map((ex) => {
      if (!ex || typeof ex !== 'object') return null
      const e = ex as Record<string, unknown>
      if (typeof e.name !== 'string') return null
      let exId = typeof e.id === 'string' ? e.id : newId('ex')
      if (seenIds.has(exId)) exId = newId('ex')
      seenIds.add(exId)

      const restSeconds =
        typeof e.restSeconds === 'number' && Number.isFinite(e.restSeconds) && e.restSeconds >= 0
          ? e.restSeconds
          : DEFAULT_REST_SECONDS

      const rounds =
        typeof e.rounds === 'number' && Number.isFinite(e.rounds) && e.rounds > 0
          ? Math.round(e.rounds)
          : 4

      let machines: ExerciseMachine[] = []
      if (Array.isArray(e.machines) && e.machines.length > 0) {
        machines = e.machines
          .map((m) => {
            if (!m || typeof m !== 'object') return null
            const machine = m as Record<string, unknown>
            if (typeof machine.name !== 'string') return null
            return {
              id: typeof machine.id === 'string' ? machine.id : newId('m'),
              name: machine.name,
              baseWeightKg:
                typeof machine.baseWeightKg === 'number' ? machine.baseWeightKg : 20,
            }
          })
          .filter((m): m is ExerciseMachine => m !== null)
      }

      if (!machines.length) {
        const legacyBase = typeof e.baseWeightKg === 'number' ? e.baseWeightKg : 20
        machines = [
          {
            id: newId('m'),
            name: typeof e.pinkName === 'string' ? e.pinkName : 'Pink 1',
            baseWeightKg: legacyBase,
          },
        ]
      }

      return {
        id: exId,
        name: e.name,
        rounds,
        restSeconds,
        machines,
      }
    })
    .filter((ex): ex is ExerciseTemplate => ex !== null)

  return {
    id: raw.id,
    name: raw.name,
    groupId: typeof raw.groupId === 'string' ? raw.groupId : fallbackGroupId,
    exercises,
  }
}

function normalizeWeekDays(
  raw: unknown,
  validGroupIds: Set<string>,
  planToGroup: Map<string, string>,
): WeekTemplate['days'] {
  const days = emptyDays()
  if (!raw || typeof raw !== 'object') return days
  const data = raw as Record<string, unknown>
  for (let day = 0; day <= 6; day++) {
    const value = data[String(day)]
    if (value === null) {
      days[day as Weekday] = null
    } else if (typeof value === 'string') {
      if (validGroupIds.has(value)) days[day as Weekday] = value
      else if (planToGroup.has(value)) days[day as Weekday] = planToGroup.get(value)!
      else days[day as Weekday] = null
    }
  }
  return days
}

function normalizeWeeks(
  data: Record<string, unknown>,
  groups: TrainingGroup[],
  plans: WorkoutPlan[],
): WeekTemplate[] {
  const validGroupIds = new Set(groups.map((g) => g.id))
  const planToGroup = new Map(plans.map((p) => [p.id, p.groupId]))

  if (Array.isArray(data.weeks) && data.weeks.length > 0) {
    const weeks = data.weeks
      .map((w, index) => {
        if (!w || typeof w !== 'object') return null
        const item = w as Record<string, unknown>
        return {
          id: typeof item.id === 'string' ? item.id : newId('week'),
          name: typeof item.name === 'string' ? item.name : `Nädal ${index + 1}`,
          days: normalizeWeekDays(item.days, validGroupIds, planToGroup),
        } satisfies WeekTemplate
      })
      .filter((w): w is WeekTemplate => w !== null)

    while (weeks.length < 2) {
      weeks.push(createEmptyWeekTemplate(`Nädal ${weeks.length + 1}`))
    }
    return weeks
  }

  // Legacy: single calendar of planIds → two week copies with groupIds
  const legacyDays = normalizeWeekDays(data.calendar, validGroupIds, planToGroup)
  return [
    { id: newId('week'), name: 'Nädal 1', days: { ...legacyDays } },
    { id: newId('week'), name: 'Nädal 2', days: { ...legacyDays } },
  ]
}

function isPhaseId(value: unknown): value is PhaseId {
  return value === 'start' || value === 'treening' || value === 'power' || value === 'taastus'
}

function normalizePhases(raw: unknown): Phase[] {
  const byId = new Map<PhaseId, Phase>()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      if (!isPhaseId(p.id)) continue
      const weeks = typeof p.weeks === 'number' && p.weeks > 0 ? Math.round(p.weeks) : 1
      let setsMin =
        typeof p.setsMin === 'number' && p.setsMin > 0
          ? Math.round(p.setsMin)
          : typeof p.repsMin === 'number'
            ? Math.round(p.repsMin)
            : 6
      let setsMax =
        typeof p.setsMax === 'number' && p.setsMax > 0
          ? Math.round(p.setsMax)
          : typeof p.repsMax === 'number'
            ? Math.round(p.repsMax)
            : typeof p.sets === 'number'
              ? Math.round(p.sets)
              : setsMin
      if (setsMax < setsMin) setsMax = setsMin
      const weightMultiplier =
        typeof p.weightMultiplier === 'number' && p.weightMultiplier > 0
          ? p.weightMultiplier
          : 1
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id
      const phase: Phase = {
        id: p.id,
        name,
        weeks,
        setsMin,
        setsMax,
        weightMultiplier,
        description: '',
      }
      phase.description = buildPhaseDescription(phase)
      byId.set(p.id, phase)
    }
  }

  return DEFAULT_PHASES.map((def) => {
    const custom = byId.get(def.id)
    return custom ? { ...custom } : { ...def }
  })
}

function normalizeState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const fallbackStart = defaultCycleStart()
  const phases = normalizePhases(data.phases)

  let groups: TrainingGroup[] = []
  if (Array.isArray(data.groups)) {
    groups = data.groups
      .map((g) => {
        if (!g || typeof g !== 'object') return null
        const item = g as Record<string, unknown>
        if (typeof item.id !== 'string' || typeof item.name !== 'string') return null
        return {
          id: item.id,
          name: item.name,
          cycleStartDate:
            typeof item.cycleStartDate === 'string' ? item.cycleStartDate : fallbackStart,
        }
      })
      .filter((g): g is TrainingGroup => g !== null)
  }

  if (!groups.length) {
    groups = [{ id: newId('group'), name: 'Põhiprogramm', cycleStartDate: fallbackStart }]
  }

  const fallbackGroupId = groups[0].id
  const plansRaw = Array.isArray(data.plans) ? data.plans : []
  const plans = plansRaw
    .map((p) =>
      p && typeof p === 'object'
        ? normalizePlan(p as Record<string, unknown>, fallbackGroupId)
        : null,
    )
    .filter((p): p is WorkoutPlan => p !== null)
    .map((p) => ({
      ...p,
      groupId: groups.some((g) => g.id === p.groupId) ? p.groupId : fallbackGroupId,
    }))

  if (!plans.length) return null

  const weeks = normalizeWeeks(data, groups, plans)
  const logs = normalizeLogs(data.logs, plans)

  return { phases, groups, plans, weeks, logs }
}

function normalizeLogs(
  raw: unknown,
  plans: WorkoutPlan[],
): AppState['logs'] {
  if (!raw || typeof raw !== 'object') return {}
  const exerciseMachines = new Map<string, string>()
  for (const plan of plans) {
    for (const ex of plan.exercises) {
      exerciseMachines.set(ex.id, ex.machines[0]?.id ?? newId('m'))
    }
  }

  const out: AppState['logs'] = {}
  for (const [dateKey, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const log = entry as Record<string, unknown>
    if (typeof log.groupId !== 'string' || !isPhaseId(log.phaseId)) continue
    if (!Array.isArray(log.exercises)) continue

    const exercises = log.exercises
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const ex = item as Record<string, unknown>
        if (typeof ex.exerciseId !== 'string' || !Array.isArray(ex.sets)) return null
        const fallbackMachine =
          typeof ex.machineId === 'string'
            ? ex.machineId
            : exerciseMachines.get(ex.exerciseId) ?? newId('m')

        const sets = ex.sets
          .map((set) => {
            if (!set || typeof set !== 'object') return null
            const s = set as Record<string, unknown>
            return {
              machineId:
                typeof s.machineId === 'string'
                  ? s.machineId
                  : fallbackMachine,
              weightKg: typeof s.weightKg === 'number' ? s.weightKg : 0,
              reps: typeof s.reps === 'number' ? s.reps : 0,
              completed: Boolean(s.completed),
            }
          })
          .filter((s): s is AppState['logs'][string]['exercises'][number]['sets'][number] => s !== null)

        if (!sets.length) return null
        return { exerciseId: ex.exerciseId, sets }
      })
      .filter((ex): ex is AppState['logs'][string]['exercises'][number] => ex !== null)

    if (!exercises.length) continue
    out[dateKey] = {
      dateKey,
      groupId: log.groupId,
      phaseId: log.phaseId,
      exercises,
      startedAt: typeof log.startedAt === 'string' ? log.startedAt : undefined,
      finishedAt: typeof log.finishedAt === 'string' ? log.finishedAt : undefined,
      workMs: typeof log.workMs === 'number' && log.workMs >= 0 ? log.workMs : undefined,
      restMs: typeof log.restMs === 'number' && log.restMs >= 0 ? log.restMs : undefined,
    }
  }
  return out
}

export function parseAppState(raw: unknown): AppState {
  const normalized = normalizeState(raw)
  return normalized ?? createDefaultState()
}

export function loadState(): AppState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      for (const key of LEGACY_KEYS) {
        raw = localStorage.getItem(key)
        if (raw) break
      }
    }
    if (!raw) return createDefaultState()
    return parseAppState(JSON.parse(raw))
  } catch {
    return createDefaultState()
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** Nädalamalli indeks kalendrikuupäeva jaoks (vaheldumisi Nädal 1, 2, …). */
export function getWeekTemplateIndex(state: AppState, dateKey: string): number {
  const anchor = state.groups[0]?.cycleStartDate ?? defaultCycleStart()
  const startMonday = startOfWeekMonday(parseDateKey(anchor))
  const dateMonday = startOfWeekMonday(parseDateKey(dateKey))
  const days = Math.round((dateMonday.getTime() - startMonday.getTime()) / (1000 * 60 * 60 * 24))
  const weeks = Math.floor(days / 7)
  const len = Math.max(1, state.weeks.length)
  return ((weeks % len) + len) % len
}

export function getWeekTemplateForDate(state: AppState, dateKey: string): WeekTemplate {
  const index = getWeekTemplateIndex(state, dateKey)
  return state.weeks[index] ?? state.weeks[0]
}

export function getGroupForDate(state: AppState, dateKey: string): TrainingGroup | null {
  const template = getWeekTemplateForDate(state, dateKey)
  const weekday = parseDateKey(dateKey).getDay() as Weekday
  const groupId = template.days[weekday] ?? null
  if (!groupId) return null
  return state.groups.find((g) => g.id === groupId) ?? null
}

/** Grupi kõikide kavade harjutused ühe treeningu jaoks. */
export function getExercisesForGroup(state: AppState, groupId: string): ExerciseTemplate[] {
  return state.plans.filter((p) => p.groupId === groupId).flatMap((p) => p.exercises)
}

export function getGroup(state: AppState, groupId: string): TrainingGroup | null {
  return state.groups.find((g) => g.id === groupId) ?? null
}

export function getCalendarCycleWeekIndex(
  cycleStartDate: string,
  dateKey: string,
  phases: Phase[],
): number {
  const total = cycleWeeks(phases)
  const startMonday = startOfWeekMonday(parseDateKey(cycleStartDate))
  const dateMonday = startOfWeekMonday(parseDateKey(dateKey))
  const days = Math.round((dateMonday.getTime() - startMonday.getTime()) / (1000 * 60 * 60 * 24))
  const weeks = Math.floor(days / 7)
  return ((weeks % total) + total) % total
}

export function getPhaseProgressForGroup(
  state: AppState,
  groupId: string,
  dateKey: string = todayKey(),
): PhaseProgress {
  const group = getGroup(state, groupId)
  const cycleStart = group?.cycleStartDate ?? defaultCycleStart()
  const cycleWeekIndex = getCalendarCycleWeekIndex(cycleStart, dateKey, state.phases)
  return {
    phase: getPhaseForCycleWeek(state.phases, cycleWeekIndex),
    cycleWeekIndex,
    weekInPhase: getWeekInPhase(state.phases, cycleWeekIndex),
  }
}

export function cycleStartDateForPhase(
  phases: Phase[],
  phaseId: PhaseId,
  fromDate: Date = new Date(),
): string {
  const monday = startOfWeekMonday(fromDate)
  const weekIndex = getFirstCycleWeekOfPhase(phases, phaseId)
  return toDateKey(addDays(monday, -weekIndex * 7))
}

export function startGroupPhase(
  state: AppState,
  groupId: string,
  phaseId: PhaseId,
): AppState {
  const cycleStartDate = cycleStartDateForPhase(state.phases, phaseId)
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, cycleStartDate } : g,
    ),
  }
}

export function getPhaseForGroup(
  state: AppState,
  groupId: string,
  dateKey: string = todayKey(),
): Phase {
  return getPhaseProgressForGroup(state, groupId, dateKey).phase
}

export function getPhaseForDate(state: AppState, dateKey: string): Phase | null {
  const group = getGroupForDate(state, dateKey)
  if (!group) return null
  return getPhaseForGroup(state, group.id, dateKey)
}

export function getSpotlightGroup(state: AppState): TrainingGroup | null {
  const today = todayKey()
  const todayGroup = getGroupForDate(state, today)
  if (todayGroup) return todayGroup

  for (let i = 1; i <= 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const group = getGroupForDate(state, toDateKey(d))
    if (group) return group
  }

  return state.groups[0] ?? null
}

export function getSpotlightProgress(state: AppState): {
  group: TrainingGroup
  progress: PhaseProgress
} | null {
  const group = getSpotlightGroup(state)
  if (!group) return null
  return { group, progress: getPhaseProgressForGroup(state, group.id) }
}

export function todayKey(): string {
  return toDateKey(new Date())
}

/** Lisa pink harjutuse alla (salvestub kavasse). */
export function addMachineToExercise(
  state: AppState,
  exerciseId: string,
  machine: ExerciseMachine,
): AppState {
  return {
    ...state,
    plans: state.plans.map((p) => ({
      ...p,
      exercises: p.exercises.map((ex) =>
        ex.id === exerciseId ? { ...ex, machines: [...ex.machines, machine] } : ex,
      ),
    })),
  }
}

export { WEEK_ORDER }
