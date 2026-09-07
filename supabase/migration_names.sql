-- Salakivi Treening — eesnimi + olemasolevale kasutajale näidiskava
-- Ohutu uuesti käivitada.

alter table public.profiles
  add column if not exists display_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  insert into public.profiles (user_id, email, display_name, created_at, last_seen_at)
  values (new.id, new.email, v_name, now(), now())
  on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

create or replace function public.apply_program_template_to_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tmpl jsonb;
  existing jsonb;
  merged jsonb;
begin
  if not public.is_salakivi_admin() then
    raise exception 'Ainult admin saab näidiskava anda';
  end if;
  if target_user_id is null then
    raise exception 'Kasutaja puudub';
  end if;

  select state into tmpl from public.program_template where id = 1;
  if tmpl is null then
    raise exception 'Näidiskava puudub';
  end if;

  select state into existing from public.user_app_state where user_id = target_user_id;
  merged := tmpl || jsonb_build_object('logs', coalesce(existing -> 'logs', '{}'::jsonb));

  insert into public.user_app_state (user_id, state)
  values (target_user_id, merged)
  on conflict (user_id) do update
    set state = excluded.state;
end;
$$;

revoke all on function public.apply_program_template_to_user(uuid) from public;
grant execute on function public.apply_program_template_to_user(uuid) to authenticated;

update public.profiles
set display_name = 'Argo'
where lower(email) = 'salaargo@gmail.com';

update public.profiles
set display_name = 'Ardo'
where lower(email) = 'adamson.ardo@gmail.com';

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"display_name":"Argo"}'::jsonb
where lower(email) = 'salaargo@gmail.com';

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"display_name":"Ardo"}'::jsonb
where lower(email) = 'adamson.ardo@gmail.com';

-- Ardo saab Argo näidiskavad (tema olemasolevad logid jäävad alles).
insert into public.user_app_state (user_id, state)
select
  u.id,
  t.state || jsonb_build_object('logs', coalesce(s.state -> 'logs', '{}'::jsonb))
from auth.users u
cross join public.program_template t
left join public.user_app_state s on s.user_id = u.id
where lower(u.email) = 'adamson.ardo@gmail.com'
  and t.id = 1
on conflict (user_id) do update
  set state = excluded.state;
