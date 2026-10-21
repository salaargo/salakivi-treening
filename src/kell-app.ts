import { applySessionCommand, sessionToSnapshot } from './live/sessionEngine'
import type { LiveSnapshot } from './live/remote'
import type { LiveSession } from './live/sessionEngine'

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '')
const ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
const AUTH_KEY = 'salakivi-kell-auth-v1'
const PAIR_KEY = 'salakivi-kell-pair-v1'

interface KellAuth {
  access_token: string
  refresh_token: string
  user_id: string
  email: string
}

function searchParams(): URLSearchParams {
  const params = new URLSearchParams(location.search)
  if (location.hash.length > 1) {
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, ''))
    fromHash.forEach((value, key) => {
      if (!params.get(key)) params.set(key, value)
    })
  }
  return params
}

function persistPair(code: string): void {
  try {
    localStorage.setItem(PAIR_KEY, code)
  } catch {
    /* ignore */
  }
  try {
    history.replaceState(null, '', location.pathname + '?kell=apple&p=' + encodeURIComponent(code))
  } catch {
    /* ignore */
  }
}

function pairFromUrl(): string {
  const params = searchParams()
  const fromQuery = params.get('p') || ''
  if (fromQuery.length >= 6) {
    persistPair(fromQuery)
    return fromQuery
  }
  try {
    const stored = localStorage.getItem(PAIR_KEY) || ''
    if (stored.length >= 6) return stored
  } catch {
    /* ignore */
  }
  return ''
}

function authFromUrl(): KellAuth | null {
  const params = searchParams()
  const access = params.get('a')
  const userId = params.get('u')
  const refresh = params.get('r') || ''
  if (!access || !userId) return null
  const next: KellAuth = {
    access_token: access,
    refresh_token: refresh,
    user_id: userId,
    email: '',
  }
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

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

let pairCode = pairFromUrl()
let auth: KellAuth | null = authFromUrl() ?? readAuth()
let useRpc = false
let rpcMissing = false
let snap: LiveSnapshot | null = null
let errorText = ''
let tick = 0
let ws: WebSocket | null = null
let wsRef = 1
let hbTimer = 0
const waitedFrom = Date.now()

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
  return {
    apikey: ANON_KEY,
    Authorization: 'Bearer ' + (token || ANON_KEY),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

async function api(path: string, init: RequestInit, token?: string): Promise<Response> {
  return fetch(SUPABASE_URL + path, {
    ...init,
    headers: { ...headers(token), ...(init.headers as Record<string, string> | undefined) },
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

function takeAuthFromUnknown(value: unknown): void {
  if (!value || typeof value !== 'object') return
  const rec = value as {
    a?: string
    u?: string
    r?: string
    payload?: unknown
    snap?: LiveSnapshot
  }
  if (rec.a && rec.u) {
    saveAuth({
      access_token: rec.a,
      refresh_token: rec.r || '',
      user_id: rec.u,
      email: '',
    })
  }
  const maybeSnap = rec.snap as LiveSnapshot | undefined
  if (maybeSnap && maybeSnap.v === 1) snap = maybeSnap
  if (rec.payload) takeAuthFromUnknown(rec.payload)
}

function connectPairSocket(): void {
  if (!pairCode || !SUPABASE_URL || !ANON_KEY || auth || useRpc) return
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
  const host = SUPABASE_URL.replace(/^https:/, 'wss:')
  const url = host + '/realtime/v1/websocket?apikey=' + encodeURIComponent(ANON_KEY) + '&vsn=1.0.0'
  try {
    ws = new WebSocket(url)
  } catch {
    return
  }
  ws.onopen = function () {
    if (!ws || !pairCode) return
    ws.send(
      JSON.stringify({
        topic: 'realtime:skw-' + pairCode,
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { ack: false, self: true },
            presence: { key: '', enabled: false },
            postgres_changes: [],
            private: false,
          },
          access_token: ANON_KEY,
        },
        ref: String(++wsRef),
        join_ref: '1',
      }),
    )
    if (hbTimer) window.clearInterval(hbTimer)
    hbTimer = window.setInterval(function () {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++wsRef) }))
    }, 25000)
  }
  ws.onmessage = function (ev) {
    try {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      const msg = JSON.parse(raw) as {
        event?: string
        payload?: { event?: string; payload?: unknown }
      }
      const payload = msg.payload
      if (msg.event === 'broadcast' && payload) {
        if (payload.event === 'auth') takeAuthFromUnknown(payload.payload)
        else takeAuthFromUnknown(payload)
        if (auth) {
          errorText = ''
          void pullSnap().then(paint)
        }
      }
    } catch {
      /* ignore */
    }
  }
  ws.onclose = function () {
    ws = null
    if (hbTimer) window.clearInterval(hbTimer)
    window.setTimeout(connectPairSocket, 2500)
  }
  ws.onerror = function () {
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
  }
}

