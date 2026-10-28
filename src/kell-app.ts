import { applySessionCommand, sessionToSnapshot, snapshotShouldReplace } from './live/sessionEngine'
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

let pinDraft = ''
let pairCode = pairFromUrl()
let auth: KellAuth | null = authFromUrl() ?? readAuth()
let useRpc = false
let snap: LiveSnapshot | null = null
let errorText = ''
let ws: WebSocket | null = null
let wsRef = 1
let pairHbTimer = 0
let liveHbTimer = 0
let lastTapAt = 0
let appBound = false
let pairWaitFrom = pairCode && !auth ? Date.now() : 0
let localHoldUntil = 0
let lastPaintKey = ''
let liveWs: WebSocket | null = null
let liveJoined = false
let pendingLive: { kind: 'cmd' | 'snap'; cmd?: unknown; snap?: LiveSnapshot }[] = []

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
    connectLiveSocket()
  }
  const maybeSnap = rec.snap as LiveSnapshot | undefined
  if (maybeSnap && maybeSnap.v === 1) adoptSnap(maybeSnap)
  if (rec.payload) takeAuthFromUnknown(rec.payload)
}

function isLiveFlow(flow?: string): boolean {
  return flow === 'pick' || flow === 'ready' || flow === 'active' || flow === 'resting'
}

function adoptSnap(incoming: LiveSnapshot | null | undefined): boolean {
  if (!incoming || incoming.v !== 1) return false
  if (isLiveFlow(incoming.flow) && (!snap || snap.flow === 'idle' || snap.flow === 'sauna')) {
    snap = incoming
    lastPaintKey = ''
    errorText = ''
    return true
  }
  if (incoming.flow === 'idle' && snap && isLiveFlow(snap.flow) && incoming.dateKey === snap.dateKey) {
    return false
  }
  if (Date.now() < localHoldUntil && snap) {
    const sameWork =
      (incoming.session?.rev ?? 0) === (snap.session?.rev ?? 0) &&
      incoming.flow !== 'sauna' &&
      snap.flow !== 'idle'
    if (sameWork && !snapshotShouldReplace(incoming, snap)) return false
    if (sameWork && (incoming.session?.rev ?? 0) <= (snap.session?.rev ?? 0)) return false
  }
  if (snap && !snapshotShouldReplace(incoming, snap)) return false
  snap = incoming
  lastPaintKey = ''
  return true
}

function connectPairSocket(): void {
  if (!pairCode || !SUPABASE_URL || !ANON_KEY) return
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
    if (pairHbTimer) window.clearInterval(pairHbTimer)
    pairHbTimer = window.setInterval(function () {
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
    if (pairHbTimer) window.clearInterval(pairHbTimer)
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

function liveTopic(): string {
  return auth ? 'realtime:salakivi-live-' + auth.user_id : ''
}

function flushLive(): void {
  if (!liveWs || liveWs.readyState !== WebSocket.OPEN || !auth || !liveJoined) return
  while (pendingLive.length) {
    const env = pendingLive.shift()
    if (!env) break
    liveWs.send(
      JSON.stringify({
        topic: liveTopic(),
        event: 'broadcast',
        payload: {
          type: 'broadcast',
          event: 'live',
          payload: env,
        },
        ref: String(++wsRef),
      }),
    )
  }
}

function sendLive(env: { kind: 'cmd' | 'snap'; cmd?: unknown; snap?: LiveSnapshot }): void {
  pendingLive.push(env)
  if (pendingLive.length > 8) pendingLive.shift()
  connectLiveSocket()
  flushLive()
}

function connectLiveSocket(): void {
  if (!auth || !SUPABASE_URL || !ANON_KEY) return
  if (liveWs && (liveWs.readyState === WebSocket.CONNECTING || liveWs.readyState === WebSocket.OPEN)) return
  const host = SUPABASE_URL.replace(/^https:/, 'wss:')
  const url = host + '/realtime/v1/websocket?apikey=' + encodeURIComponent(ANON_KEY) + '&vsn=1.0.0'
  try {
    liveWs = new WebSocket(url)
  } catch {
    return
  }
  liveJoined = false
  liveWs.onopen = function () {
    if (!liveWs || !auth) return
    liveWs.send(
      JSON.stringify({
        topic: liveTopic(),
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: auth.user_id, enabled: true },
            postgres_changes: [],
            private: false,
          },
          access_token: auth.access_token,
        },
        ref: String(++wsRef),
        join_ref: 'live',
      }),
    )
    if (liveHbTimer) window.clearInterval(liveHbTimer)
    liveHbTimer = window.setInterval(function () {
      if (!liveWs || liveWs.readyState !== WebSocket.OPEN) return
      liveWs.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++wsRef) }))
    }, 25000)
    window.setTimeout(function () {
      liveJoined = true
      flushLive()
    }, 500)
  }
  liveWs.onmessage = function (ev) {
    try {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      const msg = JSON.parse(raw) as {
        event?: string
        payload?: { event?: string; status?: string; payload?: { kind?: string; snap?: LiveSnapshot } }
      }
      const payload = msg.payload
      if (msg.event === 'phx_reply' && payload && payload.status !== 'error') {
        liveJoined = true
        flushLive()
      }
      if (msg.event === 'broadcast' && payload && payload.event === 'live') {
        const env = payload.payload
        if (env && env.kind === 'snap' && env.snap && adoptSnap(env.snap)) paint()
      }
    } catch {
      /* ignore */
    }
  }
  liveWs.onclose = function () {
    liveWs = null
    liveJoined = false
    if (liveHbTimer) window.clearInterval(liveHbTimer)
    window.setTimeout(connectLiveSocket, 2500)
  }
  liveWs.onerror = function () {
    try {
      liveWs?.close()
    } catch {
      /* ignore */
    }
  }
}

