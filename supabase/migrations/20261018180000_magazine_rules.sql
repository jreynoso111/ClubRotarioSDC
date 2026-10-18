-- Revista rules (2026-10-18): writing and publishing are separate permissions.
-- 1. Editors write drafts and send them to review. Club management, administrators and
--    editors with can_publish_stories publish, archive and delete; others get 42501
--    publisher_required. Trusted backend roles (current_user is not authenticated) keep
--    their existing behaviour, as the other guards in this project do.
-- 2. Club management grants or removes publishing with public.set_story_publisher (recent
--    second factor). Only active editors can receive it; a role or status change clears it.
-- 3. stories.status adds 'review'. is_public is true exactly when status = 'published'.
--    published_at and first_published_at record the first publication and never move.
-- 4. Publishers are asked to review texts. Active members hear about each story's first
--    publication once. Nobody is notified about their own action.
-- 5. Cover images are stories/ storage paths or static site assets only.
-- 6. Editors upload story images under stories/ and keep managing membership photos under
--    site-photos/membership-application/, as before. SVG leaves club-public.
-- 7. The 14 guides from lib/editorial.ts are seeded as published stories without notices.

-- 1. Publishing permission. Only public.set_story_publisher changes it.
alter table public.memberships
  add column can_publish_stories boolean not null default false;

grant select (can_publish_stories) on public.memberships to authenticated;

create or replace function private.can_publish_stories()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_member())
    and (
      (select private.has_any_role(array['club_manager', 'admin']))
      or exists (
        select 1
        from public.memberships as membership
        where membership.user_id = (select auth.uid())
          and membership.membership_status = 'active'
          and membership.membership_role = 'editor'
          and membership.can_publish_stories
      )
    );
$$;

create or replace function public.can_publish_stories()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.can_publish_stories();
$$;

-- Publishing belongs to an active editor. Any other role or status clears it, so a later
-- promotion or reactivation does not restore it without a new decision.
create or replace function private.membership_reset_story_publisher()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.membership_role <> 'editor' or new.membership_status <> 'active' then
    new.can_publish_stories := false;
  end if;
  return new;
end;
$$;

create trigger memberships_reset_story_publisher
before update of membership_role, membership_status on public.memberships
for each row
when (old.membership_role is distinct from new.membership_role
  or old.membership_status is distinct from new.membership_status)
execute function private.membership_reset_story_publisher();

create or replace function public.set_story_publisher(_user_id uuid, _enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_role text;
  target_status text;
  currently_enabled boolean;
begin
  if not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'Only an active club manager or administrator can change publishing rights.' using errcode = '42501';
  end if;
  if _user_id is null or _enabled is null then
    raise exception 'Invalid publishing right.' using errcode = '22023';
  end if;
  if _user_id = actor_id then
    raise exception 'Your own publishing right must be changed by another administrator.' using errcode = '42501';
  end if;

  select membership.membership_role, membership.membership_status, membership.can_publish_stories
    into target_role, target_status, currently_enabled
  from public.memberships as membership
  where membership.user_id = _user_id
  for update;

  if target_role is distinct from 'editor' or target_status is distinct from 'active' then
    raise exception 'not_editor' using errcode = '22023';
  end if;
  if currently_enabled = _enabled then
    return;
  end if;

  update public.memberships as membership
  set can_publish_stories = _enabled
  where membership.user_id = _user_id;

  insert into public.notifications (user_id, kind, title, body, href)
  values (
    _user_id,
    'membership',
    'Permiso de publicación',
    case when _enabled
      then 'Ahora puedes publicar en la Revista.'
      else 'Ya no puedes publicar en la Revista; tus textos pasarán por revisión.'
    end,
    '/plataforma?tab=revista'
  );
end;
$$;

-- 2. Stories: review status, first publication dates and consistent visibility.
update public.stories
set published_at = coalesce(published_at, created_at)
where status = 'published' and published_at is null;

alter table public.stories
  add column first_published_at timestamptz;

update public.stories
set first_published_at = published_at
where published_at is not null;

update public.stories
set status = 'draft'
where status = 'published' and not is_public;

update public.stories
set is_public = false
where status <> 'published' and is_public;

alter table public.stories drop constraint stories_status_check;
alter table public.stories
  add constraint stories_status_check
    check (status in ('draft', 'review', 'published', 'archived')),
  add constraint stories_public_status_check
    check ((status = 'published') = is_public),
  add constraint stories_cover_image_path_check
    check (
      cover_image_path is null
      or cover_image_path ~ '^stories/[A-Za-z0-9._-]+$'
      or cover_image_path ~ '^/[a-z0-9-]+\.(png|jpg|jpeg|webp)$'
    );

-- Writers reach the delete trigger, which lets only publishers delete. Nobody gets a silent
-- no-op: a writer without publishing rights receives publisher_required.
drop policy if exists stories_content_delete on public.stories;
create policy stories_content_delete
on public.stories for delete
to authenticated
using ((select private.has_any_role(array['editor', 'club_manager', 'admin'])));

-- 6. Club-public storage. No current feature uploads SVG there (uploads are JPEG, PNG or WebP).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'club-public';

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
        or starts_with(name, 'site-photos/membership-application/')
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
        or starts_with(name, 'site-photos/membership-application/')
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
        or starts_with(name, 'site-photos/membership-application/')
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
        or starts_with(name, 'site-photos/membership-application/')
      )
    )
  )
);

