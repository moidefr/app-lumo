-- Lumo v1: no demo users/data, no anonymous access. All mutations use role-checked RPCs.
-- SECURITY DEFINER implementation is in the non-exposed lumo_private schema.
create schema if not exists lumo_private;
revoke all on schema lumo_private from public,anon;
grant usage on schema lumo_private to authenticated,service_role;
create table public.lumo_clubs(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 2 and 120),owner_id uuid not null references auth.users(id),payload jsonb not null,revision bigint not null default 1 check(revision>0),updated_at timestamptz not null default now());
create index lumo_clubs_owner_idx on public.lumo_clubs(owner_id);
create table public.lumo_memberships(club_id uuid not null references public.lumo_clubs(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,role text not null default 'parent' check(role in ('admin','coach','parent')),display_name text not null check(length(display_name) between 2 and 100),member_ids text[] not null default '{}',created_at timestamptz not null default now(),primary key(club_id,user_id));
create index lumo_memberships_user_idx on public.lumo_memberships(user_id,club_id);
create table lumo_private.lumo_invitations(code text primary key default replace(gen_random_uuid()::text,'-',''),club_id uuid not null references public.lumo_clubs(id) on delete cascade,created_by uuid not null references auth.users(id),expires_at timestamptz not null default now()+interval '7 days');
create index lumo_invitations_club_idx on lumo_private.lumo_invitations(club_id);
create index lumo_invitations_creator_idx on lumo_private.lumo_invitations(created_by);
create table public.lumo_notification_preferences(club_id uuid not null,user_id uuid not null,push_enabled boolean not null default false,reminders_enabled boolean not null default true,primary key(club_id,user_id),foreign key(club_id,user_id) references public.lumo_memberships(club_id,user_id) on delete cascade);
create table public.lumo_notifications(id uuid primary key default gen_random_uuid(),club_id uuid not null,user_id uuid not null,event_id text,kind text not null,title text not null,body text not null,url text not null default '/',read_at timestamptz,created_at timestamptz not null default now(),dedupe_key text not null unique,foreign key(club_id,user_id) references public.lumo_memberships(club_id,user_id) on delete cascade);
create index lumo_notifications_user_idx on public.lumo_notifications(user_id,club_id,created_at desc);
create index lumo_notifications_club_idx on public.lumo_notifications(club_id,user_id);
create table public.lumo_push_subscriptions(id uuid primary key default gen_random_uuid(),club_id uuid not null,user_id uuid not null,endpoint text not null check(endpoint like 'https://%'),subscription jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(club_id,user_id,endpoint),foreign key(club_id,user_id) references public.lumo_memberships(club_id,user_id) on delete cascade);
create index lumo_push_subscriptions_user_idx on public.lumo_push_subscriptions(user_id);
create table lumo_private.lumo_push_jobs(id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.lumo_notifications(id) on delete cascade,subscription_id uuid not null references public.lumo_push_subscriptions(id) on delete cascade,state text not null default 'pending' check(state in ('pending','sending','sent','failed')),attempts integer not null default 0,available_at timestamptz not null default now(),created_at timestamptz not null default now(),last_error text,unique(notification_id,subscription_id));
create index lumo_push_jobs_pending_idx on lumo_private.lumo_push_jobs(available_at) where state in ('pending','sending');
create index lumo_push_jobs_subscription_idx on lumo_private.lumo_push_jobs(subscription_id);

create function lumo_private.role_for(p_id uuid) returns text language sql stable security definer set search_path='' as $$select role from public.lumo_memberships where club_id=p_id and user_id=(select auth.uid())$$;
create function lumo_private.require_member(p_id uuid) returns public.lumo_memberships language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships;
begin
 if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 select * into m from public.lumo_memberships where club_id=p_id and user_id=auth.uid();
 if not found then raise exception 'Vous ne faites pas partie de ce club.' using errcode='42501'; end if;
 return m;
end $$;
alter table public.lumo_clubs enable row level security;
alter table public.lumo_memberships enable row level security;
alter table public.lumo_notifications enable row level security;
alter table public.lumo_notification_preferences enable row level security;
alter table public.lumo_push_subscriptions enable row level security;
alter table lumo_private.lumo_invitations enable row level security;
alter table lumo_private.lumo_push_jobs enable row level security;
create policy clubs_members_read on public.lumo_clubs for select to authenticated using(id in (select club_id from public.lumo_memberships where user_id=(select auth.uid())));
create policy memberships_read on public.lumo_memberships for select to authenticated using(user_id=(select auth.uid()) or (select lumo_private.role_for(club_id))='admin');
create policy notifications_self on public.lumo_notifications for select to authenticated using(user_id=(select auth.uid()));
create policy preferences_self on public.lumo_notification_preferences for select to authenticated using(user_id=(select auth.uid()));
create policy subscriptions_self on public.lumo_push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.lumo_clubs,public.lumo_memberships,public.lumo_notifications,public.lumo_notification_preferences,public.lumo_push_subscriptions from public,anon,authenticated;
grant select on public.lumo_clubs,public.lumo_memberships,public.lumo_notifications,public.lumo_notification_preferences,public.lumo_push_subscriptions to authenticated;
grant all on public.lumo_clubs,public.lumo_memberships,public.lumo_notifications,public.lumo_notification_preferences,public.lumo_push_subscriptions,lumo_private.lumo_push_jobs to service_role;

-- Validate JSON independently of the client. Capacity and identities are transactional.
create function lumo_private.validate_payload(p jsonb) returns void language plpgsql set search_path='' as $$
declare k text; x jsonb; e jsonb; o jsonb; leg text; l jsonb; a jsonb; g text; parent text; seen text[]; demand int; capacity int;
begin
 if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb or jsonb_typeof(p->'clubName') is distinct from 'string' or length(p->>'clubName') not between 2 and 120 or octet_length(p::text)>2097152 then raise exception 'Données du club invalides ou trop volumineuses.'; end if;
 foreach k in array array['groups','members','events','notifications'] loop if jsonb_typeof(p->k) is distinct from 'array' or jsonb_array_length(p->k)>10000 then raise exception 'Liste % invalide.',k; end if; end loop;
 foreach k in array array['groups','members','events'] loop
  if exists(select 1 from jsonb_array_elements(p->k) v where jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'id') is distinct from 'string' or length(v->>'id') not between 1 and 160) or (select count(*) from jsonb_array_elements(p->k))<>(select count(distinct v->>'id') from jsonb_array_elements(p->k) v) then raise exception 'Identifiants % invalides.',k; end if;
 end loop;
 for x in select value from jsonb_array_elements(p->'groups') loop
  if jsonb_typeof(x->'name') is distinct from 'string' or length(x->>'name') not between 1 and 120 then raise exception 'Nom du groupe invalide.'; end if;
  parent=x->>'parentId'; seen=array[x->>'id'];
  while parent is not null and parent<>'' loop
   if parent=any(seen) then raise exception 'Hiérarchie cyclique.'; end if; seen=array_append(seen,parent);
   if not exists(select 1 from jsonb_array_elements(p->'groups') v where v->>'id'=parent) then raise exception 'Groupe parent inconnu.'; end if;
   select v->>'parentId' into parent from jsonb_array_elements(p->'groups') v where v->>'id'=parent;
  end loop;
 end loop;
 for x in select value from jsonb_array_elements(p->'members') loop
  if jsonb_typeof(x->'name') is distinct from 'string' or length(x->>'name') not between 1 and 120 or jsonb_typeof(x->'parentName') is distinct from 'string' or coalesce(x->>'kind','') not in ('child','adult') or jsonb_typeof(x->'groups') is distinct from 'array' then raise exception 'Participant invalide.'; end if;
  for g in select jsonb_array_elements_text(x->'groups') loop if not exists(select 1 from jsonb_array_elements(p->'groups') v where v->>'id'=g) then raise exception 'Groupe du participant inconnu.'; end if; end loop;
 end loop;
 for e in select value from jsonb_array_elements(p->'events') loop
  if jsonb_typeof(e->'title') is distinct from 'string' or length(e->>'title') not between 1 and 200 or coalesce(e->>'type','') not in ('match','training','special') or coalesce(e->>'date','')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(e->'cancelled') is distinct from 'boolean' or jsonb_typeof(e->'rosterPublished') is distinct from 'boolean' then raise exception 'Événement invalide.'; end if;
  perform (e->>'date')::date;
  foreach k in array array['time','meetingTime'] loop if coalesce(e->>k,'')<>'' and (e->>k)!~'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horaire invalide.'; end if; end loop;
  foreach k in array array['groups','attendees','offers','missions'] loop if jsonb_typeof(e->k) is distinct from 'array' then raise exception 'Liste événement invalide.'; end if; end loop;
  for g in select jsonb_array_elements_text(e->'groups') loop if not exists(select 1 from jsonb_array_elements(p->'groups') v where v->>'id'=g) then raise exception 'Groupe événement inconnu.'; end if; end loop;
  if (select count(*) from jsonb_array_elements(e->'attendees'))<>(select count(distinct v->>'memberId') from jsonb_array_elements(e->'attendees') v) then raise exception 'Participant dupliqué.'; end if;
  for a in select value from jsonb_array_elements(e->'attendees') loop
   if not exists(select 1 from jsonb_array_elements(p->'members') v where v->>'id'=a->>'memberId') or coalesce(a->>'availability','') not in ('present','absent','unknown') or jsonb_typeof(a->'selected') is distinct from 'boolean' or coalesce(a#>>'{transport,outbound}','') not in ('unknown','need','confirmed','parent') or coalesce(a#>>'{transport,return}','') not in ('unknown','need','confirmed','parent') then raise exception 'Réponse de participant invalide.'; end if;
  end loop;
  foreach k in array array['offers','missions'] loop
   if exists(select 1 from jsonb_array_elements(e->k) v where jsonb_typeof(v->'id') is distinct from 'string' or length(v->>'id') not between 1 and 160) or (select count(*) from jsonb_array_elements(e->k))<>(select count(distinct v->>'id') from jsonb_array_elements(e->k) v) then raise exception 'Identifiant voiture/mission invalide.'; end if;
  end loop;
  for o in select value from jsonb_array_elements(e->'offers') loop
   if jsonb_typeof(o->'driver') is distinct from 'string' or length(trim(o->>'driver')) not between 1 and 120 or coalesce(o->>'totalSeats','')!~'^[2-9]$' or jsonb_typeof(o->'onboard') is distinct from 'array' or coalesce(o->>'ownerUserId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Voiture invalide.'; end if;
   if (select count(*) from jsonb_array_elements(o->'onboard'))<>(select count(distinct v) from jsonb_array_elements(o->'onboard') v) or jsonb_array_length(o->'onboard')>(o->>'totalSeats')::integer-1 then raise exception 'Passagers déjà présents invalides.'; end if;
   for g in select jsonb_array_elements_text(o->'onboard') loop if not exists(select 1 from jsonb_array_elements(p->'members') v where v->>'id'=g) then raise exception 'Passager inconnu.'; end if; end loop;
   foreach leg in array array['outbound','return'] loop
    l=o#>array['legs',leg];
    if jsonb_typeof(l->'enabled') is distinct from 'boolean' or coalesce(l->>'offered','')!~'^[0-9]$' or coalesce(l->>'reserved','')!~'^[0-9]$' then raise exception 'Capacité voiture invalide.'; end if;
    if (l->>'reserved')::int>(l->>'offered')::int or (l->>'offered')::int+jsonb_array_length(o->'onboard')>(o->>'totalSeats')::int-1 then raise exception 'Places supérieures à la capacité.'; end if;
    if e->>'transportMode'='pool' and (l->>'reserved')::int<>0 then raise exception 'Les réservations sont communes, pas liées à une voiture.'; end if;
   end loop;
  end loop;
  foreach leg in array array['outbound','return'] loop
   if exists(select 1 from jsonb_array_elements(e->'offers') v cross join lateral jsonb_array_elements_text(v->'onboard') m where v#>array['legs',leg,'enabled']='true'::jsonb group by m having count(*)>1) then raise exception 'Un participant apparaît dans plusieurs voitures.'; end if;
   if e->>'transportMode'='pool' then
    select coalesce(sum((v#>>array['legs',leg,'offered'])::int),0) into capacity from jsonb_array_elements(e->'offers') v where v#>array['legs',leg,'enabled']='true';
    select count(*) into demand from jsonb_array_elements(e->'attendees') va where va->'selected'='true' and va->>'availability'<>'absent' and va#>>array['transport',leg]='confirmed' and not exists(select 1 from jsonb_array_elements(e->'offers') vo where vo#>array['legs',leg,'enabled']='true' and vo->'onboard' @> jsonb_build_array(va->>'memberId'));
    if demand>capacity then raise exception 'Toutes les places du trajet % sont prises. Proposez une voiture ou indiquez un besoin.',leg; end if;
   end if;
  end loop;
  for x in select value from jsonb_array_elements(e->'missions') loop
   if jsonb_typeof(x->'name') is distinct from 'string' or coalesce(x->>'needed','')!~'^[0-9]{1,2}$' or (x->>'needed')::int not between 1 and 50 or jsonb_typeof(x->'assigned') is distinct from 'array' then raise exception 'Mission invalide.'; end if;
   if jsonb_array_length(x->'assigned')>(x->>'needed')::int or exists(select 1 from jsonb_array_elements(x->'assigned') v where jsonb_typeof(v)<>'string') or (select count(*) from jsonb_array_elements(x->'assigned'))<>(select count(distinct v) from jsonb_array_elements(x->'assigned') v) then raise exception 'Bénévoles invalides.'; end if;
  end loop;
 end loop;
end $$;

create function lumo_private.context(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; c public.lumo_clubs; members jsonb; prefs jsonb;
begin
 m=lumo_private.require_member(p_id); select * into c from public.lumo_clubs where id=p_id;
 select coalesce(jsonb_agg(to_jsonb(v)),'[]') into members from public.lumo_memberships v where club_id=p_id and (m.role='admin' or user_id=m.user_id);
 select to_jsonb(v) into prefs from public.lumo_notification_preferences v where club_id=p_id and user_id=m.user_id;
 return jsonb_build_object('club',to_jsonb(c)-'payload','payload',c.payload,'revision',c.revision,'membership',to_jsonb(m),'memberships',members,'notification_preferences',coalesce(prefs,jsonb_build_object('push_enabled',false,'reminders_enabled',true)));
end $$;
create function lumo_private.create_club(p_name text,p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; uid uuid=auth.uid(); p jsonb;
begin
 if uid is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 if p_name is null or p_display_name is null or length(trim(p_name)) not between 2 and 120 or length(trim(p_display_name)) not between 2 and 100 then raise exception 'Noms invalides.'; end if;
 if (select count(*) from public.lumo_clubs where owner_id=uid)>=5 then raise exception 'Vous pouvez créer au maximum cinq clubs.'; end if;
 p=jsonb_build_object('version',1,'clubName',trim(p_name),'groups','[{"id":"g13f","name":"−13 filles","parentId":null},{"id":"g13g","name":"−13 garçons","parentId":null},{"id":"g15f","name":"−15 filles","parentId":null},{"id":"g15g","name":"−15 garçons","parentId":null},{"id":"g18f","name":"−18 filles","parentId":null},{"id":"g18g","name":"−18 garçons","parentId":null},{"id":"gseniors","name":"Seniors","parentId":null}]'::jsonb,'members','[]'::jsonb,'events','[]'::jsonb,'notifications','[]'::jsonb);
 insert into public.lumo_clubs(name,owner_id,payload) values(trim(p_name),uid,p) returning id into cid;
 insert into public.lumo_memberships(club_id,user_id,role,display_name) values(cid,uid,'admin',trim(p_display_name));
 insert into public.lumo_notification_preferences(club_id,user_id) values(cid,uid);
 return lumo_private.context(cid);
end $$;
create function lumo_private.join_club(p_code text,p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; uid uuid=auth.uid();
begin
 if uid is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 if p_display_name is null or length(trim(p_display_name)) not between 2 and 100 then raise exception 'Indiquez votre nom.'; end if;
 select club_id into cid from lumo_private.lumo_invitations where code=lower(trim(p_code)) and expires_at>now();
 if cid is null then raise exception 'Invitation inconnue ou expirée.'; end if;
 insert into public.lumo_memberships(club_id,user_id,display_name) values(cid,uid,trim(p_display_name)) on conflict do nothing;
 insert into public.lumo_notification_preferences(club_id,user_id) values(cid,uid) on conflict do nothing;
 return lumo_private.context(cid);
end $$;
create function lumo_private.create_invite(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; r lumo_private.lumo_invitations;
begin
 m=lumo_private.require_member(p_id); if m.role<>'admin' then raise exception 'Seul un administrateur peut inviter.' using errcode='42501'; end if;
 delete from lumo_private.lumo_invitations where club_id=p_id and expires_at<now();
 insert into lumo_private.lumo_invitations(club_id,created_by) values(p_id,m.user_id) returning * into r;
 return jsonb_build_object('code',r.code,'expires_at',r.expires_at);
end $$;
create function lumo_private.set_member_access(p_id uuid,p_user_id uuid,p_role text,p_member_ids text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; c public.lumo_clubs; mid text;
begin
 m=lumo_private.require_member(p_id); if m.role<>'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
 select * into c from public.lumo_clubs where id=p_id for update;
 if p_role is null or p_role not in ('admin','coach','parent') or p_member_ids is null then raise exception 'Rôle invalide.'; end if;
 if c.owner_id=p_user_id and p_role<>'admin' then raise exception 'Le propriétaire reste administrateur.'; end if;
 foreach mid in array p_member_ids loop if not exists(select 1 from jsonb_array_elements(c.payload->'members') v where v->>'id'=mid) then raise exception 'Participant lié inconnu.'; end if; end loop;
 update public.lumo_memberships set role=p_role,member_ids=p_member_ids where club_id=p_id and user_id=p_user_id;
 if not found then raise exception 'Compte membre inconnu.'; end if;
 return lumo_private.context(p_id);
end $$;

-- Only linked family availability/transport, own vehicles, self volunteering.
create function lumo_private.validate_parent_changes(oldp jsonb,newp jsonb,m public.lumo_memberships) returns void language plpgsql set search_path='' as $$
declare e jsonb; ne jsonb; a jsonb; na jsonb; o jsonb; no jsonb; mi jsonb; nm jsonb; g text;
begin
 if (oldp-'events') is distinct from (newp-'events') or jsonb_array_length(oldp->'events')<>jsonb_array_length(newp->'events') then raise exception 'Les parents ne peuvent pas modifier l’organisation.' using errcode='42501'; end if;
 for e in select value from jsonb_array_elements(oldp->'events') loop
  select v into ne from jsonb_array_elements(newp->'events') v where v->>'id'=e->>'id';
  if ne is null or (e-array['attendees','offers','missions']) is distinct from (ne-array['attendees','offers','missions']) or jsonb_array_length(e->'attendees')<>jsonb_array_length(ne->'attendees') or jsonb_array_length(e->'missions')<>jsonb_array_length(ne->'missions') then raise exception 'Modification réservée au coach.' using errcode='42501'; end if;
  for a in select value from jsonb_array_elements(e->'attendees') loop
   select v into na from jsonb_array_elements(ne->'attendees') v where v->>'memberId'=a->>'memberId';
   if na is null or (a-array['availability','transport']) is distinct from (na-array['availability','transport']) or (not((a->>'memberId')=any(m.member_ids)) and a is distinct from na) then raise exception 'Vous pouvez répondre uniquement pour votre famille.' using errcode='42501'; end if;
  end loop;
  for o in select value from jsonb_array_elements(e->'offers') loop
   select v into no from jsonb_array_elements(ne->'offers') v where v->>'id'=o->>'id';
   if coalesce(o->>'ownerUserId','')<>m.user_id::text and o is distinct from no then raise exception 'Vous pouvez modifier uniquement votre voiture.' using errcode='42501'; end if;
  end loop;
  for no in select value from jsonb_array_elements(ne->'offers') loop
   select v into o from jsonb_array_elements(e->'offers') v where v->>'id'=no->>'id';
   if o is null or o is distinct from no then
    if no->>'ownerUserId' is distinct from m.user_id::text or no->>'driver' is distinct from m.display_name then raise exception 'Le conducteur doit être votre compte.' using errcode='42501'; end if;
    for g in select jsonb_array_elements_text(no->'onboard') loop if not(g=any(m.member_ids)) then raise exception 'Seuls vos participants liés peuvent être déjà à bord.' using errcode='42501'; end if; end loop;
   end if;
  end loop;
  for mi in select value from jsonb_array_elements(e->'missions') loop
   select v into nm from jsonb_array_elements(ne->'missions') v where v->>'id'=mi->>'id';
   if nm is null or (mi-'assigned') is distinct from (nm-'assigned') then raise exception 'Mission réservée au coach.' using errcode='42501'; end if;
   if (select coalesce(jsonb_agg(v order by v::text),'[]') from jsonb_array_elements(mi->'assigned') v where v<>to_jsonb(m.display_name)) is distinct from (select coalesce(jsonb_agg(v order by v::text),'[]') from jsonb_array_elements(nm->'assigned') v where v<>to_jsonb(m.display_name)) then raise exception 'Vous pouvez vous inscrire uniquement sous votre nom.' using errcode='42501'; end if;
  end loop;
 end loop;
end $$;
create function lumo_private.enqueue_notification(p_club uuid,p_user uuid,p_event text,p_kind text,p_title text,p_body text,p_dedupe text) returns uuid language plpgsql security definer set search_path='' as $$
declare nid uuid;
begin
 insert into public.lumo_notifications(club_id,user_id,event_id,kind,title,body,url,dedupe_key) values(p_club,p_user,p_event,p_kind,p_title,p_body,case when p_event is null then '/' else '/#event='||p_event end,p_dedupe) on conflict(dedupe_key) do nothing returning id into nid;
 if nid is not null then insert into lumo_private.lumo_push_jobs(notification_id,subscription_id) select nid,s.id from public.lumo_push_subscriptions s join public.lumo_notification_preferences p using(club_id,user_id) where s.club_id=p_club and s.user_id=p_user and p.push_enabled on conflict do nothing; end if;
 return nid;
end $$;
create function lumo_private.save_club(p_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; c public.lumo_clubs; e jsonb; olde jsonb; recipient public.lumo_memberships; kind text; title text;
begin
 m=lumo_private.require_member(p_id); perform lumo_private.validate_payload(p_payload);
 select * into c from public.lumo_clubs where id=p_id for update;
 if c.revision is distinct from p_expected_revision then raise exception 'Une autre personne a modifié le club. Rechargez avant de réessayer.' using errcode='40001'; end if;
 if m.role='parent' then perform lumo_private.validate_parent_changes(c.payload,p_payload,m); end if;
 if p_payload->'notifications' is distinct from c.payload->'notifications' then raise exception 'Les notifications sont gérées par le serveur.'; end if;
 if c.payload is not distinct from p_payload then return lumo_private.context(p_id); end if;
 update public.lumo_clubs set payload=p_payload,name=p_payload->>'clubName',revision=revision+1,updated_at=now() where id=p_id;
 update public.lumo_memberships x set member_ids=array(select mid from unnest(x.member_ids) mid where exists(select 1 from jsonb_array_elements(p_payload->'members') v where v->>'id'=mid)) where club_id=p_id;
 for e in select value from jsonb_array_elements(p_payload->'events') loop
  select v into olde from jsonb_array_elements(c.payload->'events') v where v->>'id'=e->>'id'; kind=null;
  if e->'cancelled'='true' and (olde is null or olde->'cancelled' is distinct from e->'cancelled') then kind='cancelled'; title='Un événement est annulé';
  elsif e->'rosterPublished'='true' and (olde is null or olde->'rosterPublished' is distinct from e->'rosterPublished' or (select jsonb_agg(v-array['availability','transport']) from jsonb_array_elements(e->'attendees') v) is distinct from (select jsonb_agg(v-array['availability','transport']) from jsonb_array_elements(olde->'attendees') v)) then kind='roster'; title='Une convocation est disponible';
  elsif olde is not null and (e-array['attendees','offers','missions','notes','source']) is distinct from (olde-array['attendees','offers','missions','notes','source']) then kind='event_changed'; title='Les informations d’un événement ont changé'; end if;
  if kind is not null then
   for recipient in select * from public.lumo_memberships where club_id=p_id loop
    if recipient.role in ('admin','coach') or exists(select 1 from jsonb_array_elements(e->'attendees') v where (v->>'memberId')=any(recipient.member_ids)) then perform lumo_private.enqueue_notification(p_id,recipient.user_id,e->>'id',kind,title,'Consultez Lumo pour les détails et les horaires.',p_id||':'||(c.revision+1)||':'||(e->>'id')||':'||recipient.user_id); end if;
   end loop;
  end if;
 end loop;
 return lumo_private.context(p_id);
end $$;

create function lumo_private.register_push(p_id uuid,p_subscription jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; ep text=p_subscription->>'endpoint'; sid uuid;
begin
 m=lumo_private.require_member(p_id);
 if ep is null or ep!~'^https://[^/]+/' or length(ep)>2048 or coalesce(p_subscription#>>'{keys,p256dh}','')!~'^[A-Za-z0-9_-]{80,120}={0,2}$' or coalesce(p_subscription#>>'{keys,auth}','')!~'^[A-Za-z0-9_-]{20,30}={0,2}$' then raise exception 'Abonnement téléphone invalide.'; end if;
 insert into public.lumo_push_subscriptions(club_id,user_id,endpoint,subscription) values(p_id,m.user_id,ep,p_subscription) on conflict(club_id,user_id,endpoint) do update set subscription=excluded.subscription,updated_at=now() returning id into sid;
 insert into public.lumo_notification_preferences(club_id,user_id,push_enabled) values(p_id,m.user_id,true) on conflict(club_id,user_id) do update set push_enabled=true;
 return jsonb_build_object('id',sid,'push_enabled',true);
end $$;
create function lumo_private.unregister_push(p_id uuid,p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships;
begin
 m=lumo_private.require_member(p_id); delete from public.lumo_push_subscriptions where club_id=p_id and user_id=m.user_id and endpoint=p_endpoint;
 if not exists(select 1 from public.lumo_push_subscriptions where club_id=p_id and user_id=m.user_id) then update public.lumo_notification_preferences set push_enabled=false where club_id=p_id and user_id=m.user_id; end if;
end $$;
create function lumo_private.set_preferences(p_id uuid,p_push_enabled boolean,p_reminders_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; p public.lumo_notification_preferences;
begin
 m=lumo_private.require_member(p_id);
 insert into public.lumo_notification_preferences(club_id,user_id,push_enabled,reminders_enabled) values(p_id,m.user_id,p_push_enabled,p_reminders_enabled) on conflict(club_id,user_id) do update set push_enabled=excluded.push_enabled,reminders_enabled=excluded.reminders_enabled returning * into p;
 return to_jsonb(p);
end $$;
create function lumo_private.mark_read(p_notification_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 update public.lumo_notifications set read_at=coalesce(read_at,now()) where id=p_notification_id and user_id=auth.uid();
end $$;
create function lumo_private.test_notification(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; nid uuid;
begin
 m=lumo_private.require_member(p_id);
 if exists(select 1 from public.lumo_notifications where user_id=m.user_id and kind='test' and created_at>now()-interval '1 minute') then raise exception 'Attendez une minute entre deux tests.'; end if;
 nid=lumo_private.enqueue_notification(p_id,m.user_id,null,'test','Lumo vous tient au courant','Les notifications de votre club sont prêtes.',gen_random_uuid()::text);
 return jsonb_build_object('id',nid);
end $$;

create function public.create_lumo_club(p_name text,p_display_name text) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.create_club(p_name,p_display_name)$$;
create function public.join_lumo_club(p_code text,p_display_name text) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.join_club(p_code,p_display_name)$$;
create function public.lumo_context(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.context(p_id)$$;
create function public.save_lumo_club(p_id uuid,p_expected_revision bigint,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.save_club(p_id,p_expected_revision,p_payload)$$;
create function public.lumo_create_invite(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.create_invite(p_id)$$;
create function public.lumo_set_member_access(p_id uuid,p_user_id uuid,p_role text,p_member_ids text[]) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.set_member_access(p_id,p_user_id,p_role,p_member_ids)$$;
create function public.register_lumo_push(p_id uuid,p_subscription jsonb) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.register_push(p_id,p_subscription)$$;
create function public.unregister_lumo_push(p_id uuid,p_endpoint text) returns void language sql security invoker set search_path='' as $$select lumo_private.unregister_push(p_id,p_endpoint)$$;
create function public.lumo_set_notification_preferences(p_id uuid,p_push_enabled boolean,p_reminders_enabled boolean) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.set_preferences(p_id,p_push_enabled,p_reminders_enabled)$$;
create function public.lumo_mark_notification_read(p_notification_id uuid) returns void language sql security invoker set search_path='' as $$select lumo_private.mark_read(p_notification_id)$$;
create function public.lumo_test_notification(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.test_notification(p_id)$$;
-- Function allowlist: helpers cannot be invoked directly by a client.
revoke all on all functions in schema lumo_private from public,anon,authenticated;
revoke all on function public.create_lumo_club(text,text),public.join_lumo_club(text,text),public.lumo_context(uuid),public.save_lumo_club(uuid,bigint,jsonb),public.lumo_create_invite(uuid),public.lumo_set_member_access(uuid,uuid,text,text[]),public.register_lumo_push(uuid,jsonb),public.unregister_lumo_push(uuid,text),public.lumo_set_notification_preferences(uuid,boolean,boolean),public.lumo_mark_notification_read(uuid),public.lumo_test_notification(uuid) from public,anon;
grant execute on function public.create_lumo_club(text,text),public.join_lumo_club(text,text),public.lumo_context(uuid),public.save_lumo_club(uuid,bigint,jsonb),public.lumo_create_invite(uuid),public.lumo_set_member_access(uuid,uuid,text,text[]),public.register_lumo_push(uuid,jsonb),public.unregister_lumo_push(uuid,text),public.lumo_set_notification_preferences(uuid,boolean,boolean),public.lumo_mark_notification_read(uuid),public.lumo_test_notification(uuid) to authenticated;
grant execute on function lumo_private.role_for(uuid),lumo_private.create_club(text,text),lumo_private.join_club(text,text),lumo_private.context(uuid),lumo_private.save_club(uuid,bigint,jsonb),lumo_private.create_invite(uuid),lumo_private.set_member_access(uuid,uuid,text,text[]),lumo_private.register_push(uuid,jsonb),lumo_private.unregister_push(uuid,text),lumo_private.set_preferences(uuid,boolean,boolean),lumo_private.mark_read(uuid),lumo_private.test_notification(uuid) to authenticated;
grant execute on function lumo_private.enqueue_notification(uuid,uuid,text,text,text,text,text),lumo_private.validate_payload(jsonb) to service_role;
notify pgrst,'reload schema';
