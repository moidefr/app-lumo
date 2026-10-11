-- Accès des parents par lien, sans compte (voir supabase.sql). validate_payload accepte ownerUserId absent ou 'link'.
create or replace function lumo_private.validate_payload(p jsonb) returns void language plpgsql set search_path='' as $$
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
   if jsonb_typeof(o->'driver') is distinct from 'string' or length(trim(o->>'driver')) not between 1 and 120 or coalesce(o->>'totalSeats','')!~'^[2-9]$' or jsonb_typeof(o->'onboard') is distinct from 'array' or (coalesce(o->>'ownerUserId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and coalesce(o->>'ownerUserId','link')<>'link') then raise exception 'Voiture invalide.'; end if;
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

-- Accès des parents par lien, sans compte. Jeton secret par club (lisible par les admins/coachs), RPC anon + authenticated.
create table lumo_private.lumo_family_links(club_id uuid primary key references public.lumo_clubs(id) on delete cascade,token text not null unique check(length(token)>=24),created_at timestamptz not null default now());
alter table lumo_private.lumo_family_links enable row level security;
grant all on lumo_private.lumo_family_links to service_role;
grant usage on schema lumo_private to anon;

create function lumo_private.link_club_id(p_token text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare cid uuid;
begin
 select club_id into cid from lumo_private.lumo_family_links where token=p_token;
 if p_token is null or cid is null then raise exception 'INVALID_LINK' using detail='Lien inconnu ou remplacé.'; end if;
 return cid;
end $$;
create function lumo_private.link_view(c public.lumo_clubs) returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('club',jsonb_build_object('id',c.id,'name',c.name,'revision',c.revision),'payload',c.payload)$$;
create function lumo_private.family_link(p_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; t text;
begin
 m=lumo_private.require_member(p_id); if m.role not in ('admin','coach') then raise exception 'Accès coach requis.' using errcode='42501'; end if;
 insert into lumo_private.lumo_family_links(club_id,token) values(p_id,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')) on conflict(club_id) do nothing;
 select token into t from lumo_private.lumo_family_links where club_id=p_id;
 return t;
end $$;
create function lumo_private.rotate_family_link(p_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare m public.lumo_memberships; t text=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
 m=lumo_private.require_member(p_id); if m.role<>'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
 insert into lumo_private.lumo_family_links(club_id,token) values(p_id,t) on conflict(club_id) do update set token=excluded.token,created_at=now();
 return t;
end $$;
create function lumo_private.link_open(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.lumo_clubs;
begin
 select * into c from public.lumo_clubs where id=lumo_private.link_club_id(p_token);
 return lumo_private.link_view(c);
end $$;

-- Lien famille : seules réponses, voitures et inscriptions aux missions peuvent changer.
create function lumo_private.validate_link_changes(oldp jsonb,newp jsonb) returns void language plpgsql set search_path='' as $$
declare e jsonb; ne jsonb; a jsonb; na jsonb; o jsonb; no jsonb; mi jsonb; nm jsonb; v jsonb;
begin
 if (oldp-'events') is distinct from (newp-'events') or jsonb_array_length(oldp->'events')<>jsonb_array_length(newp->'events') then raise exception 'Le lien famille ne permet pas de modifier l’organisation.' using errcode='42501'; end if;
 for e in select value from jsonb_array_elements(oldp->'events') loop
  select x into ne from jsonb_array_elements(newp->'events') x where x->>'id'=e->>'id';
  if ne is null or (e-array['attendees','offers','missions']) is distinct from (ne-array['attendees','offers','missions']) or jsonb_array_length(e->'attendees')<>jsonb_array_length(ne->'attendees') or jsonb_array_length(e->'missions')<>jsonb_array_length(ne->'missions') then raise exception 'Modification réservée au coach.' using errcode='42501'; end if;
  for a in select value from jsonb_array_elements(e->'attendees') loop
   select x into na from jsonb_array_elements(ne->'attendees') x where x->>'memberId'=a->>'memberId';
   if na is null or (a-array['availability','transport','answeredBy','answeredAt']) is distinct from (na-array['availability','transport','answeredBy','answeredAt']) then raise exception 'Seules les réponses peuvent être modifiées.' using errcode='42501'; end if;
   if a->'answeredBy' is distinct from na->'answeredBy' and (coalesce(jsonb_typeof(na->'answeredBy'),'null') not in ('null','string') or length(coalesce(na->>'answeredBy',''))>60) then raise exception 'Signature invalide.'; end if;
   if a->'answeredAt' is distinct from na->'answeredAt' and coalesce(jsonb_typeof(na->'answeredAt'),'null')<>'null' then
    if jsonb_typeof(na->'answeredAt')<>'string' or (na->>'answeredAt')!~'^\d{4}-\d{2}-\d{2}T[0-9:.]{5,15}(Z|[+-]\d{2}:\d{2})$' then raise exception 'Date de réponse invalide.'; end if;
    perform (na->>'answeredAt')::timestamptz;
   end if;
  end loop;
  for no in select value from jsonb_array_elements(ne->'offers') loop
   select x into o from jsonb_array_elements(e->'offers') x where x->>'id'=no->>'id';
   if o is null then
    if coalesce(no->>'ownerUserId','link')<>'link' then raise exception 'Voiture du lien : propriétaire invalide.' using errcode='42501'; end if;
   elsif o->'ownerUserId' is distinct from no->'ownerUserId' then raise exception 'Le propriétaire d’une voiture ne change pas.' using errcode='42501'; end if;
  end loop;
  for mi in select value from jsonb_array_elements(e->'missions') loop
   select x into nm from jsonb_array_elements(ne->'missions') x where x->>'id'=mi->>'id';
   if nm is null or (mi-'assigned') is distinct from (nm-'assigned') then raise exception 'Mission réservée au coach.' using errcode='42501'; end if;
   for v in select value from jsonb_array_elements(nm->'assigned') loop
    if jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 60 then raise exception 'Nom de bénévole invalide.'; end if;
   end loop;
  end loop;
 end loop;
end $$;
create function lumo_private.link_save(p_token text,p_expected_revision bigint,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid=lumo_private.link_club_id(p_token); c public.lumo_clubs;
begin
 perform lumo_private.validate_payload(p_payload);
 select * into c from public.lumo_clubs where id=cid for update;
 if c.revision is distinct from p_expected_revision then raise exception 'Une autre personne a modifié le club. Rechargez avant de réessayer.' using errcode='40001'; end if;
 perform lumo_private.validate_link_changes(c.payload,p_payload);
 if c.payload is not distinct from p_payload then return lumo_private.link_view(c); end if;
 update public.lumo_clubs set payload=p_payload,revision=revision+1,updated_at=now() where id=cid returning * into c;
 return lumo_private.link_view(c);
end $$;
create function lumo_private.link_add_child(p_token text,p_name text,p_group_ids text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid=lumo_private.link_club_id(p_token); c public.lumo_clubs; nm text=trim(p_name); g text; mid text='m-'||gen_random_uuid(); newp jsonb; evs jsonb;
begin
 if nm is null or length(nm) not between 1 and 60 then raise exception 'Nom du participant invalide.'; end if;
 if p_group_ids is null or cardinality(p_group_ids)>5 or (select count(distinct x) from unnest(p_group_ids) x)<>cardinality(p_group_ids) then raise exception 'Groupes invalides.'; end if;
 select * into c from public.lumo_clubs where id=cid for update;
 foreach g in array p_group_ids loop if g is null or not exists(select 1 from jsonb_array_elements(c.payload->'groups') v where v->>'id'=g) then raise exception 'Groupe inconnu.'; end if; end loop;
 if jsonb_array_length(c.payload->'members')>=300 then raise exception 'Le club a atteint 300 participants.'; end if;
 if exists(select 1 from jsonb_array_elements(c.payload->'members') v where lower(v->>'name')=lower(nm)) then raise exception 'Ce participant est déjà enregistré.'; end if;
 select coalesce(jsonb_agg(case when (ev->>'date')::date>=current_date and ev->'cancelled' is distinct from 'true'::jsonb and exists(select 1 from jsonb_array_elements_text(ev->'groups') eg where eg=any(p_group_ids)) then jsonb_set(ev,'{attendees}',(ev->'attendees')||jsonb_build_array(jsonb_build_object('memberId',mid,'availability','unknown','selected',true,'team','','transport',jsonb_build_object('outbound','need','return','need')))) else ev end order by o),'[]') into evs from jsonb_array_elements(c.payload->'events') with ordinality t(ev,o);
 newp=jsonb_set(jsonb_set(c.payload,'{members}',(c.payload->'members')||jsonb_build_array(jsonb_build_object('id',mid,'name',nm,'kind','child','parentName','','groups',to_jsonb(p_group_ids)))),'{events}',evs);
 perform lumo_private.validate_payload(newp);
 update public.lumo_clubs set payload=newp,revision=revision+1,updated_at=now() where id=cid returning * into c;
 return lumo_private.link_view(c);
end $$;

create function public.lumo_family_link(p_id uuid) returns text language sql security invoker set search_path='' as $$select lumo_private.family_link(p_id)$$;
create function public.lumo_rotate_family_link(p_id uuid) returns text language sql security invoker set search_path='' as $$select lumo_private.rotate_family_link(p_id)$$;
create function public.lumo_link_open(p_token text) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.link_open(p_token)$$;
create function public.lumo_link_save(p_token text,p_expected_revision bigint,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.link_save(p_token,p_expected_revision,p_payload)$$;
create function public.lumo_link_add_child(p_token text,p_name text,p_group_ids text[]) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.link_add_child(p_token,p_name,p_group_ids)$$;
revoke all on function lumo_private.link_club_id(text),lumo_private.link_view(public.lumo_clubs),lumo_private.family_link(uuid),lumo_private.rotate_family_link(uuid),lumo_private.link_open(text),lumo_private.validate_link_changes(jsonb,jsonb),lumo_private.link_save(text,bigint,jsonb),lumo_private.link_add_child(text,text,text[]) from public,anon,authenticated;
revoke all on function public.lumo_family_link(uuid),public.lumo_rotate_family_link(uuid),public.lumo_link_open(text),public.lumo_link_save(text,bigint,jsonb),public.lumo_link_add_child(text,text,text[]) from public,anon,authenticated;
grant execute on function public.lumo_family_link(uuid),public.lumo_rotate_family_link(uuid) to authenticated;
grant execute on function lumo_private.family_link(uuid),lumo_private.rotate_family_link(uuid) to authenticated;
grant execute on function public.lumo_link_open(text),public.lumo_link_save(text,bigint,jsonb),public.lumo_link_add_child(text,text,text[]) to anon,authenticated;
grant execute on function lumo_private.link_open(text),lumo_private.link_save(text,bigint,jsonb),lumo_private.link_add_child(text,text,text[]) to anon,authenticated;
notify pgrst,'reload schema';
