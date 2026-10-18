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

-- act_as models a session with a recent second factor; act_without_mfa models a password-only session.
create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;
create function pg_temp.act_without_mfa(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;
-- Notifications are private to their recipient, so the count is read with the owner's rights.
create function pg_temp.notice_count(_user uuid, _title text, _body_part text default null)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.notifications
  where user_id = _user and title = _title
    and (_body_part is null or position(_body_part in body) > 0);
$$;

select plan(64);

-- Structure behind the contract.
select ok(has_column_privilege('authenticated', 'public.memberships', 'can_publish_stories', 'SELECT'),
  'members can read their own publishing right');
select ok(not has_column_privilege('authenticated', 'public.memberships', 'notes', 'SELECT'),
  'private membership notes stay unreadable');
select ok(not has_table_privilege('authenticated', 'public.memberships', 'UPDATE'),
  'publishing rights cannot be edited directly');
select ok(has_function_privilege('authenticated', 'public.set_story_publisher(uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_story_publisher(uuid,boolean)', 'EXECUTE'),
  'the publishing RPC is available to signed-in users only');
select ok(has_function_privilege('authenticated', 'public.can_publish_stories()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.can_publish_stories()', 'EXECUTE'),
  'the publishing check is available to signed-in users only');
select ok(exists (select 1 from pg_constraint
  where conrelid = 'public.stories'::regclass and conname = 'stories_status_check'
    and pg_get_constraintdef(oid) like '%review%'),
  'stories can wait in review');
select ok(exists (select 1 from pg_constraint
  where conrelid = 'public.stories'::regclass and conname = 'stories_public_status_check'),
  'visibility follows the published status');

-- Seed: the fourteen editorial guides exist as published stories, sent without notices.
create temporary table guide_slugs (slug text primary key);
insert into guide_slugs (slug) values
  ('historia-de-rotary-international'), ('como-funciona-rotary'), ('areas-de-interes-de-rotary'),
  ('una-plaza-que-guarda-nuestras-conversaciones'), ('el-lugar-tambien-cuenta'),
  ('cuando-una-reunion-se-convierte-en-un-proyecto'), ('escuchar-primero-el-comienzo-de-todo-servicio'),
  ('alianzas-que-suman-capacidades'), ('la-ciudad-colonial-como-punto-de-encuentro'),
  ('aprender-para-servir-mejor'), ('una-invitacion-abierta-al-companerismo'),
  ('pequenas-acciones-memoria-duradera'), ('el-diario-de-un-club-que-escucha'),
  ('el-archivo-que-construimos-juntos');

select is((select count(*)::integer from public.notifications where title = 'Nueva publicación en la Revista'), 0,
  'seeding the editorial guides sends no publication notices');
select is((select count(*)::integer from public.stories as story join guide_slugs as guide on guide.slug = story.slug
  where story.status = 'published' and story.is_public), 14,
  'the fourteen editorial guides are published and public');
select is((select count(*)::integer from public.stories as story join guide_slugs as guide on guide.slug = story.slug
  where story.content like '{"format":"club-editorial",%'), 14,
  'every seeded guide is stored in the editorial format');
select is((select count(*)::integer from public.stories as story join guide_slugs as guide on guide.slug = story.slug
  where story.first_published_at is not null and story.first_published_at = story.published_at), 14,
  'seeded guides keep their publication dates');

-- Cover images: stories/ paths and static site assets are accepted; anything else is not.
select lives_ok($$insert into public.stories (title, slug, cover_image_path)
  values ('Portada interna de prueba', 'portada-interna-prueba', 'stories/portada-prueba.png')$$,
  'a cover in the stories folder is accepted');
select lives_ok($$insert into public.stories (title, slug, cover_image_path)
  values ('Portada del sitio de prueba', 'portada-sitio-prueba', '/historia.png')$$,
  'a static site image is accepted as a cover');
select throws_ok($$insert into public.stories (title, slug, cover_image_path)
  values ('Portada externa de prueba', 'portada-externa-prueba', 'https://x/y.png')$$,
  '23514', null, 'an external cover address is rejected');

-- Visibility follows the published status: the trigger sets is_public before the CHECK runs.
select lives_ok($$insert into public.stories (title, slug, status, is_public)
  values ('Publicación sin visibilidad', 'publicacion-sin-visibilidad', 'published', false)$$,
  'a published story is saved as public');
select is((select is_public from public.stories where slug = 'publicacion-sin-visibilidad'), true,
  'the published story reads as public');
select lives_ok($$insert into public.stories (title, slug, status, is_public)
  values ('Borrador visible', 'borrador-visible', 'draft', true)$$,
  'a draft is saved as not public');
select is((select is_public from public.stories where slug = 'borrador-visible'), false,
  'the draft reads as not public');

-- Fixtures. ...0001 is club management, ...0002 and ...0003 are editors (...0003 has no publishing right), ...0004 is a member.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f1000000-0000-4000-8000-000000000001', gen_random_uuid(), 'authenticated', 'authenticated', 'revista-manager@example.invalid', '', now(), '{}', '{"display_name":"Gestora de la Revista"}', now() - interval '60 days', now()),
  ('f1000000-0000-4000-8000-000000000002', gen_random_uuid(), 'authenticated', 'authenticated', 'revista-editor@example.invalid', '', now(), '{}', '{"display_name":"Editora sin publicación"}', now() - interval '60 days', now()),
  ('f1000000-0000-4000-8000-000000000003', gen_random_uuid(), 'authenticated', 'authenticated', 'revista-editor-2@example.invalid', '', now(), '{}', '{"display_name":"Editor secundario"}', now() - interval '60 days', now()),
  ('f1000000-0000-4000-8000-000000000004', gen_random_uuid(), 'authenticated', 'authenticated', 'revista-member@example.invalid', '', now(), '{}', '{"display_name":"Miembro de la Revista"}', now() - interval '50 days', now());
update public.memberships set membership_status = 'active', membership_role = case user_id
    when 'f1000000-0000-4000-8000-000000000001' then 'club_manager'
    when 'f1000000-0000-4000-8000-000000000002' then 'editor'
    when 'f1000000-0000-4000-8000-000000000003' then 'editor'
    else 'member' end
where user_id in ('f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000004');

-- Editor without publishing rights: drafts and review only.
set local role authenticated;
select pg_temp.act_as('f1000000-0000-4000-8000-000000000002');
select lives_ok($$insert into public.stories (title, slug, content, story_type)
  values ('Crónica de prueba de la Revista', 'cronica-prueba-revista', 'Texto de prueba para la revisión.', 'cronica')$$,
  'an editor without publishing rights writes a draft');
select lives_ok($$update public.stories set status = 'review' where slug = 'cronica-prueba-revista'$$,
  'an editor sends a draft to review');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000001', 'Texto para revisar en la Revista', 'Crónica de prueba de la Revista'), 1,
  'club management is asked to review the text');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000003', 'Texto para revisar en la Revista', 'Crónica de prueba de la Revista'), 0,
  'editors without publishing rights are not asked to review');
