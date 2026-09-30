begin;
select plan(20);

select is((select count(*)::integer from public.site_photo_slots), 3,
  'the gallery retains its three curated slots');
select ok((select relrowsecurity from pg_class where oid = 'public.site_photo_slots'::regclass),
  'photo content has row-level security');
select ok(has_table_privilege('anon', 'public.site_photo_slots', 'SELECT')
  and not has_table_privilege('anon', 'public.site_photo_slots', 'UPDATE')
  and not has_table_privilege('anon', 'public.site_photo_slots', 'INSERT'),
  'visitors have read-only gallery access');
select ok(has_column_privilege('authenticated', 'public.site_photo_slots', 'image_path', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.site_photo_slots', 'slot_key', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.site_photo_slots', 'DELETE'),
  'editors change content without changing or deleting curated slots');

create temporary table photo_fixture (editor_id uuid, member_id uuid, suspended_id uuid, image_path text);
insert into photo_fixture values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'site-photos/membership-application/membership-community/' || gen_random_uuid()::text || '.jpg');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
  fixture_id::text || '@photo-gallery.example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from (select editor_id as fixture_id from photo_fixture
  union all select member_id from photo_fixture union all select suspended_id from photo_fixture) fixtures;
update public.memberships set membership_role = 'editor', membership_status = 'active'
where user_id = (select editor_id from photo_fixture);
update public.memberships set membership_status = 'active'
where user_id = (select member_id from photo_fixture);
update public.memberships set membership_role = 'editor', membership_status = 'suspended'
where user_id = (select suspended_id from photo_fixture);
grant select on photo_fixture to authenticated;

-- Only this transaction sees the draft fixture; the existing gallery is restored.
update public.site_photo_slots set image_path = null, alt_text = '', caption = null, is_published = false
where slot_key = 'membership-community';
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is((select count(*)::integer from public.site_photo_slots where slot_key = 'membership-community'), 0,
  'visitors cannot read an unpublished photo slot');
select throws_ok($$update public.site_photo_slots set caption = 'Not allowed'
  where slot_key = 'membership-community'$$, '42501', null, 'visitors cannot edit photo content');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select member_id::text from photo_fixture), true);
select is((select count(*)::integer from public.site_photo_slots where slot_key = 'membership-community'), 0,
  'regular members cannot read unpublished photo content');
with updated as (update public.site_photo_slots set caption = 'Not allowed', updated_by = auth.uid()
  where slot_key = 'membership-community' returning slot_key)
select is(count(*)::integer, 0, 'regular members cannot edit gallery content') from updated;

select set_config('request.jwt.claim.sub', (select suspended_id::text from photo_fixture), true);
select is((select count(*)::integer from public.site_photo_slots where slot_key = 'membership-community'), 0,
  'suspended editors cannot read unpublished photos');

select set_config('request.jwt.claim.sub', (select editor_id::text from photo_fixture), true);
select is((select count(*)::integer from public.site_photo_slots where slot_key = 'membership-community'), 1,
  'active editors can read the draft they manage');
select throws_ok($$update public.site_photo_slots set is_published = true, updated_by = auth.uid()
  where slot_key = 'membership-community'$$, '23514', null,
  'publication requires an image and accessible description');
select throws_ok($$update public.site_photo_slots set image_path = 'https://example.org/photo.jpg', updated_by = auth.uid()
  where slot_key = 'membership-community'$$, '23514', null, 'external paths cannot be substituted for managed photos');
select throws_ok($$update public.site_photo_slots
  set image_path = replace((select image_path from photo_fixture), 'membership-community', 'membership-service'),
    updated_by = auth.uid() where slot_key = 'membership-community'$$, '23514', null,
  'a photo path must belong to the edited slot');
select throws_ok($$update public.site_photo_slots set caption = 'Wrong attribution',
  updated_by = (select member_id from photo_fixture) where slot_key = 'membership-community'$$,
  '42501', null, 'an editor cannot attribute an edit to a different account');
select lives_ok($$update public.site_photo_slots set image_path = (select image_path from photo_fixture),
  alt_text = 'Foto de verificacion temporal', caption = 'Solo dentro de la prueba', updated_by = auth.uid()
  where slot_key = 'membership-community'$$, 'an active editor can save validated draft photo content');
select throws_ok($$update public.site_photo_slots set alt_text = '', is_published = true, updated_by = auth.uid()
  where slot_key = 'membership-community'$$, '23514', null, 'an image cannot be published without accessible text');
select lives_ok($$update public.site_photo_slots set is_published = true, updated_by = auth.uid()
  where slot_key = 'membership-community'$$, 'a complete photo can be published by its editor');
reset role;
select ok(exists (select 1 from public.audit_log
  where table_name = 'site_photo_slots' and record_id = 'membership-community'
    and actor_id = (select editor_id from photo_fixture)
    and after_data->>'image_path' = (select image_path from photo_fixture)),
  'photo edits retain their authenticated editor in the audit trail');
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.site_photo_slots where slot_key = 'membership-community'), 1,
  'published content is readable by visitors');
select throws_ok($$update public.site_photo_slots set caption = 'Not allowed'
  where slot_key = 'membership-community'$$, '42501', null, 'public visibility never grants editing permission');
reset role;

select * from finish();
rollback;
