import type { Phase, PhaseId } from './types'

export const DEFAULT_PHASES: Phase[] = [
  {
    id: 'start',
    name: 'Start',
    weeks: 2,
    setsMin: 6,
    setsMax: 8,
    weightMultiplier: 1,
    description: '2 nädalat · 6–8 kordust · baasraskus',
  },
  {
    id: 'treening',
    name: 'Treening',
    weeks: 2,
    setsMin: 10,
    setsMax: 12,
    weightMultiplier: 0.9,
    description: '2 nädalat · 10–12 kordust · baasraskus −10%',
  },
  {
    id: 'power',
    name: 'Power',
    weeks: 1,
    setsMin: 15,
    setsMax: 17,
    weightMultiplier: 0.85,
    description: '1 nädal · 15–17 kordust · baasraskus −15%',
  },
  {
    id: 'taastus',
    name: 'Taastus',
    weeks: 1,
    setsMin: 8,
    setsMax: 10,
    weightMultiplier: 0.7,
    description: '1 nädal · 8–10 kordust · baasraskus −30%',
  },
]

/** @deprecated use DEFAULT_PHASES — kept for older imports */
export const PHASES = DEFAULT_PHASES

export const DEFAULT_REST_SECONDS = 60

export function cycleWeeks(phases: Phase[]): number {
  return Math.max(1, phases.reduce((sum, p) => sum + p.weeks, 0))
}

export function buildPhaseDescription(phase: Phase): string {
  const pct = Math.round(phase.weightMultiplier * 100)
  const weightLabel =
    pct === 100 ? 'baasraskus' : `baasraskus ${pct > 100 ? '+' : '−'}${Math.abs(100 - pct)}%`
  return `${phase.weeks} nädalat · ${phase.setsMin}–${phase.setsMax} kordust · ${weightLabel}`
}

export function getPhaseById(phases: Phase[], id: PhaseId): Phase {
  return phases.find((p) => p.id === id) ?? phases[0] ?? DEFAULT_PHASES[0]
}

export function getPhaseForCycleWeek(phases: Phase[], weekIndex: number): Phase {
  const total = cycleWeeks(phases)
  let remaining = ((weekIndex % total) + total) % total
  for (const phase of phases) {
    if (remaining < phase.weeks) return phase
    remaining -= phase.weeks
  }
  return phases[0] ?? DEFAULT_PHASES[0]
}

export function getWeekInPhase(phases: Phase[], weekIndex: number): number {
  const total = cycleWeeks(phases)
  let remaining = ((weekIndex % total) + total) % total
  for (const phase of phases) {
    if (remaining < phase.weeks) return remaining + 1
    remaining -= phase.weeks
  }
  return 1
}

export function getFirstCycleWeekOfPhase(phases: Phase[], phaseId: PhaseId): number {
  let index = 0
  for (const phase of phases) {
    if (phase.id === phaseId) return index
    index += phase.weeks
  }
  return 0
}

/** Treeningus kasutatav korduste arv (vahemiku ülempiir). */
export function phaseSetCount(phase: Phase): number {
  return Math.max(1, phase.setsMax)
}

export function suggestedWeight(baseKg: number, multiplier: number): number {
  const raw = baseKg * multiplier
  return Math.round(raw * 2) / 2
}
