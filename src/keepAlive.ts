import { useEffect } from 'react'

/** Vaikne loop, et iOS/Android ei suretaks JS-i treeningu/pausi ajal (ekraani hämardus). */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

export function useWorkoutKeepAlive(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const audio = new Audio(SILENT_WAV)
    audio.loop = true
    audio.volume = 0.01

    const play = () => {
      void audio.play().catch(() => {
        /* Autoplei keelatud — Start/Tehtud žest lubab järgmisel korral. */
      })
    }

    play()
    const onWake = () => {
      if (document.visibilityState === 'visible') play()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)

    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
      audio.pause()
      audio.src = ''
    }
  }, [active])
}
