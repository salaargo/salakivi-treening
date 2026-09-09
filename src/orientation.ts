import { useEffect } from 'react'

export function isWatchMode(): boolean {
  return new URLSearchParams(window.location.search).get('kell') === '1'
}

export function watchUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.set('kell', '1')
  url.hash = ''
  return url.toString()
}

export async function lockPortrait(): Promise<void> {
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (type: 'portrait' | 'portrait-primary') => Promise<void>
    }
    await orientation.lock?.('portrait')
  } catch {
    /* Lukustus töötab tavaliselt ainult paigaldatud PWA / Android Chrome korral. */
  }
}

/** Hoia ekraan sees treeningu ajal (automaatlukk). Toitenupp vabastab lukustuse. */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let lock: WakeLockSentinel | null = null
    let stopped = false

    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        /* Brauser keelas (aku, aken pole esiplaanil). */
      }
    }

    void acquire()
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVis)
      void lock?.release()
    }
  }, [active])
}
