-- Enfants ajoutés par les parents, parents séparés (invitation par enfant), réponses signées (answeredBy/answeredAt).
create table lumo_private.lumo_child_invites(id uuid primary key default gen_random_uuid(),code_hash bytea not null unique,club_id uuid not null references public.lumo_clubs(id) on delete cascade,member_id text not null check(length(member_id) between 1 and 160),created_by uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',used_at timestamptz,used_by uuid references auth.users(id) on delete set null);
create index lumo_child_invites_club_member_idx on lumo_private.lumo_child_invites(club_id,member_id);
create index lumo_child_invites_creator_idx on lumo_private.lumo_child_invites(created_by);
create index lumo_child_invites_used_by_idx on lumo_private.lumo_child_invites(used_by);
alter table lumo_private.lumo_child_invites enable row level security;
grant all on lumo_private.lumo_child_invites to service_role;

-- Le contexte expose aussi child_parents {member_id:[display_name]} (+ child_parent_links avec user_id pour délier).
create or replace function lumo_private.context(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; c public.lumo_clubs; members jsonb; prefs jsonb; cp jsonb; cl jsonb;
begin
 m=lumo_private.require_member(p_id); select * into c from public.lumo_clubs where id=p_id;
 select coalesce(jsonb_agg(to_jsonb(v)),'[]') into members from public.lumo_memberships v where club_id=p_id and (m.role='admin' or user_id=m.user_id);
 select to_jsonb(v) into prefs from public.lumo_notification_preferences v where club_id=p_id and user_id=m.user_id;
 select coalesce(jsonb_object_agg(x->>'id',coalesce((select jsonb_agg(ms.display_name order by ms.display_name,ms.user_id) from public.lumo_memberships ms where ms.club_id=p_id and (x->>'id')=any(ms.member_ids)),'[]')),'{}'),
  coalesce(jsonb_object_agg(x->>'id',coalesce((select jsonb_agg(jsonb_build_object('user_id',ms.user_id,'display_name',ms.display_name) order by ms.display_name,ms.user_id) from public.lumo_memberships ms where ms.club_id=p_id and (x->>'id')=any(ms.member_ids)),'[]')),'{}')
  into cp,cl from jsonb_array_elements(c.payload->'members') x where x->>'kind'='child' and (m.role in ('admin','coach') or (x->>'id')=any(m.member_ids));
 return jsonb_build_object('club',to_jsonb(c)-'payload','payload',c.payload,'revision',c.revision,'membership',to_jsonb(m),'memberships',members,'notification_preferences',coalesce(prefs,jsonb_build_object('push_enabled',false,'reminders_enabled',true)),'child_parents',cp,'child_parent_links',cl);
end $$;

-- Parents : en plus des réponses, signature answeredBy (= nom du compte) et answeredAt (date ISO).
create or replace function lumo_private.validate_parent_changes(oldp jsonb,newp jsonb,m public.lumo_memberships) returns void language plpgsql set search_path='' as $$
declare e jsonb; ne jsonb; a jsonb; na jsonb; o jsonb; no jsonb; mi jsonb; nm jsonb; g text;
begin
 if (oldp-'events'-'members') is distinct from (newp-'events'-'members') or jsonb_array_length(oldp->'events')<>jsonb_array_length(newp->'events') or jsonb_array_length(oldp->'members')<>jsonb_array_length(newp->'members') then raise exception 'Les parents ne peuvent pas modifier l’organisation.' using errcode='42501'; end if;
 for mi in select value from jsonb_array_elements(oldp->'members') loop
  select v into nm from jsonb_array_elements(newp->'members') v where v->>'id'=mi->>'id';
  if nm is null or (case when (mi->>'id')=any(m.member_ids) then (mi-'groups'-'defaults') is distinct from (nm-'groups'-'defaults') else mi is distinct from nm end) then raise exception 'Vous pouvez choisir les groupes uniquement de votre famille.' using errcode='42501'; end if;
 end loop;
 for e in select value from jsonb_array_elements(oldp->'events') loop
  select v into ne from jsonb_array_elements(newp->'events') v where v->>'id'=e->>'id';
  if ne is null or (e-array['attendees','offers','missions']) is distinct from (ne-array['attendees','offers','missions']) or jsonb_array_length(e->'attendees')<>jsonb_array_length(ne->'attendees') or jsonb_array_length(e->'missions')<>jsonb_array_length(ne->'missions') then raise exception 'Modification réservée au coach.' using errcode='42501'; end if;
  for a in select value from jsonb_array_elements(e->'attendees') loop
   select v into na from jsonb_array_elements(ne->'attendees') v where v->>'memberId'=a->>'memberId';
   if na is null or (a-array['availability','transport','answeredBy','answeredAt']) is distinct from (na-array['availability','transport','answeredBy','answeredAt']) or (not((a->>'memberId')=any(m.member_ids)) and a is distinct from na) then raise exception 'Vous pouvez répondre uniquement pour votre famille.' using errcode='42501'; end if;
   if a->'answeredBy' is distinct from na->'answeredBy' and na->'answeredBy' is distinct from to_jsonb(m.display_name) then raise exception 'La réponse doit être signée par votre compte.' using errcode='42501'; end if;
   if a->'answeredAt' is distinct from na->'answeredAt' and (jsonb_typeof(na->'answeredAt') is distinct from 'string' or (na->>'answeredAt')!~'^\d{4}-\d{2}-\d{2}T[0-9:.]{5,15}(Z|[+-]\d{2}:\d{2})$') then raise exception 'Date de réponse invalide.'; end if;
   if a->'answeredAt' is distinct from na->'answeredAt' then perform (na->>'answeredAt')::timestamptz; end if;
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

-- Tout membre ajoute un enfant lié à son compte (sans validation par un coach).
create function lumo_private.add_child(p_id uuid,p_name text,p_groups text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; c public.lumo_clubs; nm text=trim(p_name); g text; mid text; newp jsonb;
begin
 m=lumo_private.require_member(p_id);
 if nm is null or length(nm) not between 1 and 120 then raise exception 'Nom du participant invalide.'; end if;
 if p_groups is null or cardinality(p_groups)>10 or (select count(distinct x) from unnest(p_groups) x)<>cardinality(p_groups) then raise exception 'Groupes invalides.'; end if;
 select * into c from public.lumo_clubs where id=p_id for update;
 select * into m from public.lumo_memberships where club_id=p_id and user_id=m.user_id;
 foreach g in array p_groups loop if not exists(select 1 from jsonb_array_elements(c.payload->'groups') v where v->>'id'=g) then raise exception 'Groupe inconnu.'; end if; end loop;
 if (select count(*) from jsonb_array_elements(c.payload->'members') v where v->>'kind'='child' and (v->>'id')=any(m.member_ids))>=12 then raise exception 'Vous pouvez lier au maximum 12 enfants.'; end if;
 if exists(select 1 from jsonb_array_elements(c.payload->'members') v where v->>'kind'='child' and (v->>'id')=any(m.member_ids) and v->>'name'=nm) then raise exception 'Cet enfant est déjà enregistré.'; end if;
 mid='m-'||gen_random_uuid();
 newp=jsonb_set(c.payload,'{members}',(c.payload->'members')||jsonb_build_array(jsonb_build_object('id',mid,'name',nm,'kind','child','parentName',m.display_name,'groups',to_jsonb(p_groups))));
 perform lumo_private.validate_payload(newp);
 update public.lumo_clubs set payload=newp,revision=revision+1,updated_at=now() where id=p_id;
 update public.lumo_memberships set member_ids=array_append(member_ids,mid) where club_id=p_id and user_id=m.user_id;
 return lumo_private.context(p_id);
end $$;

-- Invitation à usage unique pour un autre parent d'un enfant lié (code stocké haché, valable 7 jours).
create function lumo_private.create_child_invite(p_id uuid,p_member_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; code text=replace(gen_random_uuid()::text,'-',''); r lumo_private.lumo_child_invites;
begin
 m=lumo_private.require_member(p_id);
 if p_member_id is null or not(p_member_id=any(m.member_ids)) then raise exception 'Cet enfant n’est pas lié à votre compte.' using errcode='42501'; end if;
 perform 1 from public.lumo_clubs where id=p_id for update;
 delete from lumo_private.lumo_child_invites where club_id=p_id and expires_at<now();
 if (select count(*) from lumo_private.lumo_child_invites where club_id=p_id and member_id=p_member_id and used_at is null and expires_at>now())>=5 then raise exception 'Trop d’invitations actives pour cet enfant.'; end if;
 insert into lumo_private.lumo_child_invites(code_hash,club_id,member_id,created_by) values(sha256(convert_to(code,'UTF8')),p_id,p_member_id,m.user_id) returning * into r;
 return jsonb_build_object('code',code,'expires_at',r.expires_at,'member_id',p_member_id);
end $$;
create function lumo_private.accept_child_invite(p_code text,p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid(); r lumo_private.lumo_child_invites; m public.lumo_memberships;
begin
 if uid is null then raise exception 'Connexion requise.' using errcode='42501'; end if;
 select * into r from lumo_private.lumo_child_invites where code_hash=sha256(convert_to(lower(trim(coalesce(p_code,''))),'UTF8')) and used_at is null and expires_at>now() for update;
 if not found or not exists(select 1 from public.lumo_clubs c where c.id=r.club_id and exists(select 1 from jsonb_array_elements(c.payload->'members') v where v->>'id'=r.member_id and v->>'kind'='child')) then raise exception 'INVALID_INVITE_CODE' using detail='Invitation inconnue ou expirée.'; end if;
 perform 1 from public.lumo_clubs where id=r.club_id for update;
 select * into m from public.lumo_memberships where club_id=r.club_id and user_id=uid;
 if not found then
  if p_display_name is null or length(trim(p_display_name)) not between 2 and 100 then raise exception 'Indiquez votre nom.'; end if;
  insert into public.lumo_memberships(club_id,user_id,display_name) values(r.club_id,uid,trim(p_display_name)) returning * into m;
  insert into public.lumo_notification_preferences(club_id,user_id) values(r.club_id,uid) on conflict do nothing;
 end if;
 if not(r.member_id=any(m.member_ids)) then
  if (select count(*) from public.lumo_clubs c cross join jsonb_array_elements(c.payload->'members') v where c.id=r.club_id and v->>'kind'='child' and (v->>'id')=any(m.member_ids))>=12 then raise exception 'Vous pouvez lier au maximum 12 enfants.'; end if;
  update public.lumo_memberships set member_ids=array_append(member_ids,r.member_id) where club_id=r.club_id and user_id=uid;
 end if;
 update lumo_private.lumo_child_invites set used_at=now(),used_by=uid where id=r.id;
 return lumo_private.context(r.club_id);
end $$;
create function lumo_private.unlink_child(p_id uuid,p_member_id text,p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships;
begin
 m=lumo_private.require_member(p_id);
 perform 1 from public.lumo_clubs where id=p_id for update;
 select * into m from public.lumo_memberships where club_id=p_id and user_id=m.user_id;
 if p_member_id is null or p_user_id is null or not(p_member_id=any(m.member_ids)) then raise exception 'Cet enfant n’est pas lié à votre compte.' using errcode='42501'; end if;
 if not exists(select 1 from public.lumo_memberships where club_id=p_id and user_id=p_user_id and p_member_id=any(member_ids)) then raise exception 'Ce compte n’est pas lié à cet enfant.'; end if;
 if not exists(select 1 from public.lumo_memberships where club_id=p_id and user_id<>p_user_id and p_member_id=any(member_ids)) then raise exception 'Il doit rester au moins un parent lié à cet enfant.'; end if;
 update public.lumo_memberships set member_ids=array_remove(member_ids,p_member_id) where club_id=p_id and user_id=p_user_id;
 return lumo_private.context(p_id);
end $$;

create function public.lumo_add_child(p_id uuid,p_name text,p_groups text[]) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.add_child(p_id,p_name,p_groups)$$;
create function public.lumo_create_child_invite(p_id uuid,p_member_id text) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.create_child_invite(p_id,p_member_id)$$;
create function public.lumo_accept_child_invite(p_code text,p_display_name text) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.accept_child_invite(p_code,p_display_name)$$;
create function public.lumo_unlink_child(p_id uuid,p_member_id text,p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.unlink_child(p_id,p_member_id,p_user_id)$$;
revoke all on function lumo_private.add_child(uuid,text,text[]),lumo_private.create_child_invite(uuid,text),lumo_private.accept_child_invite(text,text),lumo_private.unlink_child(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.lumo_add_child(uuid,text,text[]),public.lumo_create_child_invite(uuid,text),public.lumo_accept_child_invite(text,text),public.lumo_unlink_child(uuid,text,uuid) from public,anon;
grant execute on function public.lumo_add_child(uuid,text,text[]),public.lumo_create_child_invite(uuid,text),public.lumo_accept_child_invite(text,text),public.lumo_unlink_child(uuid,text,uuid) to authenticated;
grant execute on function lumo_private.add_child(uuid,text,text[]),lumo_private.create_child_invite(uuid,text),lumo_private.accept_child_invite(text,text),lumo_private.unlink_child(uuid,text,uuid) to authenticated;

-- Coups de main choisis par chaque compte (to_jsonb(membership) expose helps et helps_set).
alter table public.lumo_memberships add column helps text[] not null default '{}',add column helps_set boolean not null default false;
create function lumo_private.set_helps(p_id uuid,p_helps text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; h text[];
begin
 m=lumo_private.require_member(p_id);
 if p_helps is null or cardinality(p_helps)>8 or exists(select 1 from unnest(p_helps) x where x is null or x<>all(array['arbitrage','table','salle','buvette','gouter','gateaux','maillots','accompagnement'])) then raise exception 'Coup de main inconnu.'; end if;
 select coalesce(array_agg(x order by o),'{}') into h from (select x,min(o) o from unnest(p_helps) with ordinality t(x,o) group by x) s;
 update public.lumo_memberships set helps=h,helps_set=true where club_id=p_id and user_id=m.user_id;
 return lumo_private.context(p_id);
end $$;
create function public.lumo_set_helps(p_id uuid,p_helps text[]) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.set_helps(p_id,p_helps)$$;
revoke all on function lumo_private.set_helps(uuid,text[]) from public,anon,authenticated;
revoke all on function public.lumo_set_helps(uuid,text[]) from public,anon;
grant execute on function public.lumo_set_helps(uuid,text[]) to authenticated;
grant execute on function lumo_private.set_helps(uuid,text[]) to authenticated;
notify pgrst,'reload schema';