let relayEs: EventSource | null = null

function connectRelay(): void {
  if (!pairCode) return
  if (relayEs && relayEs.readyState !== EventSource.CLOSED) return
  try {
    relayEs = new EventSource('https://ntfy.sh/skw-' + pairCode + '/sse?since=all')
  } catch {
    return
  }
  relayEs.addEventListener('message', function (ev) {
    try {
      const data = JSON.parse(String((ev as MessageEvent).data)) as { message?: string }
      if (!data.message) return
      takeAuthFromUnknown(JSON.parse(data.message))
      errorText = ''
      paint()
    } catch {
      /* ignore */
    }
  })
}

function ingestNtfyBody(text: string): void {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const ev = JSON.parse(line) as { message?: string }
      if (!ev.message) continue
      takeAuthFromUnknown(JSON.parse(ev.message))
      if (auth) errorText = ''
    } catch {
      /* ignore */
    }
  }
}

async function pullViaRelayFetch(): Promise<void> {
  if (!pairCode) return
  try {
    const polled = await fetch('https://ntfy.sh/skw-' + pairCode + '/json?poll=1&since=all')
    if (polled.ok) ingestNtfyBody(await polled.text())
    if (auth) return
  } catch {
    /* WatchOS poll */
  }
  const ac = new AbortController()
  const timer = window.setTimeout(function () {
    ac.abort()
  }, 2800)
  try {
    const res = await fetch('https://ntfy.sh/skw-' + pairCode + '/json?since=all', { signal: ac.signal })
    if (!res.ok || !res.body) return
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const chunk = await reader.read()
      buf += dec.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      ingestNtfyBody(lines.join('\n'))
      if (auth) {
        try {
          reader.cancel()
        } catch {
          /* ignore */
        }
        return
      }
      if (chunk.done) break
    }
  } catch {
    /* WatchOS fetch */
  } finally {
    window.clearTimeout(timer)
  }
}

async function pullViaRpc(): Promise<boolean> {
  if (!pairCode) return false
  const res = await api('/rest/v1/rpc/watch_pull', {
    method: 'POST',
    body: JSON.stringify({ pair: pairCode }),
  })
  if (res.status === 404) return false
  if (!res.ok) return false
  const data = (await res.json()) as { ok?: boolean; snap?: LiveSnapshot } | LiveSnapshot | null
  if (!data) return true
  if ('ok' in data) {
    if (data.ok === false) {
      return false
    }
    useRpc = true
    errorText = ''
    if (data.snap && data.snap.v === 1) adoptSnap(data.snap)
    return true
  }
  if ((data as LiveSnapshot).v === 1) {
    useRpc = true
    errorText = ''
    adoptSnap(data as LiveSnapshot)
  }
  return true
}

