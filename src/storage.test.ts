import { describe, expect, it } from 'vitest'
import { createStarterState, isGenericStarterPlan } from './seed/starterState'
import {
  getExercisesForDate,
  getPlanForDate,
  lastSameWeekdayLog,
  parseAppState,
  preferExistingProgram,
} from './storage'
import type { AppState, DayLog, ExerciseTemplate, WorkoutPlan } from './types'

function plan(id: string, name: string, exercises: ExerciseTemplate[]): WorkoutPlan {
  return { id, name, exercises }
}

function ex(id: string, name: string): ExerciseTemplate {
  return {
    id,
    name,
    rounds: 4,
    restSeconds: 90,
    machines: [{ id: `m-${id}`, name: 'Pink', baseWeightKg: 20 }],
  }
}

function log(dateKey: string, planId: string, exerciseIds: string[]): DayLog {
  return {
    dateKey,
    planId,
    phaseId: 'start',
    startedAt: `${dateKey}T14:00:00.000Z`,
    exercises: exerciseIds.map((id) => ({
      exerciseId: id,
      name: id,
      sets: [{ machineId: `m-${id}`, weightKg: 30, reps: 8, completed: true }],
    })),
  }
}

describe('eelmise nädala kava, mitte näidise Tõmme', () => {
  it('tunneb näidiskava Tõmme harjutused ära', () => {
    const starter = createStarterState()
    const tomme = starter.plans.find((item) => item.name === 'Tõmme')
    expect(tomme && isGenericStarterPlan(tomme)).toBe(true)
  })

  it('vahelduvad nädalad on vaikimisi väljas', () => {
    const parsed = parseAppState({
      phases: createStarterState().phases,
      plans: createStarterState().plans,
      weeks: createStarterState().weeks,
      logs: {},
      cycleStartDate: '2026-10-05',
    })
    expect(parsed.useRotatingWeeks).toBe(false)
  })

  it('kolmapäeval võtab eelmise nädala oma kava, mitte malliharjutusi', () => {
    const starter = createStarterState()
    const customPull = plan('plan-custom-pull', 'Tõmme', [
      ex('ex-row', 'Kangi rida'),
      ex('ex-face', 'Face pull'),
      ex('ex-curl', 'Haamer-curl'),
    ])
    const state: AppState = {
      ...starter,
      plans: [...starter.plans, customPull],
      logs: {
        '2026-11-18': log('2026-11-18', 'plan-custom-pull', ['ex-row', 'ex-face', 'ex-curl']),
      },
    }
    const chosen = getPlanForDate(state, '2026-11-25')
    expect(chosen?.id).toBe('plan-custom-pull')
    expect(getExercisesForDate(state, '2026-11-25').map((item) => item.name)).toEqual([
      'Kangi rida',
      'Face pull',
      'Haamer-curl',
    ])
    expect(lastSameWeekdayLog(state, '2026-11-25')?.dateKey).toBe('2026-11-18')
  })

  it('ei kirjuta telefoni isiklikku kava näidiskavaga üle', () => {
    const starter = createStarterState()
    const local: AppState = {
      ...starter,
      plans: [
        plan('mine', 'Tõmme', [ex('a', 'Kangi rida'), ex('b', 'Face pull')]),
      ],
    }
    const merged = preferExistingProgram(starter, local)
    expect(merged.plans[0]?.exercises.map((item) => item.name)).toEqual(['Kangi rida', 'Face pull'])
  })
})
