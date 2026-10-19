import { applySessionCommand, sessionToSnapshot } from './live/sessionEngine'
import type { LiveSnapshot } from './live/remote'
import type { LiveSession } from './live/sessionEngine'

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '')
const ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
const AUTH_KEY = 'salakivi-kell-auth-v1'

interface KellAuth {
  access_token: string
  refresh_token: string
  user_id: string
  email: string
}

let auth: KellAuth | null = readAuth()
let snap: LiveSnapshot | null = null
let errorText = ''
let busy = false
let tick = 0

function readAuth(): KellAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as KellAuth
    if (parsed && parsed.access_token && parsed.user_id) return parsed
    return null
  } catch {
    return null
  }
}

function saveAuth(next: KellAuth | null): void {
  auth = next
  try {
    if (next) localStorage.setItem(AUTH_KEY, JSON.stringify(next))
    else localStorage.removeItem(AUTH_KEY)
  } catch {
    /* ignore */
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '"') return '&quot;'
    return '&#39;'
  })
}

function restLeft(endsAt?: number): number {
  if (!endsAt) return 0
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
}

function formatClock(totalSec: number): string {
  const mm = String(Math.floor(Math.max(totalSec, 0) / 60)).padStart(2, '0')
  const ss = String(Math.max(totalSec, 0) % 60).padStart(2, '0')
  return mm + ':' + ss
}

function headers(token?: string): Record<string, string> {
  const out: Record<string, string> = {
    apikey: ANON_KEY,
    Authorization: 'Bearer ' + (token || ANON_KEY),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  return out
}

async function api(path: string, init: RequestInit, token?: string): Promise<Response> {
  return fetch(SUPABASE_URL + path, {
    ...init,
    headers: { ...headers(token), ...(init.headers as Record<string, string> | undefined) },
  })
}

async function login(email: string, password: string): Promise<void> {
  const res = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: email, password: password }),
  })
  const data = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    user?: { id?: string; email?: string }
    msg?: string
    error_description?: string
  }
  if (!res.ok || !data.access_token || !data.user?.id) {
    throw new Error(data.error_description || data.msg || 'Sisselogimine ebaõnnestus.')
  }
  saveAuth({
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    user_id: data.user.id,
    email: data.user.email || email,
  })
}

async function refreshIfNeeded(): Promise<boolean> {
  if (!auth?.refresh_token) return false
  const res = await api('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  })
  if (!res.ok) return false
  const data = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    user?: { id?: string; email?: string }
  }
  if (!data.access_token || !auth) return false
  saveAuth({
    access_token: data.access_token,
    refresh_token: data.refresh_token || auth.refresh_token,
    user_id: data.user?.id || auth.user_id,
    email: data.user?.email || auth.email,
  })
  return true
}

function liveFromState(state: unknown): LiveSnapshot | null {
  if (!state || typeof state !== 'object') return null
  const found = (state as { __live?: LiveSnapshot }).__live
  return found && found.v === 1 ? found : null
}

async function pullSnap(): Promise<void> {
  if (!auth) return
  const uid = auth.user_id
  const token = auth.access_token
  let next: LiveSnapshot | null = null

  const liveRes = await api(
    '/rest/v1/live_remote?user_id=eq.' + encodeURIComponent(uid) + '&select=snap',
    { method: 'GET' },
    token,
  )
  if (liveRes.status === 401 && (await refreshIfNeeded())) {
    await pullSnap()
    return
  }
  if (liveRes.ok) {
    const rows = (await liveRes.json()) as { snap?: LiveSnapshot }[]
    if (rows[0]?.snap?.v === 1) next = rows[0].snap
  }

  const stateRes = await api(
    '/rest/v1/user_app_state?user_id=eq.' + encodeURIComponent(uid) + '&select=state',
    { method: 'GET' },
    token,
  )
  if (stateRes.ok) {
    const rows = (await stateRes.json()) as { state?: unknown }[]
    const fromState = liveFromState(rows[0]?.state)
    if (fromState && (!next || (fromState.at || 0) >= (next.at || 0))) next = fromState
  }

  if (next) snap = next
}

async function pushSnap(next: LiveSnapshot): Promise<void> {
  if (!auth) return
  const body = {
    user_id: auth.user_id,
    snap: next,
    updated_at: new Date().toISOString(),
  }
  await api(
    '/rest/v1/live_remote',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    },
    auth.access_token,
  )
}

function pairFromSnap(current: LiveSnapshot): { slot: number; name: string; left: number }[] {
  if (current.pairChoices && current.pairChoices.length >= 2) return current.pairChoices
  if (current.exerciseName && current.otherName) {
    return [
      { slot: 0, name: current.exerciseName, left: current.remainingSets || 0 },
      { slot: 1, name: current.otherName, left: current.remainingSets || 0 },
    ]
  }
  return []
}

async function runCommand(type: 'start' | 'tehtud' | 'skip-rest' | 'select-slot', slot?: number): Promise<void> {
  if (!snap || !snap.session || snap.flow === 'idle' || snap.flow === 'sauna') return
  const nextSession: LiveSession = applySessionCommand(snap.session, type, Date.now(), { slot: slot })
  if (nextSession === snap.session) return
  const published = sessionToSnapshot(nextSession) as LiveSnapshot
  published.epoch = snap.epoch || Date.now()
  published.seq = (snap.seq || 0) + 1
  snap = published
  paint()
  await pushSnap(published)
}

