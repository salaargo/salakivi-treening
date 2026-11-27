import { describe, expect, it } from 'vitest'
import { createStarterState, isGenericStarterPlan } from './seed/starterState'
import {
  getExercisesForDate,
  getPlanForDate,
  isPlaceholderWorkout,
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

  it('taastab eelmise kolmapäeva nimed, kui kava id-d on üle kirjutatud', () => {
    const starter = createStarterState()
    const state: AppState = {
      ...starter,
      logs: {
        '2026-11-18': {
          dateKey: '2026-11-18',
          planId: 'old-pull',
          phaseId: 'start',
          startedAt: '2026-11-18T14:00:00.000Z',
          exercises: [
            {
              exerciseId: 'old-1',
              name: 'Kangi rida',
              sets: [{ machineId: 'm1', weightKg: 40, reps: 8, completed: true }],
            },
            {
              exerciseId: 'old-2',
              name: 'Face pull',
              sets: [{ machineId: 'm2', weightKg: 12, reps: 10, completed: true }],
            },
            {
              exerciseId: 'old-3',
              name: 'Haamer-curl',
              sets: [{ machineId: 'm3', weightKg: 14, reps: 10, completed: true }],
            },
          ],
        },
      },
    }
    expect(getExercisesForDate(state, '2026-11-25').map((item) => item.name)).toEqual([
      'Kangi rida',
      'Face pull',
      'Haamer-curl',
    ])
    expect(isPlaceholderWorkout(state, '2026-11-25')).toBe(false)
  })

  it('jätab alustamata näidise logi vahele ja ei lukusta näidiskavaga', () => {
    const starter = createStarterState()
    const tomme = starter.plans.find((item) => item.name === 'Tõmme')
    const state: AppState = {
      ...starter,
      logs: {
        '2026-11-18': {
          dateKey: '2026-11-18',
          planId: 'old-pull',
          phaseId: 'start',
          startedAt: '2026-11-18T14:00:00.000Z',
          exercises: [
            {
              exerciseId: 'old-1',
              name: 'Kangi rida',
              sets: [{ machineId: 'm1', weightKg: 40, reps: 8, completed: true }],
            },
          ],
        },
        '2026-11-25': {
          dateKey: '2026-11-25',
          planId: tomme?.id ?? 'x',
          phaseId: 'start',
          exercises: (tomme?.exercises ?? []).map((item) => ({
            exerciseId: item.id,
            name: item.name,
            sets: [{ machineId: item.machines[0]?.id ?? 'm', weightKg: 10, reps: 8, completed: false }],
          })),
        },
      },
    }
    expect(lastSameWeekdayLog(state, '2026-11-25')?.dateKey).toBe('2026-11-18')
    const parsed = parseAppState(state)
    const tommeAfter = parsed.plans.find((item) => item.name === 'Tõmme')
    expect(tommeAfter?.exercises.map((item) => item.name)).toEqual(['Kangi rida'])
    expect(parsed.logs['2026-11-25']).toBeUndefined()
  })

  it('näitab näidise asemel hoiatust, kui ajaloo nimed puuduvad', () => {
    const starter = createStarterState()
    const state: AppState = {
      ...starter,
      logs: {
        '2026-11-18': {
          dateKey: '2026-11-18',
          planId: 'old-pull',
          phaseId: 'start',
          startedAt: '2026-11-18T14:00:00.000Z',
          exercises: [
            {
              exerciseId: 'old-1',
              sets: [{ machineId: 'm1', weightKg: 40, reps: 8, completed: true }],
            },
          ],
        },
      },
    }
    expect(isPlaceholderWorkout(state, '2026-11-25')).toBe(true)
    expect(getPlanForDate(state, '2026-11-25')?.name).toBe('Tõmme')
  })
})
