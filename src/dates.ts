import type { AppState, Weekday, WeekTemplate } from './types'
import { createStarterState } from './seed/starterState'

/** @deprecated eelistatud nimi: createStarterState — sama Argo/Salakivi algmall */
export function createDefaultState(): AppState {
  return createStarterState()
}

export { createStarterState }

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
    id: `week-${Math.random().toString(36).slice(2, 9)}`,
    name,
    days: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
  }
}

export type { Weekday }
