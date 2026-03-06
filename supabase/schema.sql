create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null default '{"users":[],"payments":[],"leads":[]}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_app_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_app_state_updated_at on public.app_state;

create trigger trg_app_state_updated_at
before update on public.app_state
for each row
execute function public.set_app_state_updated_at();

insert into public.app_state (id, payload)
values ('main', '{"users":[],"payments":[],"leads":[]}'::jsonb)
on conflict (id) do nothing;