select throws_ok($$update public.stories set status = 'published' where slug = 'cronica-prueba-revista'$$,
  '42501', null, 'an editor without publishing rights cannot publish');
select throws_ok($$update public.stories set status = 'archived' where slug = 'cronica-prueba-revista'$$,
  '42501', null, 'an editor without publishing rights cannot archive');
select throws_ok($$delete from public.stories where slug = 'cronica-prueba-revista'$$,
  '42501', null, 'an editor without publishing rights cannot delete a story');
select throws_ok($$update public.stories set title = 'Título cambiado por una editora' where slug = 'historia-de-rotary-international'$$,
  '42501', null, 'an editor cannot change a published story');
select lives_ok($$update public.stories set status = 'draft' where slug = 'cronica-prueba-revista'$$,
  'an editor moves a review back to draft');

-- Club management grants publishing to an active editor only, with a recent second factor.
select pg_temp.act_as('f1000000-0000-4000-8000-000000000001');
select lives_ok($$select public.set_story_publisher('f1000000-0000-4000-8000-000000000002', true)$$,
  'club management grants publishing to an editor');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000002', 'Permiso de publicación', 'Ahora puedes publicar en la Revista.'), 1,
  'the editor is told that publishing is now allowed');
select throws_ok($$select public.set_story_publisher('f1000000-0000-4000-8000-000000000004', true)$$,
  '22023', null, 'publishing rights go only to active editors');
select throws_ok($$select public.set_story_publisher('f1000000-0000-4000-8000-000000000001', true)$$,
  '42501', null, 'nobody changes their own publishing right');
select pg_temp.act_as('f1000000-0000-4000-8000-000000000002');
select ok((select public.can_publish_stories()), 'the granted editor can publish');
select throws_ok($$select public.set_story_publisher('f1000000-0000-4000-8000-000000000003', true)$$,
  '42501', null, 'an editor cannot grant publishing rights');
select pg_temp.act_without_mfa('f1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.set_story_publisher('f1000000-0000-4000-8000-000000000003', true)$$,
  '42501', null, 'without a recent second factor management cannot grant publishing rights');

-- A review sent by club management notifies the publishing editor, not the sender.
-- A new text is used, so the notices already sent for other texts are not counted.
select pg_temp.act_as('f1000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.stories (title, slug, content, story_type)
  values ('Texto enviado por la gestora', 'texto-enviado-por-la-gestora', 'Texto de prueba enviado por la gestora.', 'cronica')$$,
  'club management writes a draft');
select lives_ok($$update public.stories set status = 'review' where slug = 'texto-enviado-por-la-gestora'$$,
  'club management sends the draft to review');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000002', 'Texto para revisar en la Revista', 'Texto enviado por la gestora'), 1,
  'the publishing editor is asked to review the text');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000001', 'Texto para revisar en la Revista', 'Texto enviado por la gestora'), 0,
  'the club manager who sent the text is not notified');

-- Editor with publishing rights: first publication notifies every other active member once.
select pg_temp.act_as('f1000000-0000-4000-8000-000000000002');
select lives_ok($$update public.stories set status = 'published' where slug = 'cronica-prueba-revista'$$,
  'an editor with publishing rights publishes a text in review');
