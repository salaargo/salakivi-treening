import type {
  AppState,
  DayLog,
  ExerciseLog,
  ExerciseMachine,
  ExerciseTemplate,
  PhaseId,
  PhaseProgress,
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
  suggestedWeight,
} from './phases'
import type { Phase } from './types'
import { exerciseRounds, getMachine, getPrimaryMachine } from './exercises'
import { hasCustomPlans, isGenericStarterNames, isGenericStarterPlan } from './seed/starterState'

const STORAGE_KEY = 'salakivi-treening-v9'
const LEGACY_KEYS = [
  'salakivi-treening-v8',
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

function normalizePlan(raw: Record<string, unknown>): WorkoutPlan | null {
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
    exercises,
  }
}

/** Migreeri vanad groupId-päevad → planId (grupi esimene kava). */
function normalizeWeekDays(
  raw: unknown,
  validPlanIds: Set<string>,
  groupToPlan: Map<string, string>,
): WeekTemplate['days'] {
  const days = emptyDays()
  if (!raw || typeof raw !== 'object') return days
  const data = raw as Record<string, unknown>
  for (let day = 0; day <= 6; day++) {
    const value = data[String(day)]
    if (value === null) {
      days[day as Weekday] = null
    } else if (typeof value === 'string') {
      if (validPlanIds.has(value)) days[day as Weekday] = value
      else if (groupToPlan.has(value)) days[day as Weekday] = groupToPlan.get(value)!
      else days[day as Weekday] = null
    }
  }
  return days
}

function normalizeWeeks(
  data: Record<string, unknown>,
  plans: WorkoutPlan[],
  groupToPlan: Map<string, string>,
): WeekTemplate[] {
  const validPlanIds = new Set(plans.map((p) => p.id))

  if (Array.isArray(data.weeks) && data.weeks.length > 0) {
    const weeks = data.weeks
      .map((w, index) => {
        if (!w || typeof w !== 'object') return null
        const item = w as Record<string, unknown>
        return {
          id: typeof item.id === 'string' ? item.id : newId('week'),
          name: typeof item.name === 'string' ? item.name : `Nädal ${index + 1}`,
          days: normalizeWeekDays(item.days, validPlanIds, groupToPlan),
        } satisfies WeekTemplate
      })
      .filter((w): w is WeekTemplate => w !== null)

    if (!weeks.length) {
      weeks.push(createEmptyWeekTemplate('Nädal 1'))
    }
    return weeks
  }

  const legacyDays = normalizeWeekDays(data.calendar, validPlanIds, groupToPlan)
  return [
    { id: newId('week'), name: 'Nädal 1', days: { ...legacyDays } },
    { id: newId('week'), name: 'Nädal 2', days: { ...legacyDays } },
  ]
}

function isPhaseId(value: unknown): value is PhaseId {
  return typeof value === 'string' && value.trim().length > 0
}

function parsePhase(item: unknown): Phase | null {
  if (!item || typeof item !== 'object') return null
  const p = item as Record<string, unknown>
  if (!isPhaseId(p.id)) return null
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
    typeof p.weightMultiplier === 'number' && p.weightMultiplier > 0 ? p.weightMultiplier : 1
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id
  const phase: Phase = {
    id: p.id.trim(),
    name,
    weeks,
    setsMin,
    setsMax,
    weightMultiplier,
    description: '',
  }
  phase.description = buildPhaseDescription(phase)
  return phase
}

function normalizePhases(raw: unknown): Phase[] {
  if (Array.isArray(raw)) {
    const seen = new Set<string>()
    const parsed: Phase[] = []
    for (const item of raw) {
      const phase = parsePhase(item)
      if (!phase || seen.has(phase.id)) continue
      seen.add(phase.id)
      parsed.push(phase)
    }
    if (parsed.length > 0) return parsed
  }
  return DEFAULT_PHASES.map((def) => ({ ...def }))
}

