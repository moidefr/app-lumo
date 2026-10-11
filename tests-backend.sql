-- Run with execute_sql against the deployed schema. All users and data are rolled back.
-- Assertions run as authenticated/anon, not merely as the database owner.
begin;
do $$
declare admin_id uuid=gen_random_uuid(); parent_id uuid=gen_random_uuid(); other_id uuid=gen_random_uuid(); club_id uuid; other_club uuid; ctx jsonb; payload jsonb; candidate jsonb; invitation jsonb; rev bigint; result_count bigint; nid uuid;
begin
 insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 (admin_id,'lumo-test-'||admin_id||'@example.invalid','',now(),'{"provider":"email","providers":["email"]}','{}'),
 (parent_id,'lumo-test-'||parent_id||'@example.invalid','',now(),'{"provider":"email","providers":["email"]}','{}'),
 (other_id,'lumo-test-'||other_id||'@example.invalid','',now(),'{"provider":"email","providers":["email"]}','{}');
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 ctx=public.create_lumo_club('Club de test transactionnel','Admin test'); club_id=(ctx#>>'{club,id}')::uuid;
 if ctx#>>'{membership,role}'<>'admin' or jsonb_array_length(ctx#>'{payload,members}')<>0 or jsonb_array_length(ctx#>'{payload,events}')<>0 then raise exception 'FAIL: clean initial club'; end if;
 invitation=public.lumo_create_invite(club_id);
 if length(invitation->>'code')<>32 or (invitation->>'expires_at')::timestamptz<now()+interval '6 days' then raise exception 'FAIL: invitation entropy/expiry'; end if;
 payload=ctx->'payload';
 payload=jsonb_set(payload,'{members}','[{"id":"child1","name":"Enfant test 1","kind":"child","parentName":"Parent test","groups":["g13f"]},{"id":"child2","name":"Enfant test 2","kind":"child","parentName":"Autre parent","groups":["g13f"]}]');
 payload=jsonb_set(payload,'{events}',jsonb_build_array(jsonb_build_object('id','event-test','title','Match test','type','match','groups',jsonb_build_array('g13f'),'date','2030-10-12','time','14:00','meetingTime','13:00','meetingAddress','Parking','address','Gymnase','notes','','cancelled',false,'rosterPublished',false,'transportMode','pool','attendees','[{"memberId":"child1","availability":"unknown","selected":true,"team":"A","transport":{"outbound":"need","return":"need"}},{"memberId":"child2","availability":"unknown","selected":true,"team":"A","transport":{"outbound":"need","return":"need"}}]'::jsonb,'offers','[]'::jsonb,'missions','[{"id":"mission1","name":"Table de marque","needed":2,"assigned":[]}]'::jsonb)));
 ctx=public.save_lumo_club(club_id,1,payload);
 if (ctx->>'revision')::int<>2 then raise exception 'FAIL: revision increment'; end if;
 begin perform public.save_lumo_club(club_id,1,payload); raise exception 'FAIL: stale revision accepted'; exception when serialization_failure then null; end;
 candidate=jsonb_set(payload,'{events,0,date}','"2030-02-31"');
 begin perform public.save_lumo_club(club_id,2,candidate); raise exception 'FAIL: invalid date accepted'; exception when datetime_field_overflow then null; end;
 candidate=jsonb_set(payload,'{groups,0,parentId}','"g13f"');
 begin perform public.save_lumo_club(club_id,2,candidate); raise exception 'FAIL: group cycle accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',parent_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated')::text,true);
 ctx=public.join_lumo_club(invitation->>'code','Parent test');
 if ctx#>>'{membership,role}'<>'parent' or jsonb_array_length(ctx->'memberships')<>1 then raise exception 'FAIL: parent default/privacy'; end if;
 begin perform public.lumo_create_invite(club_id); raise exception 'FAIL: parent invitation allowed'; exception when insufficient_privilege then null; end;
 begin perform public.lumo_set_member_access(club_id,parent_id,'admin','{}'); raise exception 'FAIL: self role promotion allowed'; exception when insufficient_privilege then null; end;
 begin perform public.join_lumo_club(repeat('f',32),'Parent test'); raise exception 'FAIL: invalid invite accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 candidate=jsonb_set(payload,'{events,0,attendees,0,availability}','"present"');
 begin perform public.save_lumo_club(club_id,2,candidate); raise exception 'FAIL: unlinked family update accepted'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 ctx=public.lumo_set_member_access(club_id,parent_id,'parent',array['child1']);
 if jsonb_array_length(ctx->'memberships')<>2 then raise exception 'FAIL: admin member list'; end if;
 begin perform public.lumo_set_member_access(club_id,admin_id,'parent','{}'); raise exception 'FAIL: owner demotion'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',parent_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated')::text,true);
 ctx=public.save_lumo_club(club_id,2,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 candidate=jsonb_set(payload,'{events,0,attendees,1,availability}','"present"');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: another family update'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,attendees,0,team}','"B"');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent changes team'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,rosterPublished}','true');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent publishes roster'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,title}','"Pirated match"');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent changes event'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,offers}',jsonb_build_array(jsonb_build_object('id','car-test','driver','Parent test','parentOf','Enfant test 1','ownerUserId',parent_id,'totalSeats',5,'onboard',jsonb_build_array('child1'),'backup',true,'legs','{"outbound":{"enabled":true,"offered":3,"reserved":0},"return":{"enabled":true,"offered":3,"reserved":0}}'::jsonb)));
 ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 candidate=jsonb_set(payload,'{events,0,offers,0,legs,outbound,offered}','4');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: capacity overflow'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 candidate=jsonb_set(payload,'{events,0,offers,0,onboard}','["child2"]');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent claims other onboard'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,offers,0,ownerUserId}',to_jsonb(admin_id::text));
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: car owner spoof'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,missions,0,assigned}','["Parent test"]'); ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 candidate=jsonb_set(payload,'{events,0,missions,0,assigned}','["Parent test","Other person"]');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: volunteering spoof'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,attendees,0,transport,outbound}','"confirmed"'); ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 candidate=jsonb_set(payload,'{events,0,offers}','[]');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: confirmed reservation without seats'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 -- Direct writes must fail even to the caller's own membership/club.
 begin update public.lumo_memberships set role='admin' where user_id=parent_id; raise exception 'FAIL: direct membership update'; exception when insufficient_privilege then null; end;
 begin update public.lumo_clubs set name='Direct write'; raise exception 'FAIL: direct club update'; exception when insufficient_privilege then null; end;
 ctx=public.lumo_test_notification(club_id); nid=(ctx->>'id')::uuid;
 perform public.lumo_mark_notification_read(nid);
 if not exists(select 1 from public.lumo_notifications where id=nid and read_at is not null) then raise exception 'FAIL: notification own read'; end if;
 begin perform public.lumo_test_notification(club_id); raise exception 'FAIL: test notification rate limit'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 if exists(select 1 from public.lumo_notifications where id=nid) then raise exception 'FAIL: another user notification visible'; end if;
 candidate=jsonb_set(payload,'{events,0,rosterPublished}','true'); ctx=public.save_lumo_club(club_id,rev,candidate);
 if not exists(select 1 from public.lumo_notifications where kind='roster') then raise exception 'FAIL: admin roster notification'; end if;
 perform set_config('request.jwt.claim.sub',parent_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated')::text,true);
 if not exists(select 1 from public.lumo_notifications where kind='roster') then raise exception 'FAIL: linked family roster notification'; end if;
 perform set_config('request.jwt.claim.sub',other_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
 ctx=public.create_lumo_club('Autre club transactionnel','Autre admin'); other_club=(ctx#>>'{club,id}')::uuid;
 if (select count(*) from public.lumo_clubs)<>1 then raise exception 'FAIL: clubs RLS isolation'; end if;
 if exists(select 1 from public.lumo_notifications) then raise exception 'FAIL: notification RLS isolation'; end if;
 begin perform public.lumo_context(club_id); raise exception 'FAIL: non-member context'; exception when insufficient_privilege then null; end;
 begin perform public.save_lumo_club(club_id,rev,payload); raise exception 'FAIL: non-member save'; exception when insufficient_privilege then null; end;
 execute 'set local role anon';
 begin perform public.lumo_context(club_id); raise exception 'FAIL: anonymous RPC'; exception when insufficient_privilege then null; end;
 begin perform count(*) from public.lumo_clubs; raise exception 'FAIL: anonymous table'; exception when insufficient_privilege then null; end;
 execute 'reset role';
end $$;
select 'PASS: real authenticated/anon RLS, roles, linked family, vehicle ownership/capacity, volunteering, notifications, CAS and clean workspace' as result;
rollback;
