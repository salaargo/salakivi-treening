-- Salakivi Treening — admin + näidiskava olemasolevale projektile
-- Käivita Supabase → SQL Editor → Run (üks kord; ohutu uuesti käivitada).

create or replace function public.is_salakivi_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('salaargo@gmail.com');
$$;

grant execute on function public.is_salakivi_admin() to authenticated;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles
  for select
  using (auth.uid() = user_id or public.is_salakivi_admin());

drop policy if exists "Users upsert own profile" on public.profiles;
create policy "Users upsert own profile"
  on public.profiles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, created_at, last_seen_at)
  values (new.id, new.email, now(), now())
  on conflict (user_id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.program_template (
  id int primary key default 1 check (id = 1),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

drop trigger if exists program_template_updated_at on public.program_template;
create trigger program_template_updated_at
before update on public.program_template
for each row
execute function public.set_user_app_state_updated_at();

alter table public.program_template enable row level security;

drop policy if exists "Authenticated read program template" on public.program_template;
create policy "Authenticated read program template"
  on public.program_template
  for select
  to authenticated
  using (true);

drop policy if exists "Admin write program template" on public.program_template;
create policy "Admin write program template"
  on public.program_template
  for insert
  with check (public.is_salakivi_admin());

drop policy if exists "Admin update program template" on public.program_template;
create policy "Admin update program template"
  on public.program_template
  for update
  using (public.is_salakivi_admin())
  with check (public.is_salakivi_admin());

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.program_template to authenticated;

insert into public.profiles (user_id, email, created_at, last_seen_at)
select
  u.id,
  u.email,
  coalesce(u.created_at, now()),
  coalesce(s.updated_at, u.last_sign_in_at, u.created_at, now())
from auth.users u
left join public.user_app_state s on s.user_id = u.id
on conflict (user_id) do update
  set
    email = excluded.email,
    last_seen_at = greatest(public.profiles.last_seen_at, excluded.last_seen_at);

insert into public.program_template (id, state, updated_by)
select
  1,
  coalesce(jsonb_set(s.state, '{logs}', '{}'::jsonb), '{}'::jsonb),
  s.user_id
from public.user_app_state s
join auth.users u on u.id = s.user_id
where lower(u.email) = 'salaargo@gmail.com'
on conflict (id) do update
  set
    state = excluded.state,
    updated_by = excluded.updated_by;