-- 7. Editorial guides. Inserted before the notification triggers below exist, so seeding
--    sends no notices. Generated from lib/editorial.ts; the stored content follows the
--    club-editorial format written by serializeEditorialContent.
insert into public.stories (
  title, slug, excerpt, content, story_type, status, is_public,
  published_at, first_published_at, cover_image_path
)
values
  -- historia-de-rotary-international
  ($club_seed$La historia de Rotary International comenzó con una conversación$club_seed$, $club_seed$historia-de-rotary-international$club_seed$, $club_seed$Del primer encuentro de cuatro personas en Chicago a una red internacional unida por el servicio.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"El 23 de febrero de 1905, el abogado Paul P. Harris convocó en Chicago la primera reunión de lo que sería el primer club rotario. A su lado estuvieron Gustavus Loehr, Silvester Schiele y Hiram Shorey.\n\nLa idea inicial era crear un espacio donde profesionales de distintas áreas pudieran intercambiar ideas y construir amistades. Con el tiempo, esa conexión se convirtió también en una vocación humanitaria: organizarse para responder a necesidades concretas.\n\nEn agosto de 1910, los 16 clubes existentes se unieron en la National Association of Rotary Clubs, hoy Rotary International. La expansión internacional comenzó temprano y llevó el movimiento a clubes en distintos continentes.\n\nEsta lectura presenta una síntesis editorial basada en el archivo oficial de Rotary International. No describe la historia particular del Club Rotario Santo Domingo Colonial; esa memoria local se publicará cuando sea revisada por su directiva.\n\nFuente: Rotary International · Nuestra historia. https://www.rotary.org/es-mx/who-we-are/our-history","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"La historia de Rotary International comenzó con una conversación"}$club_seed$, $club_seed$archivo$club_seed$,
   'published', true, '2026-09-01T16:00:00.000Z'::timestamptz, '2026-09-01T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-dusk.png$club_seed$),
  -- como-funciona-rotary
  ($club_seed$Cómo se organiza Rotary para convertir vínculos en servicio$club_seed$, $club_seed$como-funciona-rotary$club_seed$, $club_seed$Clubes, Rotary International y La Fundación Rotaria: tres piezas que trabajan juntas para generar cambio duradero.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Rotary International explica su organización a partir de tres partes que se complementan. Los clubes reúnen a personas para intercambiar ideas, formar relaciones y pasar a la acción.\n\nRotary International conecta y coordina programas e iniciativas de los clubes alrededor del mundo. La Fundación Rotaria reúne programas humanitarios y espacios de colaboración para iniciativas comunitarias y de alcance internacional.\n\nEn el ámbito de cada club, esta estructura se expresa en reuniones, comités, proyectos, alianzas y espacios de aprendizaje. La forma concreta de trabajar corresponde a cada club y debe quedar documentada por sus propios miembros.\n\nEn el Club Rotario Santo Domingo Colonial, la plataforma en desarrollo servirá para ordenar esas conversaciones, responsabilidades y actividades cuando la estructura interna sea validada y publicada por el club.\n\nFuente: Rotary International · Nuestra estructura. https://www.rotary.org/es-mx/who-we-are/our-structure","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Cómo se organiza Rotary para convertir vínculos en servicio"}$club_seed$, $club_seed$archivo$club_seed$,
   'published', true, '2026-09-02T16:00:00.000Z'::timestamptz, '2026-09-02T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-courtyard.png$club_seed$),
  -- areas-de-interes-de-rotary
  ($club_seed$Siete caminos para enfocar el impacto$club_seed$, $club_seed$areas-de-interes-de-rotary$club_seed$, $club_seed$Las áreas de interés de Rotary ayudan a convertir una intención de servicio en una conversación con rumbo.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Rotary concentra sus esfuerzos en siete áreas de interés: promover la paz; combatir enfermedades; suministrar agua, saneamiento e higiene; proteger la salud materno-infantil; apoyar la educación y la alfabetización; impulsar el desarrollo económico de las comunidades; y proteger el medioambiente.\n\nLas áreas no sustituyen la escucha local. Funcionan como un marco para investigar una necesidad, sumar capacidades, elegir aliados y evaluar si una acción está produciendo un resultado útil y sostenible.\n\nCada club puede encontrar su propia manera de trabajar estas prioridades. En esta revista, los proyectos y actividades del Club Rotario Santo Domingo Colonial aparecerán como historias verificadas por el equipo editorial del club.\n\nFuente: Rotary International · Áreas de interés. https://www.rotary.org/es-mx/our-causes","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Siete caminos para enfocar el impacto"}$club_seed$, $club_seed$archivo$club_seed$,
   'published', true, '2026-09-03T16:00:00.000Z'::timestamptz, '2026-09-03T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-fortaleza.png$club_seed$),
  -- una-plaza-que-guarda-nuestras-conversaciones
  ($club_seed$Una plaza que guarda nuestras conversaciones$club_seed$, $club_seed$una-plaza-que-guarda-nuestras-conversaciones$club_seed$, $club_seed$Una publicación de prueba para contar cómo el Alcázar y su plaza pueden acompañar la memoria del club.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"El Alcázar de Colón mira hacia la Plaza de España, un espacio abierto donde la Ciudad Colonial reúne visitantes, vecinos e historias. Esta escena sirve como referencia visual para narrar el lugar que acompaña nuestras conversaciones.\n\nEste texto de muestra deja listo el formato para que el club publique después sus propias fotografías, voces y aprendizajes junto a un proyecto de servicio.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Una plaza que guarda nuestras conversaciones"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-04T16:00:00.000Z'::timestamptz, '2026-09-04T16:00:00.000Z'::timestamptz, $club_seed$/alcazar-colon-illustration.png$club_seed$),
  -- el-lugar-tambien-cuenta
  ($club_seed$El lugar también cuenta$club_seed$, $club_seed$el-lugar-tambien-cuenta$club_seed$, $club_seed$Otra crónica de prueba para conectar el servicio, el patrimonio y las personas que hacen comunidad.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"cronica-visual","body":"Una imagen del Alcázar puede abrir una historia sobre cuidado, patrimonio y participación. La publicación final podrá sumar la fecha de la actividad, las organizaciones aliadas y las voces de quienes estuvieron presentes.\n\nMientras se prepara el archivo propio del club, este ejemplo muestra cómo una fotografía realista del entorno puede sostener una narración breve y cercana.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"El lugar también cuenta"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-05T16:00:00.000Z'::timestamptz, '2026-09-05T16:00:00.000Z'::timestamptz, $club_seed$/alcazar-colon-illustration.png$club_seed$),
  -- cuando-una-reunion-se-convierte-en-un-proyecto
  ($club_seed$Cuando una reunión se convierte en un proyecto$club_seed$, $club_seed$cuando-una-reunion-se-convierte-en-un-proyecto$club_seed$, $club_seed$Una guía editorial para contar el paso de la conversación a una acción concreta.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"voces","body":"Toda buena iniciativa empieza con una conversación que ayuda a mirar una necesidad desde varios ángulos. La reunión permite poner sobre la mesa preguntas, capacidades y personas dispuestas a colaborar.\n\nEl proyecto toma forma cuando el equipo acuerda un propósito, una siguiente acción y una manera sencilla de revisar lo aprendido. Esta pieza es un ejemplo de cómo una publicación puede contar ese recorrido sin perder la voz de quienes participaron.","pullQuote":"El proyecto toma forma cuando el equipo acuerda un propósito y una siguiente acción.","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Cuando una reunión se convierte en un proyecto"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-06T16:00:00.000Z'::timestamptz, '2026-09-06T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-las-damas.png$club_seed$),
  -- escuchar-primero-el-comienzo-de-todo-servicio
  ($club_seed$Escuchar primero: el comienzo de todo servicio$club_seed$, $club_seed$escuchar-primero-el-comienzo-de-todo-servicio$club_seed$, $club_seed$Una crónica de muestra sobre las preguntas que ayudan a elegir una causa con sentido.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Antes de elegir una solución, un equipo de servicio necesita acercarse a las personas que viven la situación. Escuchar con atención evita suposiciones y abre espacio para reconocer los recursos que ya existen en la comunidad.\n\nUna historia editorial puede registrar esas voces, las preguntas que cambiaron el rumbo y el acuerdo que permitió avanzar. El resultado es una memoria útil para el club y para quienes quieran sumarse después.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Escuchar primero: el comienzo de todo servicio"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-07T16:00:00.000Z'::timestamptz, '2026-09-07T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-illustration.png$club_seed$),
  -- alianzas-que-suman-capacidades
  ($club_seed$Alianzas que suman capacidades$club_seed$, $club_seed$alianzas-que-suman-capacidades$club_seed$, $club_seed$Un formato de publicación para mostrar cómo varias manos pueden sostener una misma iniciativa.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Los proyectos que perduran suelen reunir conocimientos distintos. Una organización aporta experiencia, otra conoce el territorio y un grupo de voluntariado convierte el plan en presencia constante.\n\nContar la alianza ayuda a reconocer cada aporte y deja una ruta para repetir lo que funcionó. Esta publicación de ejemplo está pensada para documentar acuerdos, aprendizajes y próximos pasos.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Alianzas que suman capacidades"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-08T16:00:00.000Z'::timestamptz, '2026-09-08T16:00:00.000Z'::timestamptz, $club_seed$/colonial-streets.jpg$club_seed$),
  -- la-ciudad-colonial-como-punto-de-encuentro
  ($club_seed$La Ciudad Colonial como punto de encuentro$club_seed$, $club_seed$la-ciudad-colonial-como-punto-de-encuentro$club_seed$, $club_seed$Una pieza visual de muestra para conectar la vida del club con el lugar que comparte.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Los lugares también guardan historias. Una plaza, una calle o una sala de reunión pueden convertirse en el punto donde las personas se reconocen, intercambian ideas y deciden volver a encontrarse.\n\nLa revista puede usar ese paisaje como hilo conductor para presentar actividades, alianzas y recuerdos. Así, cada publicación se siente parte de una misma memoria local.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"La Ciudad Colonial como punto de encuentro"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-09T16:00:00.000Z'::timestamptz, '2026-09-09T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-night.jpg$club_seed$),
  -- aprender-para-servir-mejor
  ($club_seed$Aprender para servir mejor$club_seed$, $club_seed$aprender-para-servir-mejor$club_seed$, $club_seed$Una lectura de muestra sobre el aprendizaje que queda después de cada actividad.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Cada actividad deja algo más que una fotografía. El equipo descubre qué preguntas conviene hacer antes, qué tarea necesita más tiempo y qué decisión permitió cuidar mejor a las personas participantes.\n\nGuardar esas conclusiones convierte una experiencia puntual en conocimiento compartido. Este ejemplo muestra cómo una crónica puede cerrar con aprendizajes claros y una invitación a continuar.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Aprender para servir mejor"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-10T16:00:00.000Z'::timestamptz, '2026-09-10T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-dusk.png$club_seed$),
  -- una-invitacion-abierta-al-companerismo
  ($club_seed$Una invitación abierta al compañerismo$club_seed$, $club_seed$una-invitacion-abierta-al-companerismo$club_seed$, $club_seed$Un ejemplo de historia para explicar cómo una persona puede acercarse al club por primera vez.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"El compañerismo se construye cuando hay espacio para llegar con preguntas, conocer a otras personas y encontrar una forma propia de aportar. La invitación no necesita prometer respuestas perfectas: necesita abrir una conversación honesta.\n\nUna publicación como esta puede presentar el ambiente del club, explicar el próximo paso y mostrar que el servicio también empieza por sentirse parte de una comunidad.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Una invitación abierta al compañerismo"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-11T16:00:00.000Z'::timestamptz, '2026-09-11T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-courtyard.png$club_seed$),
  -- pequenas-acciones-memoria-duradera
  ($club_seed$Pequeñas acciones, memoria duradera$club_seed$, $club_seed$pequenas-acciones-memoria-duradera$club_seed$, $club_seed$Una propuesta de crónica para mostrar el valor de los detalles que sostienen un proyecto.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Hay acciones que parecen pequeñas hasta que se miran juntas: una llamada, una visita, una mesa preparada o una persona que vuelve para ayudar. La memoria del servicio se forma con esos gestos repetidos.\n\nEl archivo editorial puede reunirlos con fotografías, fechas y voces breves. Este texto de muestra sirve como base para futuras historias del Club Rotario Santo Domingo Colonial.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"Pequeñas acciones, memoria duradera"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-12T16:00:00.000Z'::timestamptz, '2026-09-12T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-fortaleza.png$club_seed$),
  -- el-diario-de-un-club-que-escucha
  ($club_seed$El diario de un club que escucha$club_seed$, $club_seed$el-diario-de-un-club-que-escucha$club_seed$, $club_seed$Un formato de diario para reunir notas, acuerdos y escenas de la vida rotaria.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Un diario editorial no tiene que esperar a la gran noticia. Puede comenzar con una escena de reunión, una pregunta que quedó abierta o una idea que necesita más personas alrededor.\n\nPublicar esas notas con orden ayuda a que el club vea su propio proceso y permite que la comunidad siga el camino desde cerca. Esta pieza está pensada como una plantilla narrativa para ese archivo.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"El diario de un club que escucha"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-13T16:00:00.000Z'::timestamptz, '2026-09-13T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-las-damas.png$club_seed$),
  -- el-archivo-que-construimos-juntos
  ($club_seed$El archivo que construimos juntos$club_seed$, $club_seed$el-archivo-que-construimos-juntos$club_seed$, $club_seed$Una publicación de muestra para presentar la revista como memoria viva del club.$club_seed$, $club_seed${"format":"club-editorial","version":2,"layoutId":"portada","body":"Una revista social se vuelve más valiosa con el tiempo: cada texto suma contexto, cada imagen devuelve una conversación y cada fecha ayuda a entender cómo creció una iniciativa.\n\nEl archivo del club se irá construyendo con publicaciones revisadas por sus miembros. Esta muestra señala el lugar donde caben las próximas voces, proyectos y aprendizajes.","pullQuote":"","inlineImagePath":null,"inlineImageAlt":"","inlineImageCaption":"","inlineImageAfterParagraph":-1,"inlineImageAlignment":"wide","gallery":[],"coverImageAlt":"El archivo que construimos juntos"}$club_seed$, $club_seed$otro$club_seed$,
   'published', true, '2026-09-14T16:00:00.000Z'::timestamptz, '2026-09-14T16:00:00.000Z'::timestamptz, $club_seed$/zona-colonial-illustration.png$club_seed$)
on conflict (slug) do nothing;

-- 3. Publication rules for every write. Direct client writes (current_user = authenticated)
--    are checked; trusted backend roles keep their behaviour, as in the other guards.
create or replace function private.guard_story_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The visibility flag always follows the status, before the CHECK constraint runs.
  -- The CHECK stays in place as a backstop.
  new.is_public := (new.status = 'published');

  if current_user = 'authenticated'
     and (
       new.status in ('published', 'archived')
       or (tg_op = 'UPDATE' and old.status in ('published', 'archived'))
     )
     and not (select private.can_publish_stories()) then
    raise exception 'publisher_required' using errcode = '42501';
  end if;

  -- Publication dates come from the first publication and never move or clear.
  if tg_op = 'UPDATE' then
    new.published_at := coalesce(
      old.published_at,
      case when new.status = 'published' then new.published_at end
    );
    new.first_published_at := coalesce(
      old.first_published_at,
      case when new.status = 'published' then new.first_published_at end
    );
  elsif new.status <> 'published' then
    new.published_at := null;
    new.first_published_at := null;
  end if;

  if new.status = 'published' then
    new.published_at := coalesce(new.published_at, now());
    new.first_published_at := coalesce(new.first_published_at, new.published_at);
  end if;

  return new;
end;
$$;

create or replace function private.guard_story_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not (select private.can_publish_stories()) then
    raise exception 'publisher_required' using errcode = '42501';
  end if;
  return old;
end;
$$;

-- 4. Notices. Each recipient list excludes the signed-in actor.
create or replace function private.notify_story_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if new.status = 'review' and (tg_op = 'INSERT' or old.status is distinct from 'review') then
    insert into public.notifications (user_id, kind, title, body, href)
    select membership.user_id, 'general', 'Texto para revisar en la Revista',
      new.title || ' espera revisión para publicarse.', '/plataforma?tab=revista'
    from public.memberships as membership
    where membership.membership_status = 'active'
      and (
        membership.membership_role in ('club_manager', 'admin')
        or (membership.membership_role = 'editor' and membership.can_publish_stories)
      )
      and membership.user_id is distinct from actor_id;
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.first_published_at is null) then
    insert into public.notifications (user_id, kind, title, body, href)
    select membership.user_id, 'general', 'Nueva publicación en la Revista',
      new.title, '/revista/' || new.slug
    from public.memberships as membership
    where membership.membership_status = 'active'
      and membership.user_id is distinct from actor_id;
  end if;

  return null;
end;
$$;

create trigger stories_guard_publication
before insert or update on public.stories
for each row execute function private.guard_story_publication();

create trigger stories_guard_delete
before delete on public.stories
for each row execute function private.guard_story_delete();

create trigger stories_notify_status
after insert or update on public.stories
for each row execute function private.notify_story_status();

-- Privileges.
revoke all on function private.can_publish_stories() from public, anon, service_role;
grant execute on function private.can_publish_stories() to authenticated;

revoke all on function public.can_publish_stories() from public, anon, service_role;
grant execute on function public.can_publish_stories() to authenticated;

revoke all on function public.set_story_publisher(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_story_publisher(uuid, boolean) to authenticated;

revoke all on function private.membership_reset_story_publisher() from public, anon, authenticated, service_role;
revoke all on function private.guard_story_publication() from public, anon, authenticated, service_role;
revoke all on function private.guard_story_delete() from public, anon, authenticated, service_role;
revoke all on function private.notify_story_status() from public, anon, authenticated, service_role;