async function pullViaRpc(): Promise<boolean> {
  if (!pairCode) return false
  const res = await api('/rest/v1/rpc/watch_pull', {
    method: 'POST',
    body: JSON.stringify({ pair: pairCode }),
  })
  if (res.status === 404) {
    rpcMissing = true
    return false
  }
  if (!res.ok) return false
  rpcMissing = false
  const data = (await res.json()) as { ok?: boolean; snap?: LiveSnapshot } | LiveSnapshot | null
  if (!data) return true
  if ('ok' in data) {
    if (data.ok === false) {
      errorText = 'See Apple link ei kehti. Kopeeri telefonis Seadetest uus lühike link.'
      return true
    }
    useRpc = true
    errorText = ''
    if (data.snap && data.snap.v === 1) snap = data.snap
    return true
  }
  if ((data as LiveSnapshot).v === 1) {
    useRpc = true
    errorText = ''
    snap = data as LiveSnapshot
  }
  return true
}

async function pullSnap(): Promise<void> {
  if (pairCode && !useRpc) {
    const ok = await pullViaRpc()
    if (ok && useRpc) return
    if (ok && errorText) return
  }
  if (useRpc && pairCode) {
    await pullViaRpc()
    return
  }
  if (!auth) {
    connectPairSocket()
    return
  }
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
  if (useRpc && pairCode) {
    await api('/rest/v1/rpc/watch_push', {
      method: 'POST',
      body: JSON.stringify({ pair: pairCode, next }),
    })
    return
  }
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

function linked(): boolean {
  return Boolean(pairCode || auth || useRpc)
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

  if (!linked()) {
    root.innerHTML =
      '<p class="title">Salakivi kell</p>' +
      '<p class="sub">Ava telefonis treeningäpp → Seaded → Kopeeri Apple link ja saada see sõnumiga kellale.</p>' +
      '<p class="sub">Link peab olema lühike (lõpus ?p=…). Pikka linki kell ei suuda avada.</p>' +
      (errorText ? '<p class="err">' + esc(errorText) + '</p>' : '')
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
    if (rpcMissing && !auth) {
      parts.push(
        '<p class="sub">Kell ei saa treeningut kätte. See ei ole aeglane — telefonis Seaded → Kopeeri Apple Watchi SQL → supabase.com SQL Editor → Run. Siis uus Apple link.</p>',
      )
    } else if (Date.now() - waitedFrom > 8000 && !auth && !useRpc) {
      parts.push(
        '<p class="sub">Ühendus ei tule. Hoia treeningäpp telefonis lahti, alusta trenn, või käivita telefonis Apple Watchi SQL.</p>',
      )
    } else {
      parts.push('<p class="sub">Ootan telefoni… alusta trenni telefonis.</p>')
    }
  }
  if (errorText) parts.push('<p class="err">' + esc(errorText) + '</p>')

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
  const pairBtns = root.querySelectorAll('[data-slot]')
  for (let i = 0; i < pairBtns.length; i++) {
    const btn = pairBtns[i] as HTMLButtonElement
    btn.onclick = function () {
      const slot = Number(btn.getAttribute('data-slot'))
      if (slot === 0 || slot === 1) void runCommand('select-slot', slot)
    }
  }
}

async function loop(): Promise<void> {
  if (linked()) {
    try {
      await pullSnap()
    } catch {
      /* võrk */
    }
    if (!auth && !useRpc) connectPairSocket()
  }
  paint()
}

paint()
void loop()
window.setInterval(function () {
  void loop()
}, 800)
window.setInterval(function () {
  if (snap && snap.flow === 'resting') paint()
}, 250)
