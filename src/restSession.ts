const REST_KEY = 'salakivi-rest-session-v1'

export interface RestSession {
  dateKey: string
  endsAt: number
  durationSeconds: number
  hint: string
  next: string
  pending: 'ready' | 'pick'
  selected: number[]
  activeSlot: number
}

export function saveRestSession(session: RestSession): void {
  try {
    localStorage.setItem(REST_KEY, JSON.stringify(session))
  } catch {
    /* ignore quota */
  }
}

export function clearRestSession(): void {
  try {
    localStorage.removeItem(REST_KEY)
  } catch {
    /* ignore */
  }
}

export function loadRestSession(dateKey: string): RestSession | null {
  try {
    const raw = localStorage.getItem(REST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RestSession
    if (parsed?.dateKey !== dateKey || typeof parsed.endsAt !== 'number') {
      clearRestSession()
      return null
    }
    return parsed
  } catch {
    return null
  }
}
