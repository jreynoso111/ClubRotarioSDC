begin;

-- Synthetic sessions belong only to users inserted by this rolled-back suite.
create function pg_temp.club_fixture_session() returns trigger language plpgsql as $$
begin
  insert into auth.sessions(id, user_id, created_at, updated_at, aal)
  values(new.id, new.id, now(), now(), 'aal2');
  return new;
end; $$;
create trigger club_fixture_session after insert on auth.users
for each row execute function pg_temp.club_fixture_session();

-- act_as models a session with a recent second factor, which privileged writes require.
create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;

select plan(28);

-- Fixtures. ...0001 is club management, ...0002 an active editor, ...0003 a regular member.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f2000000-0000-4000-8000-000000000001', gen_random_uuid(), 'authenticated', 'authenticated', 'fotos-gestion@example.invalid', '', now(), '{}', '{"display_name":"Gestion de fotos"}', now() - interval '60 days', now()),
  ('f2000000-0000-4000-8000-000000000002', gen_random_uuid(), 'authenticated', 'authenticated', 'fotos-editor@example.invalid', '', now(), '{}', '{"display_name":"Editor de fotos"}', now() - interval '60 days', now()),
  ('f2000000-0000-4000-8000-000000000003', gen_random_uuid(), 'authenticated', 'authenticated', 'fotos-miembro@example.invalid', '', now(), '{}', '{"display_name":"Miembro sin edicion"}', now() - interval '50 days', now());
update public.memberships set membership_status = 'active', membership_role = case user_id
    when 'f2000000-0000-4000-8000-000000000001' then 'club_manager'
    when 'f2000000-0000-4000-8000-000000000002' then 'editor'
    else 'member' end
where user_id in ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000003');

-- Catalogue: every page has its slots, in one deterministic order.
select is((select count(*)::integer from public.site_photo_slots), 15,
  'every non-magazine photo slot exists');
select is((select string_agg(slot_key, ',' order by display_order) from public.site_photo_slots),
  'membership-community,membership-service,membership-fellowship,home-hero-1,home-hero-2,home-hero-3,home-hero-4,home-hero-5,home-hero-6,nosotros-banner,nosotros-fellowship,nosotros-service,nosotros-group,eventos-banner,revista-banner',
  'slots keep the catalogue order');
select is((select count(*)::integer from public.site_photo_slots where slot_key like 'home-hero-%'), 6,
  'the home page has six hero photo slots');
select lives_ok($$update public.site_photo_slots set display_order = 50 where slot_key = 'revista-banner'$$,
  'the last allowed display position is accepted');
select throws_ok($$update public.site_photo_slots set display_order = 51 where slot_key = 'revista-banner'$$, '23514', null,
  'display order is limited to fifty positions');
select throws_ok($$insert into public.site_photo_slots (slot_key, display_order) values ('nuevo-espacio', 30)$$, '23514', null,
  'unknown photo slots are rejected');
select throws_ok($$insert into public.site_photo_slots (slot_key, display_order) values ('home-hero-1', 30)$$, '23505', null,
  'a photo slot cannot be created twice');
update public.site_photo_slots set display_order = 15 where slot_key = 'revista-banner';

-- Paths: the folder must be the page section and the slot key, with a supported image extension.
select lives_ok($$update public.site_photo_slots set image_path = 'site-photos/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c001.webp'
  where slot_key = 'home-hero-1'$$, 'a home photo is stored under its section and slot');
select lives_ok($$update public.site_photo_slots set image_path = 'site-photos/membership-application/membership-community/0b1c2d3e-0000-4000-8000-00000000c002.jpg'
  where slot_key = 'membership-community'$$, 'the membership photo path stays valid');
select throws_ok($$update public.site_photo_slots set image_path = 'site-photos/home/home-hero-2/0b1c2d3e-0000-4000-8000-00000000c003.webp'
  where slot_key = 'home-hero-1'$$, '23514', null, 'a photo cannot be stored under another slot folder');
