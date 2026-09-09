import { useMemo, useState } from 'react'
import type { AppState } from '../types'
import { buildHistoryRows } from '../storage'
import { formatDayMonth, parseDateKey } from '../dates'

interface StatsScreenProps {
  state: AppState
  onBack: () => void
}

export function StatsScreen({ state, onBack }: StatsScreenProps) {
  const rows = useMemo(() => buildHistoryRows(state), [state])
  const [exerciseFilter, setExerciseFilter] = useState('')
  const exercises = useMemo(() => {
    const names = [...new Set(rows.map((row) => row.exerciseName))]
    names.sort((a, b) => a.localeCompare(b, 'et'))
    return names
  }, [rows])
  const visible = exerciseFilter ? rows.filter((row) => row.exerciseName === exerciseFilter) : rows

  return (
    <div className="screen stats-screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Tagasi">
          ←
        </button>
        <h2>Ajalugu</h2>
      </header>
      <p className="muted small">
        Sinu treeningud: harjutus, pink ja raskus seeriate kaupa. Teised treenijad seda ei näe.
      </p>
      {rows.length === 0 ? (
        <p className="muted">Logisid pole veel. Pärast treeninguid ilmuvad read siia.</p>
      ) : (
        <>
          <div className="field block">
            <label htmlFor="stats-ex">Harjutus</label>
            <select
              id="stats-ex"
              value={exerciseFilter}
              onChange={(e) => setExerciseFilter(e.target.value)}
            >
              <option value="">Kõik harjutused</option>
              {exercises.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Kuupäev</th>
                  <th>Kava</th>
                  <th>Harjutus</th>
                  <th>Pink</th>
                  <th>Seeria</th>
                  <th>kg</th>
                  <th>Kordusi</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr key={`${row.dateKey}-${row.exerciseName}-${row.setNumber}-${index}`} className={row.completed ? '' : 'is-missed'}>
                    <td>{formatDayMonth(parseDateKey(row.dateKey))}</td>
                    <td>{row.planName}</td>
                    <td>{row.exerciseName}</td>
                    <td>{row.machineName}</td>
                    <td>{row.setNumber}</td>
                    <td>{row.weightKg}</td>
                    <td>{row.completed ? row.reps : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
