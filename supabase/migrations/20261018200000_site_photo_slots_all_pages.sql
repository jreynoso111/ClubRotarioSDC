-- Editable photos for every non-magazine page (2026-10-18).
-- 1. The slot catalogue (titles, defaults, sections, page links) lives in lib/site-photos.ts.
--    These checks list the same keys and orders so the database rejects anything else.
-- 2. Storage paths: site-photos/<section>/<slot_key>/<uuid>.<ext>, where the folder must be the slot key.
--    Existing membership paths (site-photos/membership-application/...) stay valid.
-- 3. Editors and management keep the same row-level rules: editors update slots, management publishes them.
--    Only the storage policies widen: editors may write under site-photos/ as well as stories/.
-- 4. The existing membership rows keep display_order 1-3; the new rows take 4-15 in this insert.

alter table public.site_photo_slots drop constraint site_photo_slots_key_check;
alter table public.site_photo_slots
  add constraint site_photo_slots_key_check
    check (slot_key in (
      'membership-community', 'membership-service', 'membership-fellowship',
      'home-hero-1', 'home-hero-2', 'home-hero-3', 'home-hero-4', 'home-hero-5', 'home-hero-6',
      'nosotros-banner', 'nosotros-fellowship', 'nosotros-service', 'nosotros-group',
      'eventos-banner', 'revista-banner'
    ));

alter table public.site_photo_slots drop constraint site_photo_slots_order_check;
alter table public.site_photo_slots
  add constraint site_photo_slots_order_check
    check (display_order between 1 and 50);

alter table public.site_photo_slots drop constraint site_photo_slots_path_check;
alter table public.site_photo_slots
  add constraint site_photo_slots_path_check
    check (
      image_path is null or (
        image_path ~ '^site-photos/[a-z-]+/[a-z0-9-]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
        and split_part(image_path, '/', 3) = slot_key
      )
    );

insert into public.site_photo_slots (slot_key, display_order)
values
  ('home-hero-1', 4),
  ('home-hero-2', 5),
  ('home-hero-3', 6),
  ('home-hero-4', 7),
  ('home-hero-5', 8),
  ('home-hero-6', 9),
  ('nosotros-banner', 10),
  ('nosotros-fellowship', 11),
  ('nosotros-service', 12),
  ('nosotros-group', 13),
  ('eventos-banner', 14),
  ('revista-banner', 15)
on conflict do nothing;

-- Storage: editors may write story images and site photos. Club management keeps its rights.
-- Updates and deletes only reach rows the caller can select. The bucket is public
-- for anonymous reads by URL, but signed-in writers had no SELECT policy, so
-- replaced photos were never removed. Writers may now see the objects they manage.
drop policy if exists club_public_assets_writers_read on storage.objects;
create policy club_public_assets_writers_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'club-public'
  and (select private.has_any_role(array['editor', 'club_manager', 'admin']))
);

drop policy if exists club_public_assets_management_insert on storage.objects;
create policy club_public_assets_management_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'club-public'
  and (
    (select private.has_any_role(array['club_manager', 'admin']))
    or (
      (select private.has_any_role(array['editor']))
      and (
        starts_with(name, 'stories/')
        or starts_with(name, 'site-photos/')
      )
    )
  )
);

drop policy if exists club_public_assets_management_update on storage.objects;
create policy club_public_assets_management_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'club-public'
  and (
    (select private.has_any_role(array['club_manager', 'admin']))
    or (
      (select private.has_any_role(array['editor']))
      and (
        starts_with(name, 'stories/')
        or starts_with(name, 'site-photos/')
      )
    )
  )
)
with check (
  bucket_id = 'club-public'
  and (
    (select private.has_any_role(array['club_manager', 'admin']))
    or (
      (select private.has_any_role(array['editor']))
      and (
        starts_with(name, 'stories/')
        or starts_with(name, 'site-photos/')
      )
    )
  )
);

drop policy if exists club_public_assets_management_delete on storage.objects;
create policy club_public_assets_management_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'club-public'
  and (
    (select private.has_any_role(array['club_manager', 'admin']))
    or (
      (select private.has_any_role(array['editor']))
      and (
        starts_with(name, 'stories/')
        or starts_with(name, 'site-photos/')
      )
    )
  )
);
