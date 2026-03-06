begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Enums

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_user_role') then
    create type public.app_user_role as enum ('user', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'app_user_status') then
    create type public.app_user_status as enum ('active', 'blocked', 'deleted');
  end if;

  if not exists (select 1 from pg_type where typname = 'workspace_member_role') then
    create type public.workspace_member_role as enum ('owner', 'admin', 'editor', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum ('inactive', 'trialing', 'active', 'past_due', 'canceled', 'expired', 'payment_failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'billing_provider') then
    create type public.billing_provider as enum ('cardlink', 'manual', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('new', 'process', 'success', 'overpaid', 'underpaid', 'fail', 'refunded', 'chargeback');
  end if;

  if not exists (select 1 from pg_type where typname = 'generation_status') then
    create type public.generation_status as enum ('queued', 'processing', 'completed', 'failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum ('new', 'contacted', 'qualified', 'converted', 'archived', 'lost');
  end if;
end
$$;

-- Common trigger for updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- Core tables
create table if not exists public.plans (
  id text primary key,
  name text not null,
  description text not null default '',
  price_monthly numeric(12, 2) not null default 0,
  currency char(3) not null default 'RUB',
  generations_per_month integer,
  allowed_content_types text[] not null default array[]::text[],
  is_active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint plans_price_non_negative check (price_monthly >= 0),
  constraint plans_currency_len check (char_length(currency) = 3)
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  external_auth_id uuid unique,
  email citext not null unique,
  password_hash text,
  role public.app_user_role not null default 'user',
  status public.app_user_status not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_login_at timestamptz,
  last_payment_at timestamptz
);

create table if not exists public.user_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  full_name text not null default '',
  username citext unique,
  website text not null default '',
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext unique,
  owner_user_id uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role public.workspace_member_role not null default 'editor',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  plan_id text not null references public.plans(id) on delete restrict,
  status public.subscription_status not null default 'inactive',
  is_current boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete set null,
  subscription_id uuid references public.user_subscriptions(id) on delete set null,
  plan_id text references public.plans(id) on delete set null,
  provider public.billing_provider not null default 'cardlink',
  provider_bill_id text,
  provider_order_id text,
  provider_transaction_id text,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'RUB',
  commission numeric(12, 2),
  status public.payment_status not null default 'new',
  source text not null default 'create-bill',
  raw_payload jsonb,
  paid_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint payments_amount_non_negative check (amount >= 0),
  constraint payments_currency_len check (char_length(currency) = 3)
);

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  content_type text not null,
  prompt text not null,
  tone text,
  platform text,
  title text,
  output text not null default '',
  model text,
  status public.generation_status not null default 'completed',
  error_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  name text not null,
  email citext not null,
  phone text,
  company text,
  goal text,
  source text not null default 'landing',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status public.lead_status not null default 'new',
  assigned_to uuid references public.app_users(id) on delete set null,
  note text not null default '',
  contacted_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_user_id uuid references public.app_users(id) on delete set null,
  event_type text not null,
  from_status public.lead_status,
  to_status public.lead_status,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_users(id) on delete set null,
  action text not null,
  target_table text,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider public.billing_provider not null,
  external_event_id text,
  signature_valid boolean,
  payload jsonb not null,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  error_text text,
  unique(provider, external_event_id)
);

-- Auth helper functions (for direct client access with RLS)
create or replace function public.is_admin(p_auth_uid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_users u
    where u.external_auth_id = p_auth_uid
      and u.role = 'admin'::public.app_user_role
      and u.status = 'active'::public.app_user_status
  );
$$;

create or replace function public.current_app_user_id(p_auth_uid uuid default auth.uid())
returns uuid
language sql
stable
as $$
  select u.id
  from public.app_users u
  where u.external_auth_id = p_auth_uid
  limit 1;
$$;

create or replace function public.can_access_workspace(
  p_workspace_id uuid,
  p_auth_uid uuid default auth.uid()
)
returns boolean
language sql
stable
as $$
  select
    public.is_admin(p_auth_uid)
    or exists (
      select 1
      from public.workspace_members wm
      join public.app_users u on u.id = wm.user_id
      where wm.workspace_id = p_workspace_id
        and u.external_auth_id = p_auth_uid
    );
$$;

-- Indexes
create index if not exists idx_plans_active_sort on public.plans(is_active, sort_order);
create index if not exists idx_users_role_status on public.app_users(role, status);
create index if not exists idx_users_created_at on public.app_users(created_at desc);
create index if not exists idx_profiles_username on public.user_profiles(username);
create index if not exists idx_workspace_members_user_id on public.workspace_members(user_id);
create index if not exists idx_subscriptions_user_status on public.user_subscriptions(user_id, status, is_current);
create unique index if not exists idx_subscriptions_one_current_per_user
  on public.user_subscriptions(user_id)
  where is_current = true;
create index if not exists idx_payments_user_date on public.payments(user_id, created_at desc);
create index if not exists idx_payments_status on public.payments(status);
create index if not exists idx_payments_provider_order on public.payments(provider, provider_order_id);
create index if not exists idx_generations_user_date on public.generations(user_id, created_at desc);
create index if not exists idx_generations_workspace_date on public.generations(workspace_id, created_at desc);
create index if not exists idx_leads_status_date on public.leads(status, created_at desc);
create index if not exists idx_leads_email on public.leads(email);
create index if not exists idx_leads_source on public.leads(source);
create index if not exists idx_lead_events_lead_date on public.lead_events(lead_id, created_at desc);
create index if not exists idx_admin_audit_date on public.admin_audit_log(created_at desc);
create index if not exists idx_billing_webhooks_received on public.billing_webhook_events(received_at desc);

-- updated_at triggers
drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
before update on public.plans
for each row
execute function public.set_updated_at();

drop trigger if exists trg_users_updated_at on public.app_users;
create trigger trg_users_updated_at
before update on public.app_users
for each row
execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.user_profiles;
create trigger trg_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at
before update on public.workspaces
for each row
execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.user_subscriptions;
create trigger trg_subscriptions_updated_at
before update on public.user_subscriptions
for each row
execute function public.set_updated_at();

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
before update on public.payments
for each row
execute function public.set_updated_at();

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

-- Seed plans
insert into public.plans (
  id, name, description, price_monthly, currency, generations_per_month, allowed_content_types, is_active, sort_order, metadata
)
values
  (
    'free',
    'Free',
    'Базовый тариф для старта',
    0,
    'RUB',
    30,
    array['text', 'image', 'post'],
    true,
    1,
    '{"checkout_available": false}'::jsonb
  ),
  (
    'plus',
    'Plus',
    'Расширенный тариф для активного создания контента',
    19,
    'RUB',
    300,
    array['text', 'image', 'video', 'audio', 'post'],
    true,
    2,
    '{"checkout_available": true}'::jsonb
  ),
  (
    'pro',
    'Pro',
    'Максимальный тариф для команд и агентств',
    59,
    'RUB',
    null,
    array['text', 'image', 'video', 'audio', 'post'],
    true,
    3,
    '{"checkout_available": true}'::jsonb
  )
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  price_monthly = excluded.price_monthly,
  currency = excluded.currency,
  generations_per_month = excluded.generations_per_month,
  allowed_content_types = excluded.allowed_content_types,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());

-- RLS (service role keeps full access)
alter table public.plans enable row level security;
alter table public.app_users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.generations enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.billing_webhook_events enable row level security;

-- plans
drop policy if exists plans_read_all on public.plans;
create policy plans_read_all on public.plans
for select
using (true);

-- app_users
drop policy if exists app_users_self_or_admin_select on public.app_users;
create policy app_users_self_or_admin_select on public.app_users
for select
using (external_auth_id = auth.uid() or public.is_admin());

drop policy if exists app_users_self_or_admin_update on public.app_users;
create policy app_users_self_or_admin_update on public.app_users
for update
using (external_auth_id = auth.uid() or public.is_admin())
with check (external_auth_id = auth.uid() or public.is_admin());

-- profiles
drop policy if exists profiles_self_or_admin_select on public.user_profiles;
create policy profiles_self_or_admin_select on public.user_profiles
for select
using (
  user_id = public.current_app_user_id()
  or public.is_admin()
);

drop policy if exists profiles_self_or_admin_update on public.user_profiles;
create policy profiles_self_or_admin_update on public.user_profiles
for update
using (
  user_id = public.current_app_user_id()
  or public.is_admin()
)
with check (
  user_id = public.current_app_user_id()
  or public.is_admin()
);

-- workspaces
drop policy if exists workspaces_member_or_admin_select on public.workspaces;
create policy workspaces_member_or_admin_select on public.workspaces
for select
using (public.can_access_workspace(id));

-- members
drop policy if exists workspace_members_member_or_admin_select on public.workspace_members;
create policy workspace_members_member_or_admin_select on public.workspace_members
for select
using (public.can_access_workspace(workspace_id));

-- subscriptions
drop policy if exists subscriptions_owner_or_admin_select on public.user_subscriptions;
create policy subscriptions_owner_or_admin_select on public.user_subscriptions
for select
using (
  user_id = public.current_app_user_id()
  or (workspace_id is not null and public.can_access_workspace(workspace_id))
  or public.is_admin()
);

-- payments
drop policy if exists payments_owner_or_admin_select on public.payments;
create policy payments_owner_or_admin_select on public.payments
for select
using (
  user_id = public.current_app_user_id()
  or public.is_admin()
);

-- generations
drop policy if exists generations_owner_workspace_or_admin_select on public.generations;
create policy generations_owner_workspace_or_admin_select on public.generations
for select
using (
  user_id = public.current_app_user_id()
  or (workspace_id is not null and public.can_access_workspace(workspace_id))
  or public.is_admin()
);

drop policy if exists generations_owner_workspace_or_admin_insert on public.generations;
create policy generations_owner_workspace_or_admin_insert on public.generations
for insert
with check (
  user_id = public.current_app_user_id()
  or (workspace_id is not null and public.can_access_workspace(workspace_id))
  or public.is_admin()
);

-- leads
drop policy if exists leads_admin_or_workspace_select on public.leads;
create policy leads_admin_or_workspace_select on public.leads
for select
using (
  public.is_admin()
  or (workspace_id is not null and public.can_access_workspace(workspace_id))
);

drop policy if exists leads_admin_or_workspace_update on public.leads;
create policy leads_admin_or_workspace_update on public.leads
for update
using (
  public.is_admin()
  or (workspace_id is not null and public.can_access_workspace(workspace_id))
)
with check (
  public.is_admin()
  or (workspace_id is not null and public.can_access_workspace(workspace_id))
);

commit;