select throws_ok($$update public.site_photo_slots set image_path = 'stories/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c004.webp'
  where slot_key = 'home-hero-1'$$, '23514', null, 'only site-photos paths are accepted');
select throws_ok($$update public.site_photo_slots set image_path = 'site-photos/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c005.gif'
  where slot_key = 'home-hero-1'$$, '23514', null, 'only JPG, PNG and WebP photos are accepted');
select throws_ok($$update public.site_photo_slots set image_path = 'site-photos/Home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c006.webp'
  where slot_key = 'home-hero-1'$$, '23514', null, 'folder names are lowercase');
update public.site_photo_slots set image_path = null
where slot_key in ('home-hero-1', 'membership-community');

-- Editors: write photos under site-photos/ and stories/, edit slots, and keep the other folders closed.
set local role authenticated;
select pg_temp.act_as('f2000000-0000-4000-8000-000000000002');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('club-public',
  'site-photos/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c007.webp')$$,
  'an editor uploads a photo for any page');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('club-public', 'stories/revista-editor-prueba.png')$$,
  'an editor keeps uploading story images');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('club-public', 'historia/prueba.png')$$,
  '42501', null, 'an editor cannot write outside the approved folders');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('club-public',
  'site-photos-evil/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c008.webp')$$,
  '42501', null, 'a folder that only starts with site-photos is rejected');
select lives_ok($$update public.site_photo_slots set caption = 'Pie de prueba del editor', updated_by = auth.uid()
  where slot_key = 'nosotros-group'$$, 'an editor updates a photo caption');
select throws_ok($$update public.site_photo_slots set slot_key = 'nosotros-renombrado' where slot_key = 'nosotros-group'$$,
  '42501', null, 'an editor cannot rename a photo slot');
select lives_ok($$delete from storage.objects where name = 'site-photos/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c007.webp'$$,
  'an editor removes a replaced photo');
reset role;
select ok(not exists (select 1 from storage.objects
  where name = 'site-photos/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c007.webp'),
  'the removed photo is gone from storage');

-- Regular members see nothing to edit; club management uploads for any page.
set local role authenticated;
select pg_temp.act_as('f2000000-0000-4000-8000-000000000003');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('club-public',
  'site-photos/home/home-hero-1/0b1c2d3e-0000-4000-8000-00000000c009.webp')$$,
  '42501', null, 'members cannot upload site photos');
with updated as (update public.site_photo_slots set caption = 'No permitido', updated_by = auth.uid()
  where slot_key = 'eventos-banner' returning slot_key)
select is((select count(*)::integer from updated), 0, 'members cannot edit photo slots');
select pg_temp.act_as('f2000000-0000-4000-8000-000000000001');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('club-public',
  'site-photos/nosotros/nosotros-banner/0b1c2d3e-0000-4000-8000-00000000c010.webp')$$,
  'club management uploads any site photo');
reset role;

-- Visitors: only published photos are readable, and nobody anonymous can change them.
update public.site_photo_slots set image_path = 'site-photos/eventos/eventos-banner/0b1c2d3e-0000-4000-8000-00000000c011.webp',
  alt_text = 'Foto publicada de prueba', is_published = true
where slot_key = 'eventos-banner';
set local role anon;
select is((select count(*)::integer from public.site_photo_slots where not is_published), 0,
  'visitors see no unpublished photo slot');
select is((select count(*)::integer from public.site_photo_slots where slot_key = 'eventos-banner'), 1,
  'visitors read a published photo');
select throws_ok($$update public.site_photo_slots set caption = 'No permitido' where slot_key = 'eventos-banner'$$,
  '42501', null, 'visitors cannot change photos');
reset role;
select ok(exists (select 1 from public.audit_log
  where table_name = 'site_photo_slots' and record_id = 'eventos-banner'),
  'photo changes remain in the audit trail');

select * from finish();
rollback;
