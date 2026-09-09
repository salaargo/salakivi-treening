import type { Phase, PhaseId } from '../types'
import { phaseToneKey } from '../phases'

interface TrainPhaseScreenProps {
  planName: string
  phases: Phase[]
  onSelectPhase: (phaseId: PhaseId) => void
  onBack: () => void
}

export function TrainPhaseScreen({
  planName,
  phases,
  onSelectPhase,
  onBack,
}: TrainPhaseScreenProps) {
  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Tagasi">
          ←
        </button>
        <h2>Uus faas</h2>
      </header>

      <div className="choice-card">
        <p className="choice-title">Kui oled kindel, vali faas</p>
        <p className="muted">
          {planName}: valitud faas algab sellest kalendrinädalast. Edasi jookseb ring kalendri
          järgi.
        </p>
      </div>

      <ul className="phase-pick-list">
        {phases.map((phase) => (
          <li key={phase.id}>
            <button
              type="button"
              className="phase-pick-btn"
              onClick={() => onSelectPhase(phase.id)}
            >
              <span className="phase-pill" data-phase={phaseToneKey(phase.id)}>
                {phase.name}
              </span>
              <span className="phase-pick-meta">
                <strong>{phase.weeks} nädalat</strong>
                <span className="muted small">{phase.description}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="btn btn-ghost full" onClick={onBack}>
        Tagasi
      </button>
    </div>
  )
}
