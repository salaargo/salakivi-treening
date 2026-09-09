import { useEffect, useState } from 'react'

export type WatchFace = 'round' | 'square'

export function isWatchMode(): boolean {
  const kell = new URLSearchParams(window.location.search).get('kell')
  return kell === '1' || kell === 'galaxy' || kell === 'apple'
}

export function watchFace(): WatchFace {
  const kell = new URLSearchParams(window.location.search).get('kell')
  const kuju = new URLSearchParams(window.location.search).get('kuju')
  if (kell === 'apple' || kuju === 'kandiline') return 'square'
  return 'round'
}

export function watchUrl(face: WatchFace = 'round'): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('kuju')
  url.searchParams.set('kell', face === 'square' ? 'apple' : 'galaxy')
  url.hash = ''
  return url.toString()
}

export function isPhoneViewport(): boolean {
  if (typeof window === 'undefined') return true
  if (isWatchMode()) return false
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches
  return window.innerWidth <= 820 || (coarse && window.innerWidth < 1100)
}

export function applyViewportClasses(): void {
  const watch = isWatchMode()
  const phone = isPhoneViewport()
  const landscape = window.matchMedia('(orientation: landscape)').matches
  const root = document.documentElement
  root.classList.toggle('is-watch', watch)
  root.classList.toggle('is-phone', phone)
  root.classList.toggle('is-desktop', !watch && !phone)
  root.classList.toggle('is-landscape', landscape)
}

export function useViewport(): { isWatch: boolean; isPhone: boolean; isDesktop: boolean } {
  const [flags, setFlags] = useState(() => {
    const watch = isWatchMode()
    const phone = isPhoneViewport()
    return { isWatch: watch, isPhone: phone, isDesktop: !watch && !phone }
  })

  useEffect(() => {
    const sync = () => {
      applyViewportClasses()
      const watch = isWatchMode()
      const phone = isPhoneViewport()
      setFlags({ isWatch: watch, isPhone: phone, isDesktop: !watch && !phone })
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [])

  return flags
}

export async function lockPortrait(): Promise<void> {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (type: string) => Promise<void>
  }
  if (!orientation.lock) return
  try {
    await orientation.lock('portrait')
  } catch {
    try {
      await orientation.lock('portrait-primary')
    } catch {
      /* Lukustus töötab tavaliselt ainult paigaldatud PWA / Android Chrome korral. */
    }
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
