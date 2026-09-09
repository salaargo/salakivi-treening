import type { AppState, Weekday } from '../types'
import {
  addDays,
  formatDayMonth,
  startOfWeekMonday,
  toDateKey,
  weekdayFull,
  weekdayLabel,
} from '../dates'
import { getPlanForDate, getPhaseForDate, getWeekTemplateForDate, todayKey, dayLogHasIncomplete } from '../storage'
import { phaseToneKey } from '../phases'

interface WeekScreenProps {
  state: AppState
  weekOffset: number
  onWeekOffset: (n: number) => void
  onBack: () => void
  onSelectDay: (dateKey: string) => void
}

export function WeekScreen({
  state,
  weekOffset,
  onWeekOffset,
  onBack,
  onSelectDay,
}: WeekScreenProps) {
  const today = todayKey()
  const monday = addDays(startOfWeekMonday(new Date()), weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const template = getWeekTemplateForDate(state, toDateKey(monday))

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Tagasi">
          ←
        </button>
        <div className="topbar-title">
          <h2>Nädal</h2>
          <p className="muted small">
            {state.useRotatingWeeks === false
              ? `${template.name} · sama kava igal nädalal · ${formatDayMonth(days[0])} – ${formatDayMonth(days[6])}`
              : `${template.name} · ${formatDayMonth(days[0])} – ${formatDayMonth(days[6])}`}
          </p>
        </div>
        <div className="week-nav">
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => onWeekOffset(weekOffset - 1)}>
            ‹
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => onWeekOffset(weekOffset + 1)}>
            ›
          </button>
        </div>
      </header>

      <ul className="day-list">
        {days.map((date) => {
          const key = toDateKey(date)
          const weekday = date.getDay() as Weekday
          const plan = getPlanForDate(state, key)
          const phase = getPhaseForDate(state, key)
          const isToday = key === today
          const log = state.logs[key]
          const partial = Boolean(log?.finishedAt && dayLogHasIncomplete(log))
          const done = Boolean(log?.finishedAt && !dayLogHasIncomplete(log))

          return (
            <li key={key}>
              <button
                type="button"
                className={`day-card ${isToday ? 'is-today' : ''} ${plan ? '' : 'is-rest'} ${done ? 'is-done' : ''} ${partial ? 'is-partial' : ''}`}
                onClick={() => plan && onSelectDay(key)}
                disabled={!plan}
              >
                <div className="day-card-left">
                  <span className="day-letter">{weekdayLabel(weekday)}</span>
                  <div>
                    <p className="day-name">{weekdayFull(weekday)}</p>
                    <p className="muted small">{formatDayMonth(date)}</p>
                  </div>
                </div>
                <div className="day-card-right">
                  {plan && phase ? (
                    <>
                      <span className="phase-pill" data-phase={phaseToneKey(phase.id)}>
                        {phase.name}
                      </span>
                      <p className="day-plan">{plan.name}</p>
                      {done && <p className="done-tag">Tehtud</p>}
                      {partial && <p className="missed-tag">Tegemata jäi</p>}
                    </>
                  ) : (
                    <p className="muted">Puhkepäev</p>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {weekOffset !== 0 && (
        <button type="button" className="btn btn-secondary full" onClick={() => onWeekOffset(0)}>
          Tänane nädal
        </button>
      )}
    </div>
  )
}
