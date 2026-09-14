import { useEffect, useMemo, useRef, useState } from 'react'
import type { LiveSnapshot } from '../live/remote'
import { dispatchWatchCommand, sendCommand } from '../live/remote'
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

function remainingFromSnap(snap: LiveSnapshot): { name: string; left: number }[] {
  const fromParts = snap.remainingParts?.filter((part) => part.left > 0) ?? []
  if (fromParts.length) return fromParts

  const hint = snap.remainingHint ?? ''
  if (hint && !/kordus/i.test(hint)) {
    const named = [...hint.matchAll(/(.+?)\s*·\s*(\d+)\s*seer/gi)].map((match) => ({
      name: match[1].replace(/^Veel seeriaid:\s*/i, '').trim(),
      left: Number(match[2]),
    }))
    if (named.length) return named
    const one = hint.match(/Veel (\d+) seeria/i)
    if (one && snap.exerciseName) return [{ name: snap.exerciseName, left: Number(one[1]) }]
  }

  if (snap.exerciseName && snap.remainingSets != null && snap.remainingSets > 0) {
    const rows = [{ name: snap.exerciseName, left: snap.remainingSets }]
    if (snap.otherName) rows.push({ name: snap.otherName, left: snap.remainingSets })
    return rows
  }
  return []
}

function WatchRemaining({ snap }: { snap: LiveSnapshot }) {
  const parts = remainingFromSnap(snap)
  if (!parts.length) return null
  return (
    <div className="watch-remain-list">
      {parts.map((part) => (
        <p key={part.name} className="watch-remain-row">
          <span className="watch-remain-name">{part.name}</span>
          <strong>
            {part.left} {part.left === 1 ? 'seeria' : 'seeriat'}
          </strong>
        </p>
      ))}
    </div>
  )
}

function vibrateWatch() {
  try {
    navigator.vibrate?.([280, 120, 280, 120, 450])
  } catch {
    /* kell ei toeta */
  }
}

export function WatchRemoteScreen({ snap, face }: WatchRemoteScreenProps) {
  const [, setTick] = useState(0)
  const [held, setHeld] = useState<'active' | null>(null)
  const buzzedRest = useRef<number | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    sendCommand('sync')
    const id = window.setInterval(() => sendCommand('sync'), 4000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!snap || held !== 'active') return
    if (snap.flow === 'active' || snap.flow === 'resting' || snap.flow === 'pick' || snap.flow === 'sauna') {
      setHeld(null)
    }
  }, [snap, held])

  useEffect(() => {
    if (held !== 'active') return
    const id = window.setTimeout(() => setHeld(null), 4000)
    return () => window.clearTimeout(id)
  }, [held])

  const restLeft = snap?.restEndsAt ? remainingRestSeconds(snap.restEndsAt) : 0

  useEffect(() => {
    const ends = snap?.restEndsAt
    if (snap?.flow !== 'resting' || !ends) return
    if (restLeft > 0) return
    if (buzzedRest.current === ends) return
    buzzedRest.current = ends
    vibrateWatch()
  }, [restLeft, snap?.flow, snap?.restEndsAt])

  const flow = useMemo(() => {
    if (held === 'active') return 'active'
    return snap?.flow ?? 'idle'
  }, [held, snap?.flow])

  const resting = flow === 'resting' && Boolean(snap?.restEndsAt) && restLeft > 0
  const canStart = flow === 'ready' || (flow === 'resting' && restLeft <= 0)
  const showTehtud = flow === 'active'
  const showRemaining = Boolean(snap) && flow !== 'idle' && flow !== 'pick'

  return (
    <div className={`watch-remote watch-face-${face}`}>
      <div className="watch-bezel">
        {resting ? (
          <>
            <p className="watch-clock">{formatClock(restLeft)}</p>
            {snap && <WatchRemaining snap={snap} />}
          </>
        ) : (
          <>
            {showRemaining && snap && <WatchRemaining snap={snap} />}
            {canStart && !showTehtud && (
              <button
                type="button"
                className="btn btn-tehtud-lg watch-start"
                onClick={() => {
                  setHeld('active')
                  if (flow === 'resting') dispatchWatchCommand('skip-rest')
                  dispatchWatchCommand('start')
                }}
              >
                Start
              </button>
            )}
            {showTehtud && (
              <button
                type="button"
                className="btn btn-tehtud-lg"
                onClick={() => {
                  setHeld(null)
                  dispatchWatchCommand('tehtud')
                }}
              >
                Tehtud
              </button>
            )}
            {flow === 'pick' && <p className="watch-wait">Vali harjutus telefonis</p>}
            {flow === 'sauna' && (
              <p className="watch-wait">
                Sauna!
                <span className="watch-wait-sub">Uus trenn algab telefonist</span>
              </p>
            )}
            {(flow === 'idle' || !snap) && <p className="watch-wait">Ootan telefoni…</p>}
          </>
        )}
      </div>
    </div>
  )
}
