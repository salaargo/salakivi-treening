export type WatchKind = 'galaxy' | 'apple'

const KEY = 'salakivi-watch-kind-v1'

export function loadWatchKind(): WatchKind | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === 'galaxy' || raw === 'apple') return raw
  } catch {
    /* ignore */
  }
  return null
}

export function saveWatchKind(kind: WatchKind): void {
  try {
    localStorage.setItem(KEY, kind)
  } catch {
    /* ignore */
  }
}