select ok((select published_at is not null and first_published_at = published_at from public.stories where slug = 'cronica-prueba-revista'),
  'the first publication sets both publication dates');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000004', 'Nueva publicación en la Revista', 'Crónica de prueba de la Revista'), 1,
  'members hear about a first publication once');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000003', 'Nueva publicación en la Revista', 'Crónica de prueba de la Revista'), 1,
  'editors without publishing rights hear about a first publication too');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000002', 'Nueva publicación en la Revista', 'Crónica de prueba de la Revista'), 0,
  'the editor who publishes is not notified about their own publication');

-- The original publication date survives unpublishing and publishing again, and no second notice is sent.
select lives_ok($$insert into public.stories (title, slug, content, story_type)
  values ('Crónica con fecha original', 'cronica-fecha-original', 'Texto de prueba con fecha anterior.', 'cronica')$$,
  'an editor with publishing rights writes a second draft');
select lives_ok($$update public.stories set status = 'published', published_at = '2026-01-15T16:00:00Z'
  where slug = 'cronica-fecha-original'$$, 'a story is published with its original date');
select lives_ok($$update public.stories set status = 'draft' where slug = 'cronica-fecha-original'$$,
  'a published story is taken down');

-- Club management without a recent second factor cannot publish: the write matches no row.
select pg_temp.act_without_mfa('f1000000-0000-4000-8000-000000000001');
select lives_ok($$update public.stories set status = 'published' where slug = 'cronica-fecha-original'$$,
  'club management without a recent second factor cannot publish');
select pg_temp.act_as('f1000000-0000-4000-8000-000000000002');
select ok((select status = 'draft' from public.stories where slug = 'cronica-fecha-original'),
  'the story stays a draft after that attempt');
select lives_ok($$update public.stories set status = 'published', published_at = now()
  where slug = 'cronica-fecha-original'$$, 'a taken-down story is published again');
select ok((select published_at = '2026-01-15T16:00:00Z'::timestamptz from public.stories where slug = 'cronica-fecha-original'),
  'the original publication date survives unpublishing and publishing again');
select is(pg_temp.notice_count('f1000000-0000-4000-8000-000000000004', 'Nueva publicación en la Revista', 'Crónica con fecha original'), 1,
  'a republished story does not notify members again');

-- Club management keeps the right to archive.
select pg_temp.act_as('f1000000-0000-4000-8000-000000000001');
select lives_ok($$update public.stories set status = 'archived' where slug = 'cronica-prueba-revista'$$,
  'club management archives a published story');

-- Delete: only publishers remove stories.
select pg_temp.act_as('f1000000-0000-4000-8000-000000000003');
select lives_ok($$insert into public.stories (title, slug, content, story_type)
  values ('Borrador para eliminar', 'borrador-para-eliminar', 'Texto de prueba que se elimina.', 'cronica')$$,
  'an editor without publishing rights writes a draft to remove');
select throws_ok($$delete from public.stories where slug = 'borrador-para-eliminar'$$,
  '42501', null, 'an editor without publishing rights cannot remove a draft');
select pg_temp.act_as('f1000000-0000-4000-8000-000000000002');
select lives_ok($$delete from public.stories where slug = 'borrador-para-eliminar'$$,
  'an editor with publishing rights removes the draft');
select ok(not exists (select 1 from public.stories where slug = 'borrador-para-eliminar'),
  'the removed draft is gone');

-- Club-public storage: editors write stories/ and membership photos; club management keeps its rights.
select pg_temp.act_as('f1000000-0000-4000-8000-000000000002');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('club-public', 'historia/prueba.png')$$,
  '42501', null, 'an editor cannot write club images outside the stories folder');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('club-public', 'stories/revista-prueba.png')$$,
  'an editor uploads a story image');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('club-public',
  'site-photos/membership-application/membership-community/0b1c2d3e-0000-4000-8000-00000000f001.jpg')$$,
  'an editor keeps managing membership photos');
select pg_temp.act_as('f1000000-0000-4000-8000-000000000001');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('club-public', 'historia/admin-prueba.png')$$,
  'club management keeps its image rights');
select pg_temp.act_as('f1000000-0000-4000-8000-000000000004');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('club-public', 'stories/miembro.png')$$,
  '42501', null, 'members cannot upload story images');

-- Demotion: update_member_access still works and clears the publishing right.
select pg_temp.act_as('f1000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.update_member_access('f1000000-0000-4000-8000-000000000002', 'member', 'active', null,
  'Cambio de responsabilidades de prueba',
  (select updated_at from public.memberships where user_id = 'f1000000-0000-4000-8000-000000000002'))$$,
  'club management changes an editor back to member');
select ok(not (select membership.can_publish_stories from public.memberships as membership
  where membership.user_id = 'f1000000-0000-4000-8000-000000000002'),
  'a former editor loses publishing rights');
select throws_ok($$select public.set_story_publisher('f1000000-0000-4000-8000-000000000002', true)$$,
  '22023', null, 'a former member cannot be given publishing rights');

reset role;
select * from finish();
rollback;
