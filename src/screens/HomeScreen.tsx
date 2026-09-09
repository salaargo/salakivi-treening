interface HomeScreenProps {
  onTrain: () => void
  onSettings: () => void
  onStats?: () => void
  planName: string
  phaseName: string
  phaseHint: string
  userName?: string
  compact?: boolean
}

export function HomeScreen({
  onTrain,
  onSettings,
  onStats,
  planName,
  phaseName,
  phaseHint,
  userName,
  compact = false,
}: HomeScreenProps) {
  return (
    <div className={`screen home-screen ${compact ? 'is-compact' : ''}`}>
      <header className="home-hero">
        <p className="eyebrow">Salakivi</p>
        <h1 className="brand">Treening</h1>
        {userName && (
          <p className="home-hello">
            Tere, <strong>{userName}</strong>
          </p>
        )}
        <p className="home-phase">
          {planName}: <strong>{phaseName}</strong>
        </p>
        <p className="muted">{phaseHint}</p>
      </header>

      <div className="home-actions">
        <button type="button" className="btn btn-hero" onClick={onTrain}>
          Treenima
        </button>
        {onStats && (
          <button type="button" className="btn btn-secondary" onClick={onStats}>
            Ajalugu
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onSettings}>
          Seaded
        </button>
      </div>
    </div>
  )
}
