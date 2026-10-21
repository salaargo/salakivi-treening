import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { getSupabase, isCloudEnabled } from './lib/supabase'
import { getLatestLiveSnapshot } from './live/remote'
import { watchUrl } from './orientation'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LOCAL_PAIR_KEY = 'salakivi-watch-pair-v1'

export const WATCH_PAIR_SQL = `-- Apple Watchi lühike paarikood. Supabase → SQL Editor → Run (üks kord).

create table if not exists public.watch_pair (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table public.watch_pair enable row level security;

drop policy if exists "Users manage own watch pair" on public.watch_pair;
create policy "Users manage own watch pair"
  on public.watch_pair
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.watch_pair to authenticated;

create or replace function public.watch_pull(pair text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  result jsonb;
begin
  if pair is null or length(pair) < 6 then
    return jsonb_build_object('ok', false);
  end if;
  select user_id into uid from public.watch_pair where token = pair;
  if uid is null then
    return jsonb_build_object('ok', false);
  end if;
  select snap into result from public.live_remote where user_id = uid;
  if result is null then
    select state -> '__live' into result from public.user_app_state where user_id = uid;
  end if;
  return jsonb_build_object('ok', true, 'snap', result);
end;
$$;

create or replace function public.watch_push(pair text, next jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  existing jsonb;
begin
  if pair is null or length(pair) < 6 then
    raise exception 'invalid pair';
  end if;
  select user_id into uid from public.watch_pair where token = pair;
  if uid is null then
    raise exception 'invalid pair';
  end if;
  insert into public.live_remote (user_id, snap, updated_at)
  values (uid, next, now())
  on conflict (user_id) do update
    set snap = excluded.snap,
        updated_at = now();
  select state into existing from public.user_app_state where user_id = uid;
  if existing is not null then
    update public.user_app_state
      set state = existing || jsonb_build_object('__live', next)
      where user_id = uid;
  end if;
end;
$$;

revoke all on function public.watch_pull(text) from public;
revoke all on function public.watch_push(text, jsonb) from public;
grant execute on function public.watch_pull(text) to anon, authenticated;
`

export function newWatchPairToken(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return out
}

function readLocalToken(): string {
  try {
    const existing = localStorage.getItem(LOCAL_PAIR_KEY)
    if (existing && existing.length >= 6) return existing
  } catch {
    /* ignore */
  }
  return ''
}

function writeLocalToken(token: string): void {
  try {
    localStorage.setItem(LOCAL_PAIR_KEY, token)
  } catch {
    /* ignore */
  }
}

export async function ensureWatchPairToken(userId?: string): Promise<{ token: string; needsSql: boolean }> {
  let token = readLocalToken()
  let needsSql = false
  if (userId && isCloudEnabled()) {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase.from('watch_pair').select('token').eq('user_id', userId).maybeSingle()
      if (error) {
        needsSql = true
      } else if (typeof data?.token === 'string' && data.token.length >= 6) {
        token = data.token
      } else {
        if (!token) token = newWatchPairToken()
        const { error: writeError } = await supabase.from('watch_pair').upsert(
          { user_id: userId, token, created_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
        if (writeError) needsSql = true
      }
    } catch {
      needsSql = true
    }
  }
  if (!token) token = newWatchPairToken()
  writeLocalToken(token)
  return { token, needsSql }
}

export function watchRelayUrl(token: string): string {
  return 'https://ntfy.sh/skw-' + token
}

export async function appleWatchPairUrl(userId: string): Promise<{ href: string; token: string; needsSql: boolean }> {
  const { token, needsSql } = await ensureWatchPairToken(userId)
  const url = new URL(watchUrl('square'))
  url.searchParams.set('p', token)
  url.searchParams.set('v', Date.now().toString(36))
  return { href: url.toString(), token, needsSql }
}

export async function publishWatchPairAuth(token: string, session: Session): Promise<void> {
  if (!token || !session.access_token) return
  const body = JSON.stringify(authPayload(session))
  await fetch(watchRelayUrl(token), {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function authPayload(session: Session): { a: string; r: string; u: string } {
  return {
    a: session.access_token,
    r: session.refresh_token || '',
    u: session.user.id,
  }
}

/** Saadab kella paarikoodile sessiooni, kuni Apple Watch jõuab lingi avada. */
export function startWatchPairBeacon(userId: string): () => void {
  if (!isCloudEnabled() || !userId) return () => {}
  const supabase = getSupabase()
  let stopped = false
  let channel: RealtimeChannel | null = null
  let timer = 0

  void (async () => {
    const { token } = await ensureWatchPairToken(userId)
    if (stopped) return
    channel = supabase.channel('skw-' + token, {
      config: { broadcast: { ack: false, self: true }, private: false },
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void send()
    })

    let lastRelay = 0
    async function send(forceRelay = false) {
      if (stopped) return
      const { data } = await supabase.auth.getSession()
      const session = data.session
      if (!session?.access_token) return
      const payload = { ...authPayload(session), snap: getLatestLiveSnapshot() }
      try {
        await channel?.send({ type: 'broadcast', event: 'auth', payload })
      } catch {
        /* realtime on varuvariant */
      }
      if (forceRelay || Date.now() - lastRelay > 20000) {
        lastRelay = Date.now()
        try {
          await publishWatchPairAuth(token, session)
        } catch {
          /* ntfy on varuvariant */
        }
      }
    }

    await send(true)
    timer = window.setInterval(() => {
      void send()
    }, 2500)
  })()

  return () => {
    stopped = true
    if (timer) window.clearInterval(timer)
    if (channel) void supabase.removeChannel(channel)
  }
}
