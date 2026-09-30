-- Active members can RSVP to published internal events as well as public ones.
-- Drafts remain restricted to the existing event-management roles.
create policy events_member_select
on public.events for select
to authenticated
using (status = 'published' and (select private.is_active_member()));
