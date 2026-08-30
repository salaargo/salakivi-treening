import type { AppState, Weekday, WeekTemplate } from './types'
import { DEFAULT_REST_SECONDS } from './phases'
import { withDefaultMachine } from './exercises'
import { DEFAULT_PHASES } from './phases'

function id(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function emptyDays(): WeekTemplate['days'] {
  return { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null }
}

export function createDefaultState(): AppState {
  const cycleStartDate = toDateKey(startOfWeekMonday(new Date()))

  const groupPush = { id: id('group'), name: 'Tõuke', cycleStartDate }
  const groupPull = { id: id('group'), name: 'Tõmme', cycleStartDate }
  const groupLegs = { id: id('group'), name: 'Jalad + core', cycleStartDate }

  const planA = {
    id: id('plan'),
    name: 'Tõuke kava',
    groupId: groupPush.id,
    exercises: [
      withDefaultMachine('Kükk', 60, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Pingipress', 40, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Õlapress', 20, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Triceps pushdown', 15, DEFAULT_REST_SECONDS, id('ex')),
    ],
  }

  const planB = {
    id: id('plan'),
    name: 'Tõmme kava',
    groupId: groupPull.id,
    exercises: [
      withDefaultMachine('Maastõste', 70, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Rida (hantel)', 22.5, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Lat-tõmme', 35, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Biceps curl', 12.5, DEFAULT_REST_SECONDS, id('ex')),
    ],
  }

  const planC = {
    id: id('plan'),
    name: 'Jalad kava',
    groupId: groupLegs.id,
    exercises: [
      withDefaultMachine('Jalgade press', 80, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Rumeenia maastõste', 50, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Lunges', 16, DEFAULT_REST_SECONDS, id('ex')),
      withDefaultMachine('Plank (kg = aeg)', 45, DEFAULT_REST_SECONDS, id('ex')),
    ],
  }

  const week1Days = emptyDays()
  week1Days[1] = groupPush.id
  week1Days[3] = groupPull.id
  week1Days[5] = groupLegs.id

  const week2Days = emptyDays()
  week2Days[1] = groupPull.id
  week2Days[3] = groupPush.id
  week2Days[5] = groupLegs.id

  return {
    phases: DEFAULT_PHASES.map((p) => ({ ...p })),
    groups: [groupPush, groupPull, groupLegs],
    plans: [planA, planB, planC],
    weeks: [
      { id: id('week'), name: 'Nädal 1', days: week1Days },
      { id: id('week'), name: 'Nädal 2', days: week2Days },
    ],
    logs: {},
  }
}

export function startOfWeekMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  next.setDate(next.getDate() + n)
  return next
}

export function weekdayLabel(weekday: number): string {
  return ['P', 'E', 'T', 'K', 'N', 'R', 'L'][weekday]
}

export function weekdayFull(weekday: number): string {
  return ['Pühapäev', 'Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede', 'Laupäev'][
    weekday
  ]
}

export function formatDayMonth(d: Date): string {
  return d.toLocaleDateString('et-EE', { day: 'numeric', month: 'short' })
}

export function createEmptyWeekTemplate(name: string): WeekTemplate {
  return {
    id: id('week'),
    name,
    days: emptyDays(),
  }
}

export type { Weekday }
