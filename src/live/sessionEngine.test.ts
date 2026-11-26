import { describe, expect, it } from 'vitest'
import type { DayLog, ExerciseLog, SetLog } from '../types'
import {
  allExercisesDone,
  applySessionCommand,
  remainingCatalog,
  sanitizeLiveSession,
  sessionToSnapshot,
  snapshotShouldReplace,
  type LiveSession,
  type RankedSnapshot,
} from './sessionEngine'

const NAMES = ['Maastõste', 'Rida (hantel)', 'Lat-tõmme', 'Biceps curl']
const IDS = ['e0', 'e1', 'e2', 'e3']

function set(completed: boolean): SetLog {
  return { machineId: 'm', weightKg: 20, reps: 8, completed }
}

function exLog(id: string, done: number, total = 4): ExerciseLog {
  return {
    exerciseId: id,
    sets: Array.from({ length: total }, (_, i) => set(i < done)),
  }
}

function dayLog(doneByIndex: number[]): DayLog {
  return {
    dateKey: '2026-11-25',
    planId: 'pull',
    phaseId: 'start',
    startedAt: '2026-11-25T14:00:00.000Z',
    exercises: IDS.map((id, i) => exLog(id, doneByIndex[i] ?? 0)),
  }
}

function session(partial: Partial<LiveSession> = {}, doneByIndex = [4, 4, 0, 0]): LiveSession {
  return {
    v: 2,
    dateKey: '2026-11-25',
    flow: 'pick',
    selected: [],
    activeSlot: 0,
    log: dayLog(doneByIndex),
    restSeconds: 90,
    restHint: '',
    restNext: '',
    pendingAfterRest: 'ready',
    sessionStartedAt: Date.parse('2026-11-25T14:00:00.000Z'),
    workMs: 0,
    restMs: 0,
    setStartedAt: null,
    lastTehtudAt: null,
    planName: 'Tõmme',
    rev: 8,
    exercises: IDS.map((id, i) => ({ id, name: NAMES[i], restSeconds: 90 })),
    ...partial,
  }
}

function snapOf(live: LiveSession, extra: Partial<RankedSnapshot> = {}): RankedSnapshot {
  return { ...sessionToSnapshot(live), ...extra }
}

describe('kolmas harjutus pärast esimest paari', () => {
  it('ei jäta lõpetatud paari valikusse', () => {
    const stuck = session({ flow: 'pick', selected: [0, 1], rev: 8 })
    const cleaned = sanitizeLiveSession(stuck)
    expect(cleaned.selected).toEqual([])
    expect(cleaned.flow).toBe('pick')
    expect(remainingCatalog(cleaned.log, cleaned.exercises).map((row) => row.index)).toEqual([2, 3])
  })

  it('Start valikus käivitab 3. harjutuse, mitte tehtud paari', () => {
    const stuck = session({ flow: 'pick', selected: [0, 1], rev: 8 })
    const next = applySessionCommand(stuck, 'start', Date.parse('2026-11-25T15:00:00.000Z'))
    expect(next.flow).toBe('active')
    expect(next.selected).toEqual([2])
    expect(next.exercises[next.selected[0]]?.name).toBe('Lat-tõmme')
  })

  it('Start tühjast valikust võtab esimese vaba harjutuse', () => {
    const open = session({ flow: 'pick', selected: [], rev: 8 })
    const next = applySessionCommand(open, 'start', Date.parse('2026-11-25T15:00:00.000Z'))
    expect(next.selected).toEqual([2])
    expect(next.flow).toBe('active')
  })

  it('pick-index 3. harjutusele viskab tehtud paari valikust välja', () => {
    const stuck = session({ flow: 'pick', selected: [0, 1], rev: 8 })
    const next = applySessionCommand(stuck, 'pick-index', Date.now(), { index: 2 })
    expect(next.selected).toEqual([2])
    expect(next.flow).toBe('pick')
  })

  it('Tehtud tehtud harjutusel ei jää aktiivseks, vaid avab 3. harjutuse valiku', () => {
    const stuck = session({
      flow: 'active',
      selected: [0, 1],
      activeSlot: 0,
      setStartedAt: Date.now() - 1000,
      rev: 9,
    })
    const next = applySessionCommand(stuck, 'tehtud', Date.now())
    expect(next.flow).toBe('pick')
    expect(next.selected).toEqual([])
    expect(allExercisesDone(next.log, next.exercises)).toBe(false)
  })

  it('telefoni stale pick ei kirjuta kella 3. harjutuse Starti üle', () => {
    const watch = applySessionCommand(
      session({ flow: 'pick', selected: [], rev: 10 }),
      'start',
      Date.now(),
    )
    const phone = session({ flow: 'pick', selected: [0, 1], rev: 8 })
    expect(
      snapshotShouldReplace(snapOf(phone, { at: Date.now() + 1000 }), snapOf(watch, { at: Date.now() })),
    ).toBe(false)
  })

  it('telefoni tehtud-paar pick ei kirjuta kella Lat-tõmme valikut üle', () => {
    const watch = applySessionCommand(
      session({ flow: 'pick', selected: [0, 1], rev: 10 }),
      'pick-index',
      Date.now(),
      { index: 2 },
    )
    const phone = session({ flow: 'pick', selected: [0, 1], rev: 10 })
    expect(watch.selected).toEqual([2])
    expect(
      snapshotShouldReplace(snapOf(phone, { at: Date.now() + 500 }), snapOf(watch, { at: Date.now() })),
    ).toBe(false)
  })

  it('vana telefoni valik [0,1] ei võida kella [2]', () => {
    const watch = applySessionCommand(
      session({ flow: 'pick', selected: [], rev: 10 }),
      'pick-index',
      Date.now(),
      { index: 2 },
    )
    const rawPhone: RankedSnapshot = {
      v: 1,
      flow: 'pick',
      dateKey: '2026-11-25',
      at: Date.now() + 2000,
      session: session({ flow: 'pick', selected: [0, 1], rev: 10 }),
    }
    expect(watch.selected).toEqual([2])
    expect(snapshotShouldReplace(rawPhone, snapOf(watch))).toBe(false)
  })

  it('värske kolmapäeva Start tühjast valikust käivitab Maastõste', () => {
    const fresh = session({ flow: 'pick', selected: [], rev: 0 }, [0, 0, 0, 0])
    const next = applySessionCommand(fresh, 'start', Date.now())
    expect(next.selected).toEqual([0])
    expect(next.flow).toBe('active')
    expect(next.exercises[0]?.name).toBe('Maastõste')
  })

  it('tühi nimekiri ei ole kõik tehtud', () => {
    expect(allExercisesDone(dayLog([]), [])).toBe(false)
  })
})