async function pullSnap(): Promise<void> {
  if (pairCode) {
    connectRelay()
    connectPairSocket()
    await pullViaRelayFetch()
  }
  if (pairCode && !useRpc) {
    const ok = await pullViaRpc()
    if (ok && useRpc) return
  }
  if (useRpc && pairCode) {
    await pullViaRpc()
    return
  }
  if (!auth) {
    connectPairSocket()
    return
  }
  connectLiveSocket()
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
    if (fromState) {
      if (!next) next = fromState
      else if (isLiveFlow(fromState.flow) && !isLiveFlow(next.flow)) next = fromState
      else if (!(isLiveFlow(next.flow) && !isLiveFlow(fromState.flow)) && snapshotShouldReplace(fromState, next)) {
        next = fromState
      }
    }
  }

  if (next) adoptSnap(next)
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

function weightFromSession(current: LiveSnapshot, slot: number): number | undefined {
  const session = current.session
  const index = session && session.selected ? session.selected[slot] : undefined
  if (index == null || !session) return undefined
  const ex = session.exercises[index]
  if (!ex) return undefined
  const entry = session.log.exercises.find(function (row) {
    return row.exerciseId === ex.id
  })
  const next = entry && entry.sets.find(function (set) {
    return !set.completed
  })
  return next && next.weightKg > 0 ? next.weightKg : undefined
}

function pairFromSnap(
  current: LiveSnapshot,
): { slot: number; name: string; left: number; weightKg?: number }[] {
  let pair: { slot: number; name: string; left: number; weightKg?: number }[] = []
  if (current.pairChoices && current.pairChoices.length >= 2) pair = current.pairChoices
  else if (current.exerciseName && current.otherName) {
    pair = [
      { slot: 0, name: current.exerciseName, left: current.remainingSets || 0, weightKg: current.weightKg },
      { slot: 1, name: current.otherName, left: current.remainingSets || 0 },
    ]
  }
  return pair.map(function (part) {
    const kg = part.weightKg && part.weightKg > 0 ? part.weightKg : weightFromSession(current, part.slot)
    return { slot: part.slot, name: part.name, left: part.left, weightKg: kg }
  })
}

function acceptPin(code: string): void {
  if (!/^\d{6}$/.test(code)) return
  pairCode = code
  persistPair(code)
  pinDraft = code
  pairWaitFrom = Date.now()
  errorText = ''
  updatePinFace()
  const sub = document.getElementById('kell-sub')
  if (sub) sub.textContent = 'Ühendame telefoniga…'
  connectRelay()
  void pullViaRelayFetch()
  void loop()
}

function takeTap(ev: Event): boolean {
  ev.preventDefault()
  ev.stopPropagation()
  const now = Date.now()
  if (now - lastTapAt < 280) return false
  lastTapAt = now
  return true
}

function onAppPointer(ev: Event): void {
  const target = ev.target as HTMLElement | null
  if (!target || !target.closest) return
  const keyEl = target.closest('[data-key]') as HTMLElement | null
  if (keyEl && !auth && !useRpc) {
    if (!takeTap(ev)) return
    const key = keyEl.getAttribute('data-key') || ''
    if (key === 'C') {
      pinDraft = pinDraft.slice(0, -1)
      if (pinDraft.length < 6) {
        pairCode = ''
        pairWaitFrom = 0
        errorText = ''
        const sub = document.getElementById('kell-sub')
        if (sub) sub.textContent = 'Toksa telefonis nähtav 6-kohaline kood.'
      }
    } else if (pinDraft.length < 6 && /^\d$/.test(key)) pinDraft += key
    updatePinFace()
    if (pinDraft.length === 6) acceptPin(pinDraft)
    return
  }
  const startEl = target.closest('#kell-start') as HTMLElement | null
  if (startEl) {
    if (!takeTap(ev)) return
    startEl.textContent = '…'
    void (async function () {
      const flow = snap ? snap.flow : 'idle'
      if (flow === 'resting') await runCommand('skip-rest')
      await runCommand('start')
    })()
    return
  }
  const tehtudEl = target.closest('#kell-tehtud') as HTMLElement | null
  if (tehtudEl) {
    if (!takeTap(ev)) return
    tehtudEl.textContent = '…'
    void runCommand('tehtud')
    return
  }
  const slotEl = target.closest('[data-slot]') as HTMLElement | null
  if (slotEl) {
    if (!takeTap(ev)) return
    const slot = Number(slotEl.getAttribute('data-slot'))
    if (slot === 0 || slot === 1) void runCommand('select-slot', slot)
  }
}

