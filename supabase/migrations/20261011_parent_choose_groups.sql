create or replace function lumo_private.validate_parent_changes(oldp jsonb,newp jsonb,m public.lumo_memberships) returns void language plpgsql set search_path='' as $$
declare e jsonb; ne jsonb; a jsonb; na jsonb; o jsonb; no jsonb; mi jsonb; nm jsonb; g text;
begin
 if (oldp-'events'-'members') is distinct from (newp-'events'-'members') or jsonb_array_length(oldp->'events')<>jsonb_array_length(newp->'events') or jsonb_array_length(oldp->'members')<>jsonb_array_length(newp->'members') then raise exception 'Les parents ne peuvent pas modifier l’organisation.' using errcode='42501'; end if;
 for mi in select value from jsonb_array_elements(oldp->'members') loop
  select v into nm from jsonb_array_elements(newp->'members') v where v->>'id'=mi->>'id';
  if nm is null or (case when (mi->>'id')=any(m.member_ids) then (mi-'groups') is distinct from (nm-'groups') else mi is distinct from nm end) then raise exception 'Vous pouvez choisir les groupes uniquement de votre famille.' using errcode='42501'; end if;
 end loop;
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
