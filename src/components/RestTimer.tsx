import { useEffect, useRef, useState } from 'react'

interface RestTimerProps {
  /** Pausi lõpp (Date.now() + kestus). Jääb käima ka siis, kui ekraan kustub. */
  endsAt: number
  /** Algne + lisatud sekundid, rõnga jaoks. */
  durationSeconds: number
  onComplete: () => void
  onSkip?: () => void
  onExtend?: (seconds: number) => void
  remainingHint?: string
  nextHint?: string
}

function vibrate() {
  try {
    navigator.vibrate?.([300, 120, 300, 120, 500])
  } catch {
    /* ignore */
  }
}

export function remainingRestSeconds(endsAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

export function RestTimer({
  endsAt,
  durationSeconds,
  onComplete,
  onSkip,
  onExtend,
  remainingHint,
  nextHint,
}: RestTimerProps) {
  const finishedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const [left, setLeft] = useState(() => remainingRestSeconds(endsAt))

  useEffect(() => {
    finishedRef.current = false

    const tick = () => {
      const next = remainingRestSeconds(endsAt)
      setLeft(next)
      if (next <= 0 && !finishedRef.current) {
        finishedRef.current = true
        vibrate()
        onCompleteRef.current()
      }
    }

    tick()
    const id = window.setInterval(tick, 250)
    const onWake = () => tick()
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    document.addEventListener('resume', onWake)
    window.addEventListener('online', onWake)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
      document.removeEventListener('resume', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [endsAt])

  const total = Math.max(1, durationSeconds)
  const progress = Math.min(1, left / total)
  const mm = String(Math.floor(Math.max(left, 0) / 60)).padStart(2, '0')
  const ss = String(Math.max(left, 0) % 60).padStart(2, '0')

  return (
    <div className="timer-overlay rest-fullscreen" role="dialog" aria-label="Pausiloendur">
      <div className="timer-card rest-card">
        <p className="timer-label">Paus</p>
        <div
          className="timer-ring timer-ring-lg"
          style={{
            background: `conic-gradient(var(--accent) ${progress * 360}deg, var(--surface-2) 0deg)`,
          }}
        >
          <div className="timer-ring-inner timer-ring-inner-lg">
            <span className="timer-digits timer-digits-lg">
              {mm}:{ss}
            </span>
          </div>
        </div>
        {remainingHint && <p className="timer-remaining">{remainingHint}</p>}
        {nextHint && <p className="muted small timer-next">{nextHint}</p>}
        <div className="timer-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onExtend?.(15)}
          >
            +15s
          </button>
          {onSkip && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (finishedRef.current) return
                finishedRef.current = true
                vibrate()
                onSkip()
              }}
            >
              Jäta vahele
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
