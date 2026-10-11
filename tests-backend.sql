-- Run with execute_sql against the deployed schema. All users and data are rolled back.
-- Assertions run as authenticated/anon, not merely as the database owner.
begin;
do $$
declare g2 text; admin_id uuid=gen_random_uuid(); parent_id uuid=gen_random_uuid(); other_id uuid=gen_random_uuid(); club_id uuid; other_club uuid; ctx jsonb; payload jsonb; candidate jsonb; invitation jsonb; rev bigint; result_count bigint; nid uuid;
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
 execute 'set local role authenticated';
 -- Parent: choix des groupes (uniquement participants liés)
 perform set_config('request.jwt.claim.sub',admin_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 ctx=public.lumo_context(club_id); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint; g2=payload#>>'{groups,1,id}';
 perform set_config('request.jwt.claim.sub',parent_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated')::text,true);
 candidate=jsonb_set(payload,'{members,0,groups}',to_jsonb(array['g13f',g2]));
 ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 if payload#>'{members,0,groups}'<>jsonb_build_array('g13f',g2) then raise exception 'FAIL: parent linked child groups not saved'; end if;
 candidate=jsonb_set(payload,'{members,1,groups}',jsonb_build_array(g2));
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent changes unlinked child groups'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{groups}',(payload->'groups')||jsonb_build_array(jsonb_set(payload->'groups'->0,'{id}','"gnew"')));
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent adds group'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events}',(payload->'events')||jsonb_build_array(jsonb_set(payload->'events'->0,'{id}','"event-new"')));
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent adds event'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,title}','"Pirated"');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent edits event'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{members,0,name}','"Renamed"');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent renames participant'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{members}',(payload->'members')||'[{"id":"child3","name":"Enfant 3","kind":"child","parentName":"X","groups":["g13f"]}]'::jsonb);
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent adds participant'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,attendees,0,availability}','"present"');
 ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 -- Parent: réponses par défaut (defaults) uniquement pour les participants liés
 candidate=jsonb_set(payload,'{members,0,defaults}','{"availability":"present","transport":{"outbound":"need","return":"need"}}'::jsonb);
 ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 if payload#>>'{members,0,defaults,availability}'<>'present' then raise exception 'FAIL: parent linked child defaults not saved'; end if;
 candidate=jsonb_set(payload,'{members,1,defaults}','{"availability":"present"}'::jsonb);
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent changes unlinked child defaults'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{members,0,kind}','"adult"');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent changes linked participant kind'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(jsonb_set(payload,'{members,0,defaults}','{"availability":"absent"}'::jsonb),'{members,0,name}','"Renamed"');
 begin perform public.save_lumo_club(club_id,rev,candidate); raise exception 'FAIL: parent renames while editing defaults'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(jsonb_set(payload,'{events,0,attendees,0,availability}','"absent"'),'{events,0,attendees,0,transport,return}','"parent"');
 ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 if payload#>>'{events,0,attendees,0,availability}'<>'absent' then raise exception 'FAIL: parent attendee answer not saved'; end if;
 candidate=jsonb_set(jsonb_set(payload,'{members,0,groups}',jsonb_build_array(g2)),'{members,0,defaults}','{"availability":"unknown"}'::jsonb);
 ctx=public.save_lumo_club(club_id,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 if payload#>'{members,0,groups}'<>jsonb_build_array(g2) then raise exception 'FAIL: parent groups still editable with defaults'; end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 candidate=jsonb_set(jsonb_set(payload,'{members,1,groups}',jsonb_build_array(g2)),'{members,1,name}','"Admin renamed"');
 ctx=public.save_lumo_club(club_id,rev,candidate);
 if ctx#>>'{payload,members,1,name}'<>'Admin renamed' then raise exception 'FAIL: admin full edit'; end if;
 execute 'reset role';
end $$;
-- Enfants ajoutés par les parents, parents séparés (invitation par enfant), réponses signées.
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub',u::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true); end $$;
do $$
declare adm uuid=gen_random_uuid(); a uuid=gen_random_uuid(); b uuid=gen_random_uuid(); x uuid=gen_random_uuid(); y uuid=gen_random_uuid(); club uuid; ctx jsonb; payload jsonb; candidate jsonb; invitation jsonb; ci jsonb; ci2 jsonb; code1 text; mid text; mid2 text; rev bigint; i int; n int;
begin
 insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select u,'lumo-test-'||u||'@example.invalid','',now(),'{"provider":"email","providers":["email"]}','{}' from unnest(array[adm,a,b,x,y]) u;
 perform pg_temp.as_user(adm); execute 'set local role authenticated';
 ctx=public.create_lumo_club('Club enfants transactionnel','Admin test'); club=(ctx#>>'{club,id}')::uuid; invitation=public.lumo_create_invite(club);
 perform pg_temp.as_user(a); ctx=public.join_lumo_club(invitation->>'code','Parent A');
 perform pg_temp.as_user(x); ctx=public.join_lumo_club(invitation->>'code','Parent X');
 if ctx->'child_parents'<>'{}'::jsonb then raise exception 'FAIL: unlinked parent sees child_parents'; end if;
 begin perform public.lumo_add_child(club,'Enfant',array['g13f']); perform pg_temp.as_user(y); perform public.lumo_add_child(club,'Enfant',array['g13f']); raise exception 'FAIL: non-member add child'; exception when insufficient_privilege then null; end;
 -- A ajoute des enfants
 perform pg_temp.as_user(a);
 ctx=public.lumo_add_child(club,'  Léo  ',array['g13g']); rev=(ctx->>'revision')::bigint;
 mid=(select v->>'id' from jsonb_array_elements(ctx#>'{payload,members}') v where v->>'name'='Léo');
 if rev<>2 or mid is null or not(mid=any(array(select jsonb_array_elements_text(ctx#>'{membership,member_ids}')))) or ctx#>>'{payload,members,0,kind}'<>'child' or ctx#>>'{payload,members,0,parentName}'<>'Parent A' or ctx#>'{payload,members,0,groups}'<>'["g13g"]'::jsonb or mid not like 'm-%' then raise exception 'FAIL: add child linked/revision'; end if;
 if ctx->'child_parents'<>jsonb_build_object(mid,jsonb_build_array('Parent A')) then raise exception 'FAIL: child_parents after add'; end if;
 begin perform public.lumo_add_child(club,'Léo',array['g13f']); raise exception 'FAIL: duplicate child accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 begin perform public.lumo_add_child(club,'Zoé',array['inconnu']); raise exception 'FAIL: unknown group accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 begin perform public.lumo_add_child(club,'   ',array['g13f']); raise exception 'FAIL: empty child name accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 ctx=public.lumo_add_child(club,'Zoé',array['g13f']); mid2=(select v->>'id' from jsonb_array_elements(ctx#>'{payload,members}') v where v->>'name'='Zoé');
 if (ctx->>'revision')::bigint<>3 then raise exception 'FAIL: second add revision'; end if;
 -- un événement avec les deux enfants (par l'admin)
 perform pg_temp.as_user(adm); ctx=public.lumo_context(club); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 if not(ctx->'child_parents' ?& array[mid,mid2]) then raise exception 'FAIL: admin sees all children parents'; end if;
 payload=jsonb_set(payload,'{events}',jsonb_build_array(jsonb_build_object('id','event-kids','title','Entraînement','type','training','groups',jsonb_build_array('g13f'),'date','2030-10-12','time','14:00','meetingTime','13:00','meetingAddress','','address','Gymnase','notes','','cancelled',false,'rosterPublished',false,'transportMode','pool','attendees',jsonb_build_array(jsonb_build_object('memberId',mid,'availability','unknown','selected',true,'team','A','transport','{"outbound":"unknown","return":"unknown"}'::jsonb),jsonb_build_object('memberId',mid2,'availability','unknown','selected',true,'team','A','transport','{"outbound":"unknown","return":"unknown"}'::jsonb)),'offers','[]'::jsonb,'missions','[]'::jsonb)));
 ctx=public.save_lumo_club(club,rev,payload); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 -- invitation par enfant
 perform pg_temp.as_user(x);
 begin perform public.lumo_create_child_invite(club,mid); raise exception 'FAIL: unlinked parent creates child invite'; exception when insufficient_privilege then null; end;
 begin perform public.lumo_unlink_child(club,mid,a); raise exception 'FAIL: unlinked parent unlinks'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(jsonb_set(payload,'{events,0,attendees,0,answeredBy}','"Parent X"'),'{events,0,attendees,0,availability}','"present"');
 begin perform public.save_lumo_club(club,rev,candidate); raise exception 'FAIL: unlinked parent answers'; exception when insufficient_privilege then null; end;
 perform pg_temp.as_user(a);
 ci=public.lumo_create_child_invite(club,mid); code1=ci->>'code';
 if length(code1)<>32 or (ci->>'expires_at')::timestamptz<now()+interval '6 days' or ci->>'member_id'<>mid then raise exception 'FAIL: child invite shape'; end if;
 execute 'reset role';
 if (select count(*) from lumo_private.lumo_child_invites where code_hash=sha256(convert_to(code1,'UTF8')))<>1 or exists(select 1 from lumo_private.lumo_child_invites where encode(code_hash,'escape') like '%'||code1||'%') then raise exception 'FAIL: child invite not hashed'; end if;
 execute 'set local role authenticated';
 begin perform * from lumo_private.lumo_child_invites; raise exception 'FAIL: child invites table readable'; exception when insufficient_privilege then null; end;
 -- B (nouveau compte, pas membre) accepte
 perform pg_temp.as_user(b);
 begin perform public.lumo_accept_child_invite(code1,null); raise exception 'FAIL: accept without name'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 ctx=public.lumo_accept_child_invite(upper(code1),'Parent B');
 if ctx#>>'{membership,role}'<>'parent' or ctx#>>'{membership,display_name}'<>'Parent B' or ctx#>'{membership,member_ids}'<>jsonb_build_array(mid) then raise exception 'FAIL: accept makes linked parent'; end if;
 if ctx->'child_parents'<>jsonb_build_object(mid,jsonb_build_array('Parent A','Parent B')) then raise exception 'FAIL: child_parents A and B'; end if;
 if jsonb_array_length(ctx->'memberships')<>1 then raise exception 'FAIL: parent B privacy'; end if;
 -- code réutilisé / inconnu / expiré
 perform pg_temp.as_user(y);
 begin perform public.lumo_accept_child_invite(code1,'Parent Y'); raise exception 'FAIL: reused child code'; exception when raise_exception then if sqlerrm<>'INVALID_INVITE_CODE' then raise; end if; end;
 begin perform public.lumo_accept_child_invite(repeat('f',32),'Parent Y'); raise exception 'FAIL: invalid child code'; exception when raise_exception then if sqlerrm<>'INVALID_INVITE_CODE' then raise; end if; end;
 begin perform public.lumo_accept_child_invite(null,'Parent Y'); raise exception 'FAIL: null child code'; exception when raise_exception then if sqlerrm<>'INVALID_INVITE_CODE' then raise; end if; end;
 perform pg_temp.as_user(a); ci2=public.lumo_create_child_invite(club,mid);
 execute 'reset role'; update lumo_private.lumo_child_invites set expires_at=now()-interval '1 minute' where code_hash=sha256(convert_to(ci2->>'code','UTF8')); execute 'set local role authenticated';
 perform pg_temp.as_user(y);
 begin perform public.lumo_accept_child_invite(ci2->>'code','Parent Y'); raise exception 'FAIL: expired child code'; exception when raise_exception then if sqlerrm<>'INVALID_INVITE_CODE' then raise; end if; end;
 if exists(select 1 from public.lumo_memberships) then raise exception 'FAIL: failed accept created membership'; end if;
 -- B ne peut pas inviter pour un enfant non lié
 perform pg_temp.as_user(b);
 begin perform public.lumo_create_child_invite(club,mid2); raise exception 'FAIL: invite for unlinked child'; exception when insufficient_privilege then null; end;
 -- limite de 5 invitations actives par enfant
 perform pg_temp.as_user(a);
 for i in 1..5 loop perform public.lumo_create_child_invite(club,mid2); end loop;
 begin perform public.lumo_create_child_invite(club,mid2); raise exception 'FAIL: sixth active invite'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 -- réponses signées
 perform pg_temp.as_user(b); ctx=public.lumo_context(club); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 candidate=jsonb_set(jsonb_set(jsonb_set(payload,'{events,0,attendees,0,availability}','"present"'),'{events,0,attendees,0,answeredBy}','"Parent B"'),'{events,0,attendees,0,answeredAt}','"2030-10-10T08:30:00.000Z"');
 ctx=public.save_lumo_club(club,rev,candidate); payload=ctx->'payload'; rev=(ctx->>'revision')::bigint;
 if payload#>>'{events,0,attendees,0,answeredBy}'<>'Parent B' then raise exception 'FAIL: signed answer not saved'; end if;
 candidate=jsonb_set(payload,'{events,0,attendees,0,answeredBy}','"Parent A"');
 begin perform public.save_lumo_club(club,rev,candidate); raise exception 'FAIL: answeredBy spoof'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,attendees,0,answeredBy}','"Admin test"');
 begin perform public.save_lumo_club(club,rev,candidate); raise exception 'FAIL: answeredBy admin spoof'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,attendees,0,answeredAt}','"hier"');
 begin perform public.save_lumo_club(club,rev,candidate); raise exception 'FAIL: bad answeredAt'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 candidate=jsonb_set(jsonb_set(payload,'{events,0,attendees,1,availability}','"present"'),'{events,0,attendees,1,answeredBy}','"Parent B"');
 begin perform public.save_lumo_club(club,rev,candidate); raise exception 'FAIL: answer for unlinked child'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{events,0,attendees,0,team}','"B"');
 begin perform public.save_lumo_club(club,rev,candidate); raise exception 'FAIL: parent changes team'; exception when insufficient_privilege then null; end;
 candidate=jsonb_set(payload,'{members}',(payload->'members')||'[{"id":"child-x","name":"X","kind":"child","parentName":"B","groups":["g13f"]}]'::jsonb);
 begin perform public.save_lumo_club(club,rev,candidate); raise exception 'FAIL: parent adds participant by save'; exception when insufficient_privilege then null; end;
 -- délier : B retire A, B ne peut pas se retirer en dernier
 begin perform public.lumo_unlink_child(club,mid,x); raise exception 'FAIL: unlink account not linked'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 ctx=public.lumo_unlink_child(club,mid,a);
 if ctx->'child_parents'<>jsonb_build_object(mid,jsonb_build_array('Parent B')) then raise exception 'FAIL: unlink other parent'; end if;
 begin perform public.lumo_unlink_child(club,mid,b); raise exception 'FAIL: last parent unlinked'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 perform pg_temp.as_user(a); ctx=public.lumo_context(club);
 if mid=any(array(select jsonb_array_elements_text(ctx#>'{membership,member_ids}'))) then raise exception 'FAIL: A still linked'; end if;
 begin perform public.lumo_create_child_invite(club,mid); raise exception 'FAIL: unlinked A invites'; exception when insufficient_privilege then null; end;
 -- A se relie (déjà membre : seul l'enfant est ajouté), puis se délie lui-même
 perform pg_temp.as_user(b); ci=public.lumo_create_child_invite(club,mid);
 perform pg_temp.as_user(a); ctx=public.lumo_accept_child_invite(ci->>'code','ignoré');
 if ctx#>>'{membership,display_name}'<>'Parent A' or ctx->'child_parents'<>jsonb_build_object(mid,jsonb_build_array('Parent A','Parent B'),mid2,jsonb_build_array('Parent A')) then raise exception 'FAIL: existing member relink'; end if;
 ctx=public.lumo_unlink_child(club,mid,a);
 if ctx->'child_parents'->mid<>jsonb_build_array('Parent B') then raise exception 'FAIL: self unlink with other parent'; end if;
 -- 12 enfants maximum par compte (A a déjà Zoé)
 for i in 1..11 loop ctx=public.lumo_add_child(club,'Enfant '||i,'{}'); end loop;
 begin perform public.lumo_add_child(club,'Enfant 13','{}'); raise exception 'FAIL: 13th child accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 select count(*) into n from jsonb_array_elements(ctx#>'{payload,members}') v where v->>'kind'='child';
 if n<>13 then raise exception 'FAIL: children count %',n; end if;
 -- Coups de main : chacun choisit pour son propre compte, valeurs connues uniquement.
 begin perform public.lumo_set_helps(club,array['buvette','inconnu']); raise exception 'FAIL: unknown help accepted'; exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 if (public.lumo_context(club)#>>'{membership,helps_set}')::boolean then raise exception 'FAIL: helps_set before choice'; end if;
 ctx=public.lumo_set_helps(club,array['buvette','gouter','buvette']);
 if ctx#>'{membership,helps}'<>'["buvette","gouter"]'::jsonb or ctx#>>'{membership,helps_set}'<>'true' then raise exception 'FAIL: helps saved/dedup/helps_set'; end if;
 perform pg_temp.as_user(b); ctx=public.lumo_context(club);
 if ctx#>'{membership,helps}'<>'[]'::jsonb or ctx#>>'{membership,helps_set}'<>'false' then raise exception 'FAIL: parent changed another account helps'; end if;
 ctx=public.lumo_set_helps(club,'{}');
 if ctx#>>'{membership,helps_set}'<>'true' or ctx#>'{membership,helps}'<>'[]'::jsonb then raise exception 'FAIL: empty helps choice'; end if;
 perform pg_temp.as_user(adm); ctx=public.lumo_context(club);
 if not exists(select 1 from jsonb_array_elements(ctx->'memberships') v where v->>'display_name'='Parent A' and v->'helps'='["buvette","gouter"]'::jsonb) then raise exception 'FAIL: memberships expose helps'; end if;
 perform pg_temp.as_user(y);
 begin perform public.lumo_set_helps(club,array['table']); raise exception 'FAIL: non-member sets helps'; exception when insufficient_privilege then null; end;
 execute 'reset role';
end $$;
select 'PASS: real authenticated/anon RLS, roles, linked family, vehicle ownership/capacity, volunteering, notifications, children, shared parents, signed answers, CAS and clean workspace' as result;
rollback;