function normalizeLogs(
  raw: unknown,
  plans: WorkoutPlan[],
  groupToPlan: Map<string, string>,
): AppState['logs'] {
  if (!raw || typeof raw !== 'object') return {}
  const validPlanIds = new Set(plans.map((p) => p.id))
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
    if (!isPhaseId(log.phaseId) || !Array.isArray(log.exercises)) continue

    let planId: string | null = null
    if (typeof log.planId === 'string' && log.planId) {
      planId = log.planId
    } else if (typeof log.groupId === 'string') {
      if (validPlanIds.has(log.groupId)) planId = log.groupId
      else planId = groupToPlan.get(log.groupId) ?? null
    }
    if (!planId) planId = plans[0]?.id ?? null
    if (!planId) continue

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
                typeof s.machineId === 'string' ? s.machineId : fallbackMachine,
              weightKg: typeof s.weightKg === 'number' ? s.weightKg : 0,
              reps: typeof s.reps === 'number' ? s.reps : 0,
              completed: Boolean(s.completed),
            }
          })
          .filter((s): s is AppState['logs'][string]['exercises'][number]['sets'][number] => s !== null)

        if (!sets.length) return null
        const logged: ExerciseLog = {
          exerciseId: ex.exerciseId,
          sets,
        }
        if (typeof ex.name === 'string' && ex.name.trim()) logged.name = ex.name.trim()
        if (ex.finishedEarly) logged.finishedEarly = true
        return logged
      })
      .filter((ex): ex is ExerciseLog => ex !== null)

    if (!exercises.length) continue
    out[dateKey] = {
      dateKey,
      planId,
      phaseId: log.phaseId,
      exercises,
      startedAt: typeof log.startedAt === 'string' ? log.startedAt : undefined,
      finishedAt: typeof log.finishedAt === 'string' ? log.finishedAt : undefined,
      workMs: typeof log.workMs === 'number' && log.workMs >= 0 ? log.workMs : undefined,
      restMs: typeof log.restMs === 'number' && log.restMs >= 0 ? log.restMs : undefined,
      stoppedEarly: Boolean(log.stoppedEarly),
    }
  }
  return out
}

function normalizeState(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const fallbackStart = defaultCycleStart()
  const phases = normalizePhases(data.phases)

  // Legacy groups → map groupId → first plan id
  const groupToPlan = new Map<string, string>()
  let cycleStartDate = fallbackStart
  if (typeof data.cycleStartDate === 'string') {
    cycleStartDate = data.cycleStartDate
  }

  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      if (!g || typeof g !== 'object') continue
      const item = g as Record<string, unknown>
      if (typeof item.id !== 'string') continue
      if (typeof item.cycleStartDate === 'string' && !data.cycleStartDate) {
        cycleStartDate = item.cycleStartDate
      }
    }
  }

  const plansRaw = Array.isArray(data.plans) ? data.plans : []
  const plans = plansRaw
    .map((p) => (p && typeof p === 'object' ? normalizePlan(p as Record<string, unknown>) : null))
    .filter((p): p is WorkoutPlan => p !== null)

  if (!plans.length) return null

  // Build group → plan from legacy plan.groupId
  for (const p of plansRaw) {
    if (!p || typeof p !== 'object') continue
    const item = p as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.groupId !== 'string') continue
    if (!groupToPlan.has(item.groupId)) groupToPlan.set(item.groupId, item.id)
  }
  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      if (!g || typeof g !== 'object') continue
      const item = g as Record<string, unknown>
      if (typeof item.id !== 'string') continue
      if (!groupToPlan.has(item.id) && plans[0]) groupToPlan.set(item.id, plans[0].id)
    }
  }

  const weeks = normalizeWeeks(data, plans, groupToPlan)
  const logs = normalizeLogs(data.logs, plans, groupToPlan)

  const useRotatingWeeks = data.useRotatingWeeks === true

  return { phases, plans, weeks, logs, cycleStartDate, useRotatingWeeks }
}

export function parseAppState(raw: unknown): AppState {
  const normalized = normalizeState(raw)
  if (normalized) return rehydratePlansFromLogs(discardUnstartedStarterLogs(normalized))
  return createDefaultState()
}

export function lastSameWeekdayLog(state: AppState, dateKey: string): DayLog | null {
  const weekday = parseDateKey(dateKey).getDay()
  const dates = Object.keys(state.logs)
    .filter((key) => key < dateKey)
    .sort()
    .reverse()
  for (const key of dates) {
    if (parseDateKey(key).getDay() !== weekday) continue
    const log = state.logs[key]
    if (!log?.exercises.length) continue
    if (isGenericStarterLog(state, log)) continue
    return log
  }
  return null
}

export function isGenericStarterLog(state: AppState, log: DayLog): boolean {
  const names = log.exercises.map((entry) => {
    if (entry.name?.trim()) return entry.name.trim()
    return findExerciseTemplate(state, entry.exerciseId)?.name ?? ''
  })
  if (names.every(Boolean) && isGenericStarterNames(names)) return true
  for (const plan of state.plans) {
    if (!isGenericStarterPlan(plan)) continue
    const ids = new Set(plan.exercises.map((ex) => ex.id))
    if (log.exercises.length && log.exercises.every((entry) => ids.has(entry.exerciseId))) {
      return true
    }
  }
  return false
}