function bindApp(): void {
  if (appBound) return
  const root = document.getElementById('app')
  if (!root) return
  appBound = true
  root.addEventListener('touchstart', onAppPointer, { passive: false, capture: true })
  root.addEventListener('pointerdown', onAppPointer, { passive: false, capture: true })
  root.addEventListener('click', onAppPointer, { passive: false, capture: true })
}

function pinFace(): string {
  const chars: string[] = []
  for (let i = 0; i < 6; i++) chars.push(pinDraft[i] || '·')
  return chars.join(' ')
}

function updatePinFace(): void {
  const pinEl = document.getElementById('kell-pin')
  if (pinEl) pinEl.textContent = pinFace()
}

function needsPinPad(): boolean {
  return !auth && !useRpc
}

function paintPinPad(root: HTMLElement): void {
  const connecting = Boolean(pairCode)
  const subText = connecting
    ? errorText || 'Ühendame telefoniga…'
    : 'Toksa telefonis nähtav 6-kohaline kood.'
  if (root.querySelector('.pad-grid')) {
    updatePinFace()
    const sub = document.getElementById('kell-sub')
    if (sub) sub.textContent = subText
    const err = document.getElementById('kell-err')
    if (err) err.textContent = errorText
    return
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '']
  const pad = keys
    .map(function (key) {
      if (!key) return '<span class="pad-spacer"></span>'
      const label = key === 'C' ? '←' : key
      return '<button type="button" class="pad" data-key="' + key + '">' + label + '</button>'
    })
    .join('')
  root.innerHTML =
    '<p class="title">Salakivi kell</p>' +
    '<p class="sub" id="kell-sub">' +
    esc(subText) +
    '</p>' +
    '<p class="pin" id="kell-pin">' +
    esc(pinFace()) +
    '</p>' +
    '<div class="pad-grid">' +
    pad +
    '</div>' +
    '<p class="err" id="kell-err">' +
    esc(errorText) +
    '</p>'
}

function newCmd(
  type: 'start' | 'tehtud' | 'skip-rest' | 'select-slot',
  extra?: { rev?: number; slot?: number },
): { id: string; type: string; at: number; rev?: number; slot?: number } {
  return {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    type,
    at: Date.now(),
    rev: extra?.rev,
    slot: extra?.slot,
  }
}

async function runCommand(type: 'start' | 'tehtud' | 'skip-rest' | 'select-slot', slot?: number): Promise<void> {
  if (!snap || snap.flow === 'idle' || snap.flow === 'sauna' || snap.flow === 'pick') return
  localHoldUntil = Date.now() + 5000
  connectLiveSocket()
  if (snap.session) {
    const nextSession: LiveSession = applySessionCommand(snap.session, type, Date.now(), { slot: slot })
    if (nextSession !== snap.session) {
      const published = sessionToSnapshot(nextSession) as LiveSnapshot
      published.epoch = snap.epoch || Date.now()
      published.seq = (snap.seq || 0) + 1
      snap = published
      lastPaintKey = ''
      paint()
      sendLive({ kind: 'cmd', cmd: newCmd(type, { rev: nextSession.rev, slot }) })
      sendLive({ kind: 'snap', snap: published })
      await pushSnap(published)
      return
    }
  }
  sendLive({ kind: 'cmd', cmd: newCmd(type, { slot }) })
  if (type === 'start' && (snap.flow === 'ready' || snap.flow === 'resting')) {
    snap = { ...snap, flow: 'active', at: Date.now(), seq: (snap.seq || 0) + 1 }
    lastPaintKey = ''
    paint()
    await pushSnap(snap)
  } else if (type === 'tehtud' && snap.flow === 'active') {
    snap = { ...snap, flow: 'resting', at: Date.now(), seq: (snap.seq || 0) + 1 }
    lastPaintKey = ''
    paint()
    await pushSnap(snap)
  } else {
    lastPaintKey = ''
    paint()
  }
}

