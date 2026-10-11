-- Apply after supabase.sql. Server secrets stay in Supabase Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin
 if not exists(select 1 from vault.secrets where name='lumo_push_cron') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'lumo_push_cron','Lumo private worker authentication');
 end if;
end $$;

create or replace function lumo_private.push_runtime() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('cronToken',(select decrypted_secret from vault.decrypted_secrets where name='lumo_push_cron'),
  'publicKey',(select decrypted_secret from vault.decrypted_secrets where name='lumo_vapid_public'),
  'privateKey',(select decrypted_secret from vault.decrypted_secrets where name='lumo_vapid_private'))
$$;
create or replace function lumo_private.push_set_vapid(p_public text,p_private text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_public!~'^[A-Za-z0-9_-]{87}$' or p_private!~'^[A-Za-z0-9_-]{43}$' then raise exception 'Invalid VAPID key'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lumo-vapid-init',0));
 if not exists(select 1 from vault.secrets where name='lumo_vapid_private') then
  perform vault.create_secret(p_private,'lumo_vapid_private','Lumo Web Push signing key');
  perform vault.create_secret(p_public,'lumo_vapid_public','Lumo Web Push public application key');
 end if;
end $$;
create or replace function lumo_private.push_public_config(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pub text;
begin
 perform lumo_private.require_member(p_id);
 select decrypted_secret into pub from vault.decrypted_secrets where name='lumo_vapid_public';
 return jsonb_build_object('publicKey',pub,'configured',pub is not null);
end $$;

create or replace function lumo_private.push_claim_jobs(p_limit integer default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update lumo_private.lumo_push_jobs set state='failed',last_error='Expired' where state in ('pending','sending') and (attempts>=5 or created_at<now()-interval '1 day');
 with chosen as (
  select j.id from lumo_private.lumo_push_jobs j
  join public.lumo_push_subscriptions s on s.id=j.subscription_id
  join public.lumo_notifications n on n.id=j.notification_id
  join public.lumo_memberships m on m.club_id=s.club_id and m.user_id=s.user_id
  join public.lumo_notification_preferences p on p.club_id=s.club_id and p.user_id=s.user_id
  where j.state in ('pending','sending') and j.available_at<=now() and j.attempts<5
   and p.push_enabled and (n.kind<>'reminder' or p.reminders_enabled)
  order by j.available_at limit greatest(1,least(p_limit,100)) for update of j skip locked
 ), claimed as (
  update lumo_private.lumo_push_jobs j set state='sending',attempts=attempts+1,available_at=now()+interval '5 minutes'
  from chosen where j.id=chosen.id returning j.id,j.notification_id,j.subscription_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'notification_id',j.notification_id,'event_id',n.event_id,'subscription',s.subscription)),'[]'::jsonb)
 into result from claimed j join public.lumo_push_subscriptions s on s.id=j.subscription_id join public.lumo_notifications n on n.id=j.notification_id;
 return result;
end $$;
create or replace function lumo_private.push_complete_job(p_job_id uuid,p_status integer,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare job lumo_private.lumo_push_jobs;
begin
 select * into job from lumo_private.lumo_push_jobs where id=p_job_id for update;
 if not found then return; end if;
 if p_status in (404,410) then delete from public.lumo_push_subscriptions where id=job.subscription_id;return;end if;
 update lumo_private.lumo_push_jobs set
  state=case when p_status between 200 and 299 then 'sent' when attempts>=5 or p_status=400 then 'failed' else 'pending' end,
  last_error=case when p_status between 200 and 299 then null else left(coalesce(p_error,'Transport unavailable'),200) end,
  available_at=now()+make_interval(mins=>least(60,power(2,attempts)::integer))
 where id=p_job_id;
end $$;

create or replace function lumo_private.generate_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare club public.lumo_clubs; event jsonb; recipient public.lumo_memberships; start_at timestamptz; offset_hours integer; generated integer=0; nid uuid;
begin
 for club in select * from public.lumo_clubs loop
  for event in select value from jsonb_array_elements(club.payload->'events') loop
   if coalesce((event->>'cancelled')::boolean,false) then continue;end if;
   if coalesce(nullif(event->>'meetingTime',''),nullif(event->>'time','')) is null then continue;end if;
   start_at=((event->>'date')||' '||coalesce(nullif(event->>'meetingTime',''),event->>'time'))::timestamp at time zone 'Europe/Paris';
   foreach offset_hours in array array[24,2] loop
    -- Fifteen-minute recovery window prevents late, irrelevant reminders after an outage.
    if start_at-make_interval(hours=>offset_hours)>now() or start_at-make_interval(hours=>offset_hours)<now()-interval '15 minutes' then continue;end if;
    for recipient in select m.* from public.lumo_memberships m left join public.lumo_notification_preferences p using(club_id,user_id)
     where m.club_id=club.id and coalesce(p.reminders_enabled,true) loop
     if recipient.role not in ('admin','coach') and not exists(
      select 1 from jsonb_array_elements(event->'attendees') a where (a->>'memberId')=any(recipient.member_ids)
       and coalesce(a->>'availability','unknown')<>'absent'
       and (not coalesce((event->>'rosterPublished')::boolean,false) or coalesce((a->>'selected')::boolean,true))
     ) then continue;end if;
     nid=lumo_private.enqueue_notification(club.id,recipient.user_id,event->>'id','reminder',
      case when offset_hours=24 then 'Votre rendez-vous de demain' else 'Votre rendez-vous approche' end,
      (event->>'title')||' · Rendez-vous '||coalesce(nullif(event->>'meetingTime',''),event->>'time')||'. Vérifiez votre transport aller et retour.',
      'reminder:'||club.id||':'||(event->>'id')||':'||start_at::text||':'||offset_hours||':'||recipient.user_id);
     if nid is not null then generated=generated+1;end if;
    end loop;
   end loop;
  end loop;
 end loop;
 return generated;
end $$;

-- Public wrappers run as caller. Only narrowly scoped private implementations elevate.
create or replace function lumo_private.unregister_device(p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise.' using errcode='42501';end if;
 delete from public.lumo_push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint;
end $$;
create or replace function public.lumo_unregister_device(p_endpoint text) returns void language sql security invoker set search_path='' as $$select lumo_private.unregister_device(p_endpoint)$$;
revoke all on function lumo_private.unregister_device(text),public.lumo_unregister_device(text) from public,anon,authenticated;
grant execute on function lumo_private.unregister_device(text),public.lumo_unregister_device(text) to authenticated;
create or replace function public.lumo_push_runtime() returns jsonb language sql security invoker set search_path='' as $$select lumo_private.push_runtime()$$;
create or replace function public.lumo_push_set_vapid(p_public text,p_private text) returns void language sql security invoker set search_path='' as $$select lumo_private.push_set_vapid(p_public,p_private)$$;
create or replace function public.lumo_push_public_config(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.push_public_config(p_id)$$;
create or replace function public.claim_lumo_push_jobs(p_limit integer default 30) returns jsonb language sql security invoker set search_path='' as $$select lumo_private.push_claim_jobs(p_limit)$$;
create or replace function public.complete_lumo_push_job(p_job_id uuid,p_status integer,p_error text default null) returns void language sql security invoker set search_path='' as $$select lumo_private.push_complete_job(p_job_id,p_status,p_error)$$;
create or replace function public.lumo_generate_reminders() returns integer language sql security invoker set search_path='' as $$select lumo_private.generate_reminders()$$;

revoke all on function lumo_private.push_runtime(),lumo_private.push_set_vapid(text,text),lumo_private.push_public_config(uuid),lumo_private.push_claim_jobs(integer),lumo_private.push_complete_job(uuid,integer,text),lumo_private.generate_reminders() from public,anon,authenticated;
revoke all on function public.lumo_push_runtime(),public.lumo_push_set_vapid(text,text),public.lumo_push_public_config(uuid),public.claim_lumo_push_jobs(integer),public.complete_lumo_push_job(uuid,integer,text),public.lumo_generate_reminders() from public,anon,authenticated;
grant execute on function lumo_private.push_runtime(),lumo_private.push_set_vapid(text,text),lumo_private.push_claim_jobs(integer),lumo_private.push_complete_job(uuid,integer,text),lumo_private.generate_reminders(),public.lumo_push_runtime(),public.lumo_push_set_vapid(text,text),public.claim_lumo_push_jobs(integer),public.complete_lumo_push_job(uuid,integer,text),public.lumo_generate_reminders() to service_role;
grant execute on function lumo_private.push_public_config(uuid),public.lumo_push_public_config(uuid) to authenticated;

select cron.schedule('lumo-push-every-minute','* * * * *',$job$
 select net.http_post(url:='https://mxfgtcubzdhkmtcyqznp.supabase.co/functions/v1/lumo-push',
  headers:=jsonb_build_object('Content-Type','application/json','x-lumo-cron',(select decrypted_secret from vault.decrypted_secrets where name='lumo_push_cron')),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
$job$);
