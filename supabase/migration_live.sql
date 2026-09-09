-- Kellavaate kiirem sünk: telefon kirjutab hetkeseisu, kell loeb ka siis,
-- kui telefoni ekraan on kinni (JS ei tiksu).
-- Käivita Supabase SQL Editoris üks kord.

create table if not exists public.live_remote (
  user_id uuid primary key references auth.users (id) on delete cascade,
  snap jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.live_remote enable row level security;

drop policy if exists "Users read own live" on public.live_remote;
create policy "Users read own live"
  on public.live_remote
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users upsert own live" on public.live_remote;
create policy "Users upsert own live"
  on public.live_remote
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own live" on public.live_remote;
create policy "Users update own live"
  on public.live_remote
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.live_remote to authenticated;