function paint(): void {
  const root = document.getElementById('app')
  if (!root) return
  tick += 1

  if (!SUPABASE_URL || !ANON_KEY) {
    root.innerHTML =
      '<p class="title">Salakivi kell</p><p class="sub">Pilveühendus puudub. Ava link telefoni seadetest.</p>'
    return
  }

  if (!auth) {
    root.innerHTML =
      '<p class="title">Salakivi kell</p>' +
      '<p class="sub">Logi sisse sama kontoga mis telefonis.</p>' +
      (errorText ? '<p class="err">' + esc(errorText) + '</p>' : '') +
      '<input id="kell-email" type="email" placeholder="E-post" autocomplete="username" />' +
      '<input id="kell-pass" type="password" placeholder="Parool" autocomplete="current-password" />' +
      '<button class="start" id="kell-login" type="button">' +
      (busy ? '…' : 'Sisene') +
      '</button>'
    const btn = document.getElementById('kell-login')
    if (btn) btn.onclick = onLoginClick
    return
  }

  const flow = snap ? snap.flow : 'idle'
  const left = snap && snap.restEndsAt ? restLeft(snap.restEndsAt) : 0
  const resting = flow === 'resting' && left > 0
  const canStart = flow === 'ready' || (flow === 'resting' && left <= 0)
  const showTehtud = flow === 'active'
  const pair = snap ? pairFromSnap(snap) : []
  const parts: string[] = []

  if (resting) {
    parts.push('<p class="clock">' + formatClock(left) + '</p>')
  }

  if (snap && flow !== 'idle' && flow !== 'pick') {
    pair.forEach(function (item) {
      const on = item.slot === (snap && snap.activeSlot != null ? snap.activeSlot : 0)
      parts.push(
        '<button type="button" class="pair' +
          (on ? ' on' : '') +
          '" data-slot="' +
          item.slot +
          '"><span>' +
          esc(item.name) +
          '</span><strong>' +
          item.left +
          (item.left === 1 ? ' seeria' : ' seeriat') +
          '</strong></button>',
      )
    })
    if (pair.length < 2 && snap.exerciseName) {
      parts.push(
        '<p class="wait">' +
          esc(snap.exerciseName) +
          (snap.remainingSets != null ? ' · ' + snap.remainingSets + ' seeriat' : '') +
          '</p>',
      )
    }
  }

  if (canStart && !showTehtud && !resting) {
    parts.push('<button class="start" id="kell-start" type="button">Start</button>')
  }
  if (showTehtud) {
    parts.push('<button class="tehtud" id="kell-tehtud" type="button">Tehtud</button>')
  }
  if (flow === 'pick') parts.push('<p class="wait">Vali harjutus telefonis</p>')
  if (flow === 'sauna') parts.push('<p class="title">Sauna!</p><p class="sub">Uus trenn algab telefonist</p>')
  if (!snap || flow === 'idle') {
    parts.push('<p class="title">Salakivi kell</p>')
    parts.push('<p class="sub">Ootan telefoni… alusta trenni telefonis.</p>')
  }

  parts.push('<button class="ghost" id="kell-out" type="button">Logi välja</button>')
  root.innerHTML = parts.join('')

  const startBtn = document.getElementById('kell-start')
  if (startBtn) {
    startBtn.onclick = function () {
      void (async function () {
        if (flow === 'resting') await runCommand('skip-rest')
        await runCommand('start')
      })()
    }
  }
  const tehtudBtn = document.getElementById('kell-tehtud')
  if (tehtudBtn) {
    tehtudBtn.onclick = function () {
      void runCommand('tehtud')
    }
  }
  const outBtn = document.getElementById('kell-out')
  if (outBtn) {
    outBtn.onclick = function () {
      saveAuth(null)
      snap = null
      paint()
    }
  }
  const pairBtns = root.querySelectorAll('[data-slot]')
  for (let i = 0; i < pairBtns.length; i++) {
    const btn = pairBtns[i] as HTMLButtonElement
    btn.onclick = function () {
      const slot = Number(btn.getAttribute('data-slot'))
      if (slot === 0 || slot === 1) void runCommand('select-slot', slot)
    }
  }
}

async function onLoginClick(): Promise<void> {
  const emailEl = document.getElementById('kell-email') as HTMLInputElement | null
  const passEl = document.getElementById('kell-pass') as HTMLInputElement | null
  const email = emailEl ? emailEl.value.trim() : ''
  const password = passEl ? passEl.value : ''
  errorText = ''
  busy = true
  paint()
  try {
    await login(email, password)
    await pullSnap()
  } catch (err) {
    errorText = err instanceof Error ? err.message : 'Sisselogimine ebaõnnestus.'
  }
  busy = false
  paint()
}

async function loop(): Promise<void> {
  if (auth) {
    try {
      await pullSnap()
    } catch {
      /* võrk */
    }
  }
  paint()
}

paint()
void loop()
window.setInterval(function () {
  void loop()
}, 2000)
window.setInterval(function () {
  if (snap && snap.flow === 'resting') paint()
}, 250)
