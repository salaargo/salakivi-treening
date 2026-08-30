import { useEffect, useRef, useState } from 'react'

interface RestTimerProps {
  seconds: number
  onComplete: () => void
  onSkip?: () => void
}

function vibrate() {
  try {
    navigator.vibrate?.([300, 120, 300, 120, 500])
  } catch {
    /* ignore */
  }
}

export function RestTimer({ seconds, onComplete, onSkip }: RestTimerProps) {
  const [left, setLeft] = useState(seconds)
  const finishedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    setLeft(seconds)
    finishedRef.current = false
  }, [seconds])

  useEffect(() => {
    if (left > 0) {
      const t = window.setTimeout(() => setLeft((v) => v - 1), 1000)
      return () => window.clearTimeout(t)
    }
    if (!finishedRef.current) {
      finishedRef.current = true
      vibrate()
      onCompleteRef.current()
    }
  }, [left])

  const progress = seconds > 0 ? left / seconds : 0
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
        <div className="timer-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setLeft((v) => v + 15)}>
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
