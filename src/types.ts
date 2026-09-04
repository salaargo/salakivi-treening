export type PhaseId = 'start' | 'treening' | 'power' | 'taastus'

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // Sun–Sat

export interface Phase {
  id: PhaseId
  name: string
  weeks: number
  /** Korduste vahemik faasis */
  setsMin: number
  setsMax: number
  /** Multiplier of base weight (1 = baasraskus, 0.9 = −10%) */
  weightMultiplier: number
  description: string
}

export interface TrainingGroup {
  id: string
  name: string
  /** Kalendrinädala esmaspäev, millest faasiring jookseb */
  cycleStartDate: string
}

/** Trenaažöör / pink sama harjutuse jaoks */
export interface ExerciseMachine {
  id: string
  name: string
  baseWeightKg: number
}

export interface ExerciseTemplate {
  id: string
  name: string
  /** Mitu korda seda harjutust treeningus tehakse (korduste read). */
  rounds: number
  restSeconds: number
  /** Erinevad pingid sama harjutuse jaoks */
  machines: ExerciseMachine[]
}

export interface WorkoutPlan {
  id: string
  name: string
  /** Grupp, kuhu kava kuulub */
  groupId: string
  exercises: ExerciseTemplate[]
}

/** Nädalapäev → treeninggrupp (null = puhkepäev) */
export type WeekDayAssignments = Partial<Record<Weekday, string | null>>

export interface WeekTemplate {
  id: string
  name: string
  days: WeekDayAssignments
}

export interface SetLog {
  /** Valitud pink selle korduse jaoks */
  machineId: string
  weightKg: number
  reps: number
  completed: boolean
}

export interface ExerciseLog {
  exerciseId: string
  sets: SetLog[]
}

export interface DayLog {
  dateKey: string
  groupId: string
  phaseId: PhaseId
  exercises: ExerciseLog[]
  /** Esimese Starti aeg */
  startedAt?: string
  finishedAt?: string
  /** Start → Tehtud intervallide summa (ms) */
  workMs?: number
  /** Tehtud → järgmine Start intervallide summa (ms) */
  restMs?: number
  /** Lõpetatud STOPPiga enne kõigi harjutuste tegemist */
  stoppedEarly?: boolean
}

export interface AppState {
  phases: Phase[]
  groups: TrainingGroup[]
  plans: WorkoutPlan[]
  /** Koostatud nädalad (vähemalt 2), kalendris vaheldumisi */
  weeks: WeekTemplate[]
  logs: Record<string, DayLog>
}

export interface PhaseProgress {
  phase: Phase
  cycleWeekIndex: number
  weekInPhase: number
}

export type Screen =
  | { name: 'home' }
  | { name: 'train-choice' }
  | { name: 'train-phase' }
  | { name: 'week' }
  | { name: 'workout'; dateKey: string }
  | { name: 'settings' }
