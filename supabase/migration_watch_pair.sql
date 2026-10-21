-- Apple Watch: lühike paarikood lingis (kell ei suuda pikka JWT-d avada).
-- Käivita Supabase → SQL Editor → Run, üks kord.

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
grant execute on function public.watch_push(text, jsonb) to anon, authenticated;
