import { useEffect, useMemo, useRef, useState } from 'react'
import type { LiveSnapshot } from '../live/remote'
import { dispatchWatchCommand, sendCommand } from '../live/remote'
import { remainingRestSeconds } from '../components/RestTimer'
import type { WatchFace } from '../orientation'
import { getSupabase } from '../lib/supabase'

interface WatchRemoteScreenProps {
  snap: LiveSnapshot | null
  face: WatchFace
  needsLogin?: boolean
  onLogin?: () => void
}

function formatClock(totalSec: number): string {
  const mm = String(Math.floor(Math.max(totalSec, 0) / 60)).padStart(2, '0')
  const ss = String(Math.max(totalSec, 0) % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function weightFromSession(snap: LiveSnapshot, slot: number): number | undefined {
  const session = snap.session
  const index = session?.selected[slot]
  if (index == null || !session) return undefined
  const ex = session.exercises[index]
  if (!ex) return undefined
  const next = session.log.exercises
    .find((entry) => entry.exerciseId === ex.id)
    ?.sets.find((set) => !set.completed)
  return typeof next?.weightKg === 'number' && next.weightKg > 0 ? next.weightKg : undefined
}

function pairFromSnap(snap: LiveSnapshot): { slot: number; name: string; left: number; weightKg?: number }[] {
  let pair: { slot: number; name: string; left: number; weightKg?: number }[] = []
  if (snap.pairChoices && snap.pairChoices.length >= 2) pair = snap.pairChoices
  else {
    const fromParts = snap.remainingParts?.filter((part) => part.left >= 0) ?? []
    if (fromParts.length >= 2) {
      pair = fromParts.slice(0, 2).map((part, slot) => ({ slot, name: part.name, left: part.left }))
    } else if (snap.exerciseName && snap.otherName) {
      pair = [
        { slot: 0, name: snap.exerciseName, left: snap.remainingSets ?? 0, weightKg: snap.weightKg },
        { slot: 1, name: snap.otherName, left: snap.remainingSets ?? 0 },
      ]
    }
  }
  return pair.map((part) => ({
    ...part,
    weightKg: part.weightKg && part.weightKg > 0 ? part.weightKg : weightFromSession(snap, part.slot),
  }))
}

function remainingFromSnap(snap: LiveSnapshot): { name: string; left: number }[] {
  const pair = pairFromSnap(snap)
  if (pair.length >= 2) return pair.map((p) => ({ name: p.name, left: p.left }))

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
    return [{ name: snap.exerciseName, left: snap.remainingSets }]
  }
  return []
}

function WatchPairPicker({
  snap,
  canSelect,
}: {
  snap: LiveSnapshot
  canSelect: boolean
}) {
  const pair = pairFromSnap(snap)
  if (pair.length < 2) return null
  const current = snap.activeSlot ?? 0
  return (
    <div className="watch-pair-list">
      {pair.map((part) => {
        const isNext = part.slot === current
        return (
          <button
            key={`${part.slot}-${part.name}`}
            type="button"
            className={`watch-pair-btn ${isNext ? 'is-next' : ''}`}
            disabled={!canSelect}
            onClick={() => {
              if (!canSelect || isNext) return
              dispatchWatchCommand('select-slot', { slot: part.slot })
            }}
          >
            <span className="watch-remain-name">{part.name}</span>
            <span className="watch-pair-meta">
              {part.weightKg != null && part.weightKg > 0 ? (
                <b className="watch-pair-kg">{part.weightKg} kg</b>
              ) : (
                <span />
              )}
              <strong>
                {part.left} {part.left === 1 ? 'seeria' : 'seeriat'}
              </strong>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function WatchRemaining({ snap }: { snap: LiveSnapshot }) {
  if (pairFromSnap(snap).length >= 2) return null
  const parts = remainingFromSnap(snap)
  if (!parts.length) return null
  return (
    <div className="watch-remain-list">
      {parts.map((part) => (
        <p key={part.name} className="watch-remain-row">
          <span className="watch-remain-name">{part.name}</span>
          <span className="watch-pair-meta">
            {snap.weightKg != null && snap.weightKg > 0 ? (
              <b className="watch-pair-kg">{snap.weightKg} kg</b>
            ) : (
              <span />
            )}
            <strong>
              {part.left} {part.left === 1 ? 'seeria' : 'seeriat'}
            </strong>
          </span>
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

export function WatchRemoteScreen({ snap, face, needsLogin = false, onLogin }: WatchRemoteScreenProps) {
  const [, setTick] = useState(0)
  const [held, setHeld] = useState<'active' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const buzzedRest = useRef<number | null>(null)

  async function handleWatchLogin(event: React.FormEvent) {
    event.preventDefault()
    setLoginError(null)
    setLoginBusy(true)
    try {
      const supabase = getSupabase()
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
      onLogin?.()
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Sisselogimine ebaõnnestus.')
    } finally {
      setLoginBusy(false)
    }
  }

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
  const canPickPair = Boolean(snap) && (flow === 'ready' || flow === 'resting')

  if (needsLogin) {
    return (
      <div className={`watch-remote watch-face-${face}`}>
        <div className="watch-bezel">
          <p className="watch-wait">Salakivi kell</p>
          <p className="watch-wait-sub">Logi sisse sama kontoga</p>
          <form className="watch-login" onSubmit={(event) => void handleWatchLogin(event)}>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="E-post"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Parool"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {loginError && <p className="watch-wait-sub">{loginError}</p>}
            <button type="submit" className="btn btn-tehtud-lg watch-start" disabled={loginBusy}>
              {loginBusy ? '…' : 'Sisene'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className={`watch-remote watch-face-${face}`}>
      <div className="watch-bezel">
        {resting ? (
          <>
            <p className="watch-clock">{formatClock(restLeft)}</p>
            {snap && <WatchPairPicker snap={snap} canSelect={canPickPair} />}
            {snap && <WatchRemaining snap={snap} />}
          </>
        ) : (
          <>
            {showRemaining && snap && <WatchPairPicker snap={snap} canSelect={canPickPair} />}
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
              <p className="btn btn-tehtud-lg watch-start watch-sauna" aria-live="polite">
                Sauna
              </p>
            )}
            {(flow === 'idle' || !snap) && <p className="watch-wait">Ootan telefoni…</p>}
          </>
        )}
      </div>
    </div>
  )
}
