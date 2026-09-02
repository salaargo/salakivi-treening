interface HomeScreenProps {
  onTrain: () => void
  onSettings: () => void
  groupName: string
  phaseName: string
  phaseHint: string
  userEmail?: string
}

export function HomeScreen({
  onTrain,
  onSettings,
  groupName,
  phaseName,
  phaseHint,
  userEmail,
}: HomeScreenProps) {
  return (
    <div className="screen home-screen">
      <header className="home-hero">
        <p className="eyebrow">Salakivi</p>
        <h1 className="brand">Treening</h1>
        {userEmail && <p className="muted small home-user">{userEmail}</p>}
        <p className="home-phase">
          {groupName}: <strong>{phaseName}</strong>
        </p>
        <p className="muted">{phaseHint}</p>
      </header>

      <div className="home-actions">
        <button type="button" className="btn btn-hero" onClick={onTrain}>
          Treenima
        </button>
        <button type="button" className="btn btn-secondary" onClick={onSettings}>
          Seaded
        </button>
      </div>
    </div>
  )
}
