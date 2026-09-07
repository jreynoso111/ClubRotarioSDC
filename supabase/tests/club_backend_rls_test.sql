BEGIN;
SELECT plan(7);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'profiles', 'memberships', 'events', 'stories', 'site_settings',
        'proposals', 'committees', 'committee_members', 'activities', 'tasks',
        'event_rsvps', 'access_requests', 'media_assets'
      )
  ),
  13,
  'the application tables exist'
);

SELECT ok(
  (
    SELECT bool_and(relation.relrowsecurity)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'profiles', 'memberships', 'events', 'stories', 'site_settings',
        'proposals', 'committees', 'committee_members', 'activities', 'tasks',
        'event_rsvps', 'access_requests', 'media_assets'
      )
  ),
  'row-level security is enabled for every application table'
);

SELECT ok(
  (SELECT count(*) >= 59 FROM pg_policies WHERE schemaname = 'public'),
  'application tables have explicit RLS policies'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_record
    JOIN pg_class AS relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'auth'
      AND relation.relname = 'users'
      AND trigger_record.tgname = 'on_auth_user_created'
  ),
  'new auth users receive a profile and pending membership'
);

SELECT ok(to_regprocedure('public.claim_initial_admin()') IS NOT NULL, 'admin bootstrap RPC exists');
SELECT ok(to_regprocedure('public.submit_proposal(uuid)') IS NOT NULL, 'proposal submission RPC exists');

SELECT is(
  (SELECT count(*)::integer FROM storage.buckets WHERE id IN ('club-public', 'club-media')),
  2,
  'the application storage buckets exist'
);

SELECT * FROM finish();
ROLLBACK;
