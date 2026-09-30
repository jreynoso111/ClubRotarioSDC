-- Curated, reusable photography spaces for the public membership application.
-- The slot definitions stay fixed in code; editors manage only photo content.
create table public.site_photo_slots (
  slot_key text primary key,
  display_order smallint not null unique,
  image_path text,
  alt_text text not null default '',
  caption text,
  is_published boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_photo_slots_key_check
    check (slot_key in ('membership-community', 'membership-service', 'membership-fellowship')),
  constraint site_photo_slots_order_check
    check (display_order between 1 and 3),
  constraint site_photo_slots_path_check
    check (
      image_path is null or (
        image_path ~ '^site-photos/membership-application/(membership-community|membership-service|membership-fellowship)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
        and split_part(image_path, '/', 3) = slot_key
      )
    ),
  constraint site_photo_slots_alt_text_length
    check (char_length(alt_text) <= 250),
  constraint site_photo_slots_caption_length
    check (caption is null or char_length(btrim(caption)) between 1 and 300),
  constraint site_photo_slots_published_image_check
    check (not is_published or (image_path is not null and char_length(btrim(alt_text)) between 1 and 250))
);

insert into public.site_photo_slots (slot_key, display_order)
values
  ('membership-community', 1),
  ('membership-service', 2),
  ('membership-fellowship', 3);

alter table public.site_photo_slots enable row level security;
revoke all on public.site_photo_slots from public, anon, authenticated, service_role;
grant select on public.site_photo_slots to anon, authenticated;
grant update (image_path, alt_text, caption, is_published, updated_by)
  on public.site_photo_slots to authenticated;

create policy site_photo_slots_public_read
on public.site_photo_slots for select
to anon
using (is_published);

create policy site_photo_slots_member_read
on public.site_photo_slots for select
to authenticated
using (
  is_published
  or (select private.has_any_role(array['editor', 'club_manager', 'admin']))
);

create policy site_photo_slots_editor_update
on public.site_photo_slots for update
to authenticated
using ((select private.has_any_role(array['editor', 'club_manager', 'admin'])))
with check (
  (select private.has_any_role(array['editor', 'club_manager', 'admin']))
  and updated_by = (select auth.uid())
);

create trigger site_photo_slots_set_updated_at
before update on public.site_photo_slots
for each row execute function private.set_updated_at();

create trigger zz_club_audit after insert or update or delete on public.site_photo_slots
for each row execute function private.capture_club_audit_change('slot_key');

notify pgrst, 'reload schema';