export function exercisesFromDayLog(state: AppState, log: DayLog): ExerciseTemplate[] {
  const result: ExerciseTemplate[] = []
  for (const entry of log.exercises) {
    const found = findExerciseTemplate(state, entry.exerciseId)
    if (found) {
      result.push(found)
      continue
    }
    const name = entry.name?.trim()
    if (!name) return []
    const first = entry.sets[0]
    result.push({
      id: entry.exerciseId,
      name,
      rounds: Math.max(1, entry.sets.length),
      restSeconds: DEFAULT_REST_SECONDS,
      machines: [
        {
          id: first?.machineId ?? `m-${entry.exerciseId}`,
          name: 'Pink 1',
          baseWeightKg: first?.weightKg ?? 20,
        },
      ],
    })
  }
  return result
}

function logHasCompletedWork(log: DayLog): boolean {
  return log.exercises.some((entry) => entry.sets.some((set) => set.completed) || entry.finishedEarly)
}

export function discardUnstartedStarterLogs(state: AppState): AppState {
  let changed = false
  const logs: AppState['logs'] = {}
  for (const [dateKey, log] of Object.entries(state.logs)) {
    const started = Boolean(log.startedAt) || logHasCompletedWork(log)
    if (!started && isGenericStarterLog(state, log)) {
      changed = true
      continue
    }
    logs[dateKey] = log
  }
  return changed ? { ...state, logs } : state
}

export function rehydratePlansFromLogs(state: AppState): AppState {
  let changed = false
  const plans = state.plans.map((plan) => {
    if (!isGenericStarterPlan(plan)) return plan
    const assignedWeekdays = new Set<number>()
    for (const week of state.weeks) {
      for (const [day, id] of Object.entries(week.days)) {
        if (id === plan.id) assignedWeekdays.add(Number(day))
      }
    }
    const dates = Object.keys(state.logs).sort().reverse()
    for (const dateKey of dates) {
      if (assignedWeekdays.size && !assignedWeekdays.has(parseDateKey(dateKey).getDay())) continue
      const log = state.logs[dateKey]
      if (!log || isGenericStarterLog(state, log)) continue
      const recovered = exercisesFromDayLog(state, log)
      if (!recovered.length || isGenericStarterNames(recovered.map((ex) => ex.name))) continue
      changed = true
      return { ...plan, exercises: recovered }
    }
    return plan
  })
  return changed ? { ...state, plans } : state
}

export function isPlaceholderWorkout(state: AppState, dateKey: string): boolean {
  const exercises = getExercisesForDate(state, dateKey)
  if (!isGenericStarterNames(exercises.map((ex) => ex.name))) return false
  const previous = lastSameWeekdayLog(state, dateKey)
  return Boolean(previous && logHasCompletedWork(previous))
}

function findExerciseTemplate(state: AppState, exerciseId: string): ExerciseTemplate | undefined {
  for (const plan of state.plans) {
    const found = plan.exercises.find((ex) => ex.id === exerciseId)
    if (found) return found
  }
  return undefined
}

