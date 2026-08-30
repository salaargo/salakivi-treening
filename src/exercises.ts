import type { ExerciseMachine, ExerciseTemplate } from './types'

export function createMachine(name: string, baseWeightKg: number, id?: string): ExerciseMachine {
  return {
    id: id ?? `m-${Math.random().toString(36).slice(2, 9)}`,
    name: name.trim() || 'Pink',
    baseWeightKg,
  }
}

export function getPrimaryMachine(ex: ExerciseTemplate): ExerciseMachine {
  return ex.machines[0] ?? createMachine('Pink 1', 20)
}

export function getMachine(ex: ExerciseTemplate, machineId: string): ExerciseMachine | null {
  return ex.machines.find((m) => m.id === machineId) ?? null
}

export function exerciseRounds(ex: ExerciseTemplate): number {
  const rounds = typeof ex.rounds === 'number' && Number.isFinite(ex.rounds) ? ex.rounds : 4
  return Math.max(1, Math.round(rounds))
}

export function withDefaultMachine(
  name: string,
  baseWeightKg: number,
  restSeconds: number,
  id?: string,
): ExerciseTemplate {
  return {
    id: id ?? `ex-${Math.random().toString(36).slice(2, 9)}`,
    name,
    rounds: 4,
    restSeconds,
    machines: [createMachine('Pink 1', baseWeightKg)],
  }
}
