interface TrainChoiceScreenProps {
  groupName: string
  phaseName: string
  phaseHint: string
  onContinue: () => void
  onStartNewPhase: () => void
  onBack: () => void
}

export function TrainChoiceScreen({
  groupName,
  phaseName,
  phaseHint,
  onContinue,
  onStartNewPhase,
  onBack,
}: TrainChoiceScreenProps) {
  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onBack} aria-label="Tagasi">
          ←
        </button>
        <h2>Treenima</h2>
      </header>

      <div className="choice-card">
        <p className="muted small">{groupName}</p>
        <p className="choice-title">
          Praegune faas: <strong>{phaseName}</strong>
        </p>
        <p className="muted">{phaseHint}</p>
      </div>

      <p className="choice-question">Kas jätkame treeningut või alustame uut faasi?</p>

      <div className="home-actions">
        <button type="button" className="btn btn-hero" onClick={onContinue}>
          Jätka treeningut
        </button>
        <button type="button" className="btn btn-secondary" onClick={onStartNewPhase}>
          Alustame uut faasi
        </button>
        <button type="button" className="btn btn-ghost full" onClick={onBack}>
          Tagasi
        </button>
      </div>
    </div>
  )
}
