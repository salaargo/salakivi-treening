import { useEffect, useState } from 'react'
import type { LiveSnapshot } from '../live/remote'
import { sendCommand } from '../live/remote'

interface WatchRemoteScreenProps {
  snap: LiveSnapshot
  onTrainHere: () => void
}

export function WatchRemoteScreen({ snap, onTrainHere }: WatchRemoteScreenProps) {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (snap.flow !== 'resting' || !snap.restEndsAt) return
    const id = window.setInterval(() => setTick((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [snap.flow, snap.restEndsAt])

  const restLeft =
    snap.flow === 'resting' && snap.restEndsAt
      ? Math.max(0, Math.ceil((snap.restEndsAt - Date.now()) / 1000))
      : 0
  const mm = String(Math.floor(restLeft / 60)).padStart(2, '0')
  const ss = String(restLeft % 60).padStart(2, '0')

  return (
    <div className="screen watch-remote">
      <p className="eyebrow">Kell · telefon</p>
      <h2 className="watch-title">{snap.exerciseName ?? snap.planName ?? 'Treening'}</h2>
      {snap.otherName && <p className="muted small">Segamini: {snap.otherName}</p>}

      {snap.flow === 'resting' ? (
        <>
          <p className="watch-clock">
            {mm}:{ss}
          </p>
          {snap.remainingHint && <p className="timer-remaining">{snap.remainingHint}</p>}
          {snap.nextHint && <p className="muted small">{snap.nextHint}</p>}
          <button type="button" className="btn btn-tehtud-lg" onClick={() => sendCommand('skip-rest')}>
            Jäta paus vahele
          </button>
        </>
      ) : (
        <>
          {snap.setNumber != null && (
            <p className="watch-set">
              Seeria {snap.setNumber}/{snap.totalRounds ?? '—'}
            </p>
          )}
          {snap.remainingHint && <p className="muted small">{snap.remainingHint}</p>}
          {snap.machineName && (
            <p className="muted small">
              {snap.machineName}
              {snap.weightKg != null ? ` · ${snap.weightKg} kg` : ''}
            </p>
          )}
          {snap.flow === 'ready' && (
            <button type="button" className="btn btn-tehtud-lg" onClick={() => sendCommand('start')}>
              Start
            </button>
          )}
          {snap.flow === 'active' && (
            <button type="button" className="btn btn-tehtud-lg" onClick={() => sendCommand('tehtud')}>
              Tehtud
            </button>
          )}
          {snap.flow === 'pick' && (
            <p className="muted">Vali harjutus telefonis või treeni siin.</p>
          )}
          {snap.flow === 'sauna' && <p className="sauna-word">Sauna!</p>}
        </>
      )}

      {(snap.flow === 'ready' || snap.flow === 'active') && (
        <button
          type="button"
          className="btn btn-ghost full"
          onClick={() => sendCommand('finish-exercise')}
        >
          Lõpeta harjutus
        </button>
      )}

      <button type="button" className="btn btn-ghost full" onClick={onTrainHere}>
        Treeni kellas, mitte telefonis
      </button>
    </div>
  )
}
