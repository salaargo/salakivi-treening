import type { AppState, WeekTemplate } from '../types'
import { DEFAULT_PHASES, DEFAULT_REST_SECONDS } from '../phases'
import { withDefaultMachine } from '../exercises'

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function emptyDays(): WeekTemplate['days'] {
  return { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }
}

function mondayKey(d = new Date()): string {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const dayNum = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${dayNum}`
}

/**
 * Salakivi / Argo valmis algmall — otse treeningkavad (gruppe pole).
 * Esmaspäev = Tõuke, kolmapäev = Tõmme, reede = Jalad + core.
 */
export function createStarterState(): AppState {
  const cycleStartDate = mondayKey()

  const planPush = {
    id: id('plan'),
    name: 'Tõuke',
    exercises: [
      withDefaultMachine('Kükk', 60, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Pingipress', 40, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Õlapress', 20, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Triceps pushdown', 15, DEFAULT_REST_SECONDS, id('ex')),
    ],
  }

  const planPull = {
    id: id('plan'),
    name: 'Tõmme',
    exercises: [
      withDefaultMachine('Maastõste', 70, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Rida (hantel)', 22.5, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Lat-tõmme', 35, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Biceps curl', 12.5, DEFAULT_REST_SECONDS, id('ex')),
    ],
  }

  const planLegs = {
    id: id('plan'),
    name: 'Jalad + core',
    exercises: [
      withDefaultMachine('Jalgade press', 80, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Rumeenia maastõste', 50, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Lunges', 16, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Plank (kg = aeg)', 45, DEFAULT_REST_SECONDS, id('ex')),
    ],
  }

  const week1Days = emptyDays()
  week1Days[1] = planPush.id
  week1Days[3] = planPull.id
  week1Days[5] = planLegs.id

  const week2Days = emptyDays()
  week2Days[1] = planPull.id
  week2Days[3] = planPush.id
  week2Days[5] = planLegs.id

  return {
    phases: DEFAULT_PHASES.map((p) => ({ ...p })),
    plans: [planPush, planPull, planLegs],
    weeks: [
      { id: id('week'), name: 'Treeningnädal', days: week1Days },
      // Teine mall jääb varuks, kui keegi vaheldumise sisse lülitab
      { id: id('week'), name: 'Nädal 2', days: week2Days },
    ],
    useRotatingWeeks: false,
    logs: {},
    cycleStartDate,
  }
}
