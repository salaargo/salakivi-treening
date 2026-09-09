import { useEffect, useState } from 'react'
import type { LiveSnapshot } from '../live/remote'
import { sendCommand } from '../live/remote'
import { remainingRestSeconds } from '../components/RestTimer'
import type { WatchFace } from '../orientation'

interface WatchRemoteScreenProps {
  snap: LiveSnapshot | null
  face: WatchFace
}

function formatClock(totalSec: number): string {
  const mm = String(Math.floor(Math.max(totalSec, 0) / 60)).padStart(2, '0')
  const ss = String(Math.max(totalSec, 0) % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function WatchRemoteScreen({ snap, face }: WatchRemoteScreenProps) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    sendCommand('sync')
    const id = window.setInterval(() => sendCommand('sync'), 2500)
    return () => window.clearInterval(id)
  }, [])

  const flow = snap?.flow ?? 'idle'
  const restLeft = snap?.restEndsAt ? remainingRestSeconds(snap.restEndsAt) : 0
  const resting = flow === 'resting' && Boolean(snap?.restEndsAt) && restLeft > 0
  const canStart = flow === 'ready' || (flow === 'resting' && restLeft <= 0)
  const remainingReps = snap?.remainingReps
  const remainingSets = snap?.remainingSets
  const remaining =
    remainingReps != null && remainingReps > 0
      ? remainingReps === 1
        ? 'Veel 1 kordus'
        : `Veel ${remainingReps} kordust`
      : remainingSets != null && remainingSets > 0
        ? remainingSets === 1
          ? 'Veel 1 seeria'
          : `Veel ${remainingSets} seeriat`
        : snap?.remainingHint || ''

  return (
    <div className={`watch-remote watch-face-${face}`}>
      <div className="watch-bezel">
        {resting ? (
          <>
            <p className="watch-clock">{formatClock(restLeft)}</p>
            {remaining && <p className="watch-remain">{remaining}</p>}
          </>
        ) : (
          <>
            {remaining && flow !== 'idle' && flow !== 'pick' && (
              <p className="watch-remain">{remaining}</p>
            )}
            {canStart && (
              <button
                type="button"
                className="btn btn-tehtud-lg watch-start"
                onClick={() => {
                  if (flow === 'resting') sendCommand('skip-rest')
                  sendCommand('start')
                }}
              >
                Start
              </button>
            )}
            {flow === 'active' && (
              <button type="button" className="btn btn-tehtud-lg" onClick={() => sendCommand('tehtud')}>
                Tehtud
              </button>
            )}
            {flow === 'pick' && <p className="watch-wait">Vali harjutus telefonis</p>}
            {flow === 'sauna' && <p className="watch-wait">Sauna!</p>}
            {(flow === 'idle' || !snap) && <p className="watch-wait">Ootan telefoni…</p>}
          </>
        )}
      </div>
    </div>
  )
}