function paint(): void {
  const root = document.getElementById('app')
  if (!root) return
  bindApp()

  if (!SUPABASE_URL || !ANON_KEY) {
    root.innerHTML =
      '<p class="title">Salakivi kell</p><p class="sub">Pilveühendus puudub. Ava link telefoni seadetest.</p>'
    return
  }

  if (needsPinPad()) {
    paintPinPad(root)
    return
  }

  const flow = snap ? snap.flow : 'idle'
  const left = snap && snap.restEndsAt ? restLeft(snap.restEndsAt) : 0
  const resting = flow === 'resting' && left > 0
  const canStart = flow === 'ready' || (flow === 'resting' && left <= 0)
  const showTehtud = flow === 'active'
  const pair = snap ? pairFromSnap(snap) : []
  const paintKey = [
    flow,
    snap && snap.exerciseName,
    snap && snap.otherName,
    snap && String(snap.activeSlot),
    snap && String(snap.remainingSets),
    snap && String(snap.weightKg),
    canStart ? 's' : '',
    showTehtud ? 't' : '',
    resting ? 'r' : '',
    errorText,
    pair
      .map(function (p) {
        return p.slot + p.name + p.left + String(p.weightKg || 0)
      })
      .join(','),
  ].join('|')
  const clock = document.getElementById('kell-clock')
  if (clock && resting) clock.textContent = formatClock(left)
  if (
    paintKey === lastPaintKey &&
    (root.querySelector('#kell-start') ||
      root.querySelector('#kell-tehtud') ||
      root.querySelector('.pair') ||
      root.querySelector('.wait') ||
      root.querySelector('.title'))
  ) {
    return
  }
  lastPaintKey = paintKey
  const parts: string[] = []

  if (resting) {
    parts.push('<p class="clock" id="kell-clock">' + formatClock(left) + '</p>')
  }

  if (snap && flow !== 'idle' && flow !== 'pick' && flow !== 'sauna') {
    pair.forEach(function (item) {
      const on = item.slot === (snap && snap.activeSlot != null ? snap.activeSlot : 0)
      parts.push(
        '<button type="button" class="pair' +
          (on ? ' on' : '') +
          '" data-slot="' +
          item.slot +
          '"><span class="nm">' +
          esc(item.name) +
          '</span><span class="meta">' +
          (item.weightKg != null && item.weightKg > 0 ? '<b>' + item.weightKg + ' kg</b>' : '<span></span>') +
          '<strong>' +
          item.left +
          (item.left === 1 ? ' seeria' : ' seeriat') +
          '</strong></span></button>',
      )
    })
    if (pair.length < 2 && snap.exerciseName) {
      parts.push(
        '<p class="wait">' +
          esc(snap.exerciseName) +
          (snap.weightKg != null && snap.weightKg > 0 ? ' · ' + snap.weightKg + ' kg' : '') +
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
  if (flow === 'sauna') parts.push('<p class="start sauna-mark">Sauna</p>')
  if (!snap || flow === 'idle') {
    parts.push('<p class="title">Salakivi kell</p>')
    parts.push(
      '<p class="sub">Hoia treeningäpp telefonis lahti. Ootan treeningu seisu…</p>',
    )
  }
  if (errorText) parts.push('<p class="err">' + esc(errorText) + '</p>')

  root.innerHTML = parts.join('')
}

async function loop(): Promise<void> {
  if (needsPinPad()) {
    if (pairCode) {
      try {
        await pullSnap()
      } catch {
        /* võrk */
      }
      if (!needsPinPad()) {
        paint()
        return
      }
      if (pairWaitFrom && Date.now() - pairWaitFrom > 18000) {
        errorText = 'Ei saanud ühendust. Toksa kood uuesti.'
        pairCode = ''
        pinDraft = ''
        pairWaitFrom = 0
        try {
          localStorage.removeItem(PAIR_KEY)
        } catch {
          /* ignore */
        }
      }
      const root = document.getElementById('app')
      if (root) paintPinPad(root)
    }
    return
  }
  try {
    await pullSnap()
  } catch {
    /* võrk */
  }
  if (pairCode) {
    connectRelay()
    connectPairSocket()
    void pullViaRelayFetch()
  }
  if (auth) connectLiveSocket()
  paint()
}

bindApp()
if (pairCode) {
  connectRelay()
  connectPairSocket()
  void pullViaRelayFetch()
}
if (auth) connectLiveSocket()
paint()
void loop()
window.setInterval(function () {
  void loop()
}, 800)
window.setInterval(function () {
  if (snap && snap.flow === 'resting') paint()
}, 250)
