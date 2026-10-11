-- Run in the SQL editor of your Supabase project. Safe to run again.
-- Beta: every member of a workspace may modify its entire payload.
create table if not exists public.beta_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id),
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object' and payload ->> 'version' = '1')
);
create table if not exists public.beta_memberships (
  workspace_id uuid not null references public.beta_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (workspace_id, user_id)
);
create table if not exists public.beta_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.beta_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, endpoint)
);
alter table public.beta_workspaces enable row level security;
alter table public.beta_memberships enable row level security;
alter table public.beta_push_subscriptions enable row level security;

create or replace function public.is_beta_member(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.beta_memberships where workspace_id = p_id and user_id = auth.uid());
$$;
revoke all on function public.is_beta_member(uuid) from public, anon;
grant execute on function public.is_beta_member(uuid) to authenticated;

drop policy if exists beta_workspace_read on public.beta_workspaces;
create policy beta_workspace_read on public.beta_workspaces for select to authenticated using (public.is_beta_member(id));
drop policy if exists beta_members_read on public.beta_memberships;
create policy beta_members_read on public.beta_memberships for select to authenticated using (public.is_beta_member(workspace_id));
drop policy if exists beta_push_read on public.beta_push_subscriptions;
create policy beta_push_read on public.beta_push_subscriptions for select to authenticated using (user_id = auth.uid() and public.is_beta_member(workspace_id));
revoke all on public.beta_workspaces, public.beta_memberships, public.beta_push_subscriptions from anon, authenticated;
grant select on public.beta_workspaces, public.beta_memberships, public.beta_push_subscriptions to authenticated;
grant all on public.beta_workspaces, public.beta_memberships, public.beta_push_subscriptions to service_role;

create or replace function public.create_beta_workspace(p_name text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.beta_workspaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(p_name) > 100 or pg_column_size(p_payload) > 5000000 or p_payload ->> 'version' is distinct from '1' then raise exception 'INVALID_PAYLOAD'; end if;
  insert into public.beta_workspaces(name,owner_id,payload) values(p_name,auth.uid(),p_payload) returning * into w;
  insert into public.beta_memberships(workspace_id,user_id) values(w.id,auth.uid());
  return jsonb_build_object('workspace_id',w.id,'revision',w.revision);
end; $$;

create or replace function public.join_beta_workspace(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select id into wid from public.beta_workspaces where invite_code = trim(p_code);
  if wid is null then raise exception 'INVALID_INVITE_CODE'; end if;
  insert into public.beta_memberships(workspace_id,user_id) values(wid,auth.uid()) on conflict do nothing;
  return jsonb_build_object('workspace_id',wid);
end; $$;

create or replace function public.beta_workspace_invite(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_beta_member(p_id) then raise exception 'ACCESS_DENIED'; end if;
  return (select jsonb_build_object('invite_code',invite_code) from public.beta_workspaces where id=p_id);
end; $$;

create or replace function public.save_beta_workspace(p_id uuid,p_expected_revision bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if not public.is_beta_member(p_id) then raise exception 'ACCESS_DENIED'; end if;
  if pg_column_size(p_payload)>5000000 or p_payload ->> 'version' is distinct from '1' then raise exception 'INVALID_PAYLOAD'; end if;
  update public.beta_workspaces set payload=p_payload, revision=revision+1, updated_at=now()
    where id=p_id and revision=p_expected_revision returning revision into new_revision;
  if new_revision is null then raise exception 'REVISION_CONFLICT'; end if;
  return jsonb_build_object('revision',new_revision);
end; $$;

create or replace function public.register_beta_push(p_id uuid,p_subscription jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_beta_member(p_id) then raise exception 'ACCESS_DENIED'; end if;
  if p_subscription ->> 'endpoint' is null or p_subscription ->> 'endpoint' not like 'https://%' or length(p_subscription ->> 'endpoint')>2048
    or p_subscription #>> '{keys,p256dh}' is null or p_subscription #>> '{keys,auth}' is null then raise exception 'INVALID_SUBSCRIPTION'; end if;
  insert into public.beta_push_subscriptions(workspace_id,user_id,endpoint,subscription)
    values(p_id,auth.uid(),p_subscription ->> 'endpoint',p_subscription)
    on conflict(workspace_id,user_id,endpoint) do update set subscription=excluded.subscription,updated_at=now();
  return jsonb_build_object('registered',true);
end; $$;

revoke all on function public.create_beta_workspace(text,jsonb), public.join_beta_workspace(text), public.beta_workspace_invite(uuid), public.save_beta_workspace(uuid,bigint,jsonb), public.register_beta_push(uuid,jsonb) from public, anon;
grant execute on function public.create_beta_workspace(text,jsonb), public.join_beta_workspace(text), public.beta_workspace_invite(uuid), public.save_beta_workspace(uuid,bigint,jsonb), public.register_beta_push(uuid,jsonb) to authenticated;