function preferCustomSameName(state: AppState, assigned: WorkoutPlan): WorkoutPlan {
  if (!isGenericStarterPlan(assigned)) return assigned
  const custom = state.plans.find(
    (plan) => plan.id !== assigned.id && plan.name === assigned.name && !isGenericStarterPlan(plan),
  )
  return custom ?? assigned
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

export function getWeekTemplateIndex(state: AppState, dateKey: string): number {
  if (!state.useRotatingWeeks) return 0
  const anchor = state.cycleStartDate || defaultCycleStart()
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

export function getPlan(state: AppState, planId: string): WorkoutPlan | null {
  return state.plans.find((p) => p.id === planId) ?? null
}

export function getPlanForDate(state: AppState, dateKey: string): WorkoutPlan | null {
  const template = getWeekTemplateForDate(state, dateKey)
  const weekday = parseDateKey(dateKey).getDay() as Weekday
  const planId = template.days[weekday] ?? null
  const assigned = planId ? getPlan(state, planId) : null
  const chosen = assigned ? preferCustomSameName(state, assigned) : null
  const previous = lastSameWeekdayLog(state, dateKey)
  const previousPlan = previous ? getPlan(state, previous.planId) : null
  const recovered = previous ? exercisesFromDayLog(state, previous) : []
  const recoveredCustom =
    recovered.length > 0 && !isGenericStarterNames(recovered.map((ex) => ex.name))
  if (recoveredCustom && (!chosen || isGenericStarterPlan(chosen))) {
    if (previousPlan && !isGenericStarterPlan(previousPlan)) {
      return { ...previousPlan, exercises: recovered }
    }
    if (chosen) return { ...chosen, exercises: recovered }
    return {
      id: previous?.planId ?? 'recovered',
      name: 'Kava',
      exercises: recovered,
    }
  }
  if (previousPlan && !isGenericStarterPlan(previousPlan) && (!chosen || isGenericStarterPlan(chosen))) {
    return previousPlan
  }
  return chosen
}

export function getExercisesForPlan(state: AppState, planId: string): ExerciseTemplate[] {
  return getPlan(state, planId)?.exercises ?? []
}

export function getExercisesForDate(state: AppState, dateKey: string): ExerciseTemplate[] {
  const plan = getPlanForDate(state, dateKey)
  if (plan?.exercises.length) return plan.exercises
  const previous = lastSameWeekdayLog(state, dateKey)
  if (!previous) return []
  return exercisesFromDayLog(state, previous)
}

/** Ära lase näidiskaval kirjutada üle telefonis olevat isiklikku kava. */
export function preferExistingProgram(cloud: AppState, local: AppState): AppState {
  if (!hasCustomPlans(local.plans)) return cloud
  if (hasCustomPlans(cloud.plans) && !cloud.plans.every((plan) => isGenericStarterPlan(plan))) {
    return cloud
  }
  if (!cloud.plans.every((plan) => isGenericStarterPlan(plan)) && cloud.plans.length > 0) {
    return cloud
  }
  return {
    ...cloud,
    plans: local.plans,
    weeks: local.weeks.length ? local.weeks : cloud.weeks,
    useRotatingWeeks: local.useRotatingWeeks,
    cycleStartDate: local.cycleStartDate || cloud.cycleStartDate,
  }
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

export function getPhaseProgress(
  state: AppState,
  dateKey: string = todayKey(),
): PhaseProgress {
  const cycleStart = state.cycleStartDate || defaultCycleStart()
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

export function startPhase(state: AppState, phaseId: PhaseId): AppState {
  return {
    ...state,
    cycleStartDate: cycleStartDateForPhase(state.phases, phaseId),
  }
}

export function getPhaseForDate(state: AppState, dateKey: string): Phase | null {
  if (!getPlanForDate(state, dateKey)) return null
  return getPhaseProgress(state, dateKey).phase
}

export function getSpotlightPlan(state: AppState): WorkoutPlan | null {
  const today = todayKey()
  const todayPlan = getPlanForDate(state, today)
  if (todayPlan) return todayPlan

  for (let i = 1; i <= 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const plan = getPlanForDate(state, toDateKey(d))
    if (plan) return plan
  }

  return state.plans[0] ?? null
}

export function getSpotlightProgress(state: AppState): {
  plan: WorkoutPlan
  progress: PhaseProgress
} | null {
  const plan = getSpotlightPlan(state)
  if (!plan) return null
  return { plan, progress: getPhaseProgress(state) }
}

export function todayKey(): string {
  return toDateKey(new Date())
}

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

function buildExerciseLogSkeleton(
  ex: ExerciseTemplate,
  phase: Phase,
  state?: AppState,
  dateKey?: string,
): ExerciseLog {
  const machine = getPrimaryMachine(ex)
  const weight =
    state && dateKey
      ? weightForSelectedMachine(state, ex, machine.id, dateKey, phase)
      : suggestedWeight(machine.baseWeightKg, phase.weightMultiplier)
  return {
    exerciseId: ex.id,
    name: ex.name,
    sets: Array.from({ length: exerciseRounds(ex) }, () => ({
      machineId: machine.id,
      weightKg: weight,
      reps: phase.setsMin,
      completed: false,
    })),
  }
}

/** Viimati sellel pingil tehtud raskus (eelmine treening, mitte tänane). */
export function lastWeightForMachine(
  state: AppState,
  exercise: ExerciseTemplate,
  machineId: string,
  beforeDateKey: string,
): number | null {
  const machine = getMachine(exercise, machineId) ?? getPrimaryMachine(exercise)
  const namesMatch = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const dates = Object.keys(state.logs)
    .filter((key) => key < beforeDateKey)
    .sort()
    .reverse()

  for (const dateKey of dates) {
    const log = state.logs[dateKey]
    const plan = getPlan(state, log.planId)
    for (const entry of log.exercises) {
      const template =
        plan?.exercises.find((item) => item.id === entry.exerciseId) ??
        state.plans.flatMap((p) => p.exercises).find((item) => item.id === entry.exerciseId)
      const sameExercise =
        entry.exerciseId === exercise.id ||
        Boolean(template && namesMatch(template.name, exercise.name))
      if (!sameExercise) continue
      const completed = entry.sets.filter((set) => {
        if (!set.completed) return false
        if (set.machineId === machine.id) return true
        const setMachine = template ? getMachine(template, set.machineId) : undefined
        return Boolean(setMachine && namesMatch(setMachine.name, machine.name))
      })
      if (completed.length) return completed[completed.length - 1].weightKg
    }
  }
  return null
}

export function weightForSelectedMachine(
  state: AppState,
  exercise: ExerciseTemplate,
  machineId: string,
  dateKey: string,
  phase: Phase,
): number {
  const last = lastWeightForMachine(state, exercise, machineId, dateKey)
  if (last != null) return last
  const machine = getMachine(exercise, machineId) ?? getPrimaryMachine(exercise)
  return suggestedWeight(machine.baseWeightKg, phase.weightMultiplier)
}

export interface HistoryRow {
  dateKey: string
  planName: string
  exerciseName: string
  machineName: string
  setNumber: number
  weightKg: number
  reps: number
  completed: boolean
}

export function buildHistoryRows(state: AppState): HistoryRow[] {
  const rows: HistoryRow[] = []
  const dates = Object.keys(state.logs).sort().reverse()
  for (const dateKey of dates) {
    const log = state.logs[dateKey]
    const plan = getPlan(state, log.planId)
    for (const entry of log.exercises) {
      const ex =
        plan?.exercises.find((item) => item.id === entry.exerciseId) ??
        state.plans.flatMap((p) => p.exercises).find((item) => item.id === entry.exerciseId)
      entry.sets.forEach((set, index) => {
        const machine = ex ? getMachine(ex, set.machineId) : undefined
        rows.push({
          dateKey,
          planName: plan?.name ?? 'Kava',
          exerciseName: ex?.name ?? entry.name ?? 'Harjutus',
          machineName: machine?.name ?? 'Pink',
          setNumber: index + 1,
          weightKg: set.weightKg,
          reps: set.reps,
          completed: set.completed,
        })
      })
    }
  }
  return rows
}

export function isExerciseLogDone(log: DayLog, exerciseId: string): boolean {
  const entry = log.exercises.find((e) => e.exerciseId === exerciseId)
  if (!entry) return false
  if (entry.finishedEarly) return true
  return Boolean(entry.sets.length && entry.sets.every((s) => s.completed))
}

export function dayLogHasIncomplete(log: DayLog): boolean {
  return log.exercises.some((ex) => !isExerciseLogDone(log, ex.exerciseId))
}

export function ensureDayLog(state: AppState, dateKey: string): DayLog | null {
  const plan = getPlanForDate(state, dateKey)
  if (!plan || !plan.exercises.length) return null
  const phase = getPhaseProgress(state, dateKey).phase
  const existing = state.logs[dateKey]
  if (existing && existing.planId === plan.id && existing.phaseId === phase.id) {
    return existing
  }
  return {
    dateKey,
    planId: plan.id,
    phaseId: phase.id,
    exercises: plan.exercises.map((ex) => buildExerciseLogSkeleton(ex, phase, state, dateKey)),
  }
}

export function stopTodayWorkout(
  state: AppState,
  liveLog?: DayLog | null,
): { state: AppState; log: DayLog | null; error?: string } {
  const dateKey = todayKey()
  const base = liveLog?.dateKey === dateKey ? liveLog : ensureDayLog(state, dateKey)
  if (!base) {
    return { state, log: null, error: 'Täna pole treeningpäeva või kava puudub.' }
  }

  const now = new Date().toISOString()
  const log: DayLog = {
    ...base,
    startedAt: base.startedAt ?? now,
    finishedAt: undefined,
    stoppedEarly: undefined,
    workMs: base.workMs ?? 0,
    restMs: base.restMs ?? 0,
  }

  return {
    state: {
      ...state,
      logs: { ...state.logs, [dateKey]: log },
    },
    log,
  }
}

export { WEEK_ORDER }
