# Memoria del Club Rotario Santo Domingo Colonial

Última actualización: 2026-09-30. Documento permanente del repositorio para retomar el trabajo y conservar decisiones aceptadas. Verificar los estados que puedan haber cambiado antes de actuar.

## Contexto y decisiones vigentes

- Web pública en español con estilo de revista social, ilustraciones de la Ciudad Colonial, historias y llamados a integrarse al club. El Alcázar de Colón es el monumento emblema.
- Mantener el intro azul original con la identidad Rotary (`CinematicIntro` en `app/page.tsx`). El usuario descartó el intro de video y el recorrido 3D del Alcázar; no retomarlos sin una nueva instrucción.
- Texto del header, a la derecha del logo: **Generar un impacto duradero** (corrección expresa del usuario, 2026-09-30).
- Texto grande del hero, tal como fue solicitado y está implementado: **Dar de si antes de pensar en si**.
- La plataforma privada es un sistema de gestión: eventos, asistencia, propuestas, actividades, tareas, comités, publicaciones, miembros y mensajería.
- Zona horaria del producto: `America/Santo_Domingo`. La agenda y la auditoría deben mostrar fechas y horas del club.
- Formato de auditoría aceptado: **DD/MM/AA HH:mm:ss**, por ejemplo **30/09/26 02:05:28**, con hora de 24 horas. La última corrección expresa del usuario fue día/mes/año; reemplaza la respuesta anterior mes/día/año.
- JEP quedó descartado por instrucción expresa del usuario. Codex toma decisiones con el contexto, evidencia y las herramientas disponibles; documentar las decisiones relevantes aquí.

## Entorno y límites

- Repositorio: `/Users/jreynoso/ClubRotario`.
- Stack observado: Next.js 16.3.4 App Router, React 19.2.8, TypeScript, Supabase Auth/Postgres/Storage. `package.json` es la fuente de las versiones actuales.
- Desarrollo local utilizado en esta sesión: `http://127.0.0.1:3001/`; gestión: `/plataforma`. Antes de iniciar o detener un servidor, comprobar quién es dueño del puerto y del proceso.
- Backend de este proyecto: **ClubRotarioSDC**, ref **rjqqqixfsxjfmhtobumu**. No utilizar proyectos de otras aplicaciones. El usuario reactivó este proyecto después de encontrarlo pausado.
- Los secretos se mantienen fuera del código y de esta memoria. Las credenciales de servicio solo pueden usarse en el servidor, dentro de la autorización vigente.
- Producción: `https://clubrotariosdc.vercel.app`, proyecto Vercel `clubrotariosdc`, despliegue automático desde `main`. El commit de módulos `f0f52184` se publicó el 2026-09-30 en `dpl_73mULZ38t7DLTA7L2g8EJ2wbhf1x`, estado `READY`; la portada y `/solicitar-membresia` respondieron HTTP 200. La inspección autenticada de los módulos de gestión sigue pendiente.
- No ejecutar `next build` sobre el mismo directorio de salida mientras el servidor de desarrollo esté activo: verificar primero para evitar interferencia con sus artefactos.

## Permisos y comportamiento de eventos

- La identidad se comprueba con `supabase.auth.getUser()` y los permisos con `public.memberships`: rol y estado de la membresía. No autorizar desde `user_metadata` editable.
- Roles de aplicación: `member`, `coordinator`, `editor`, `club_manager`, `admin`; una membresía suspendida o pendiente no conserva las capacidades de una activa.
- Administradores y gestión del club pueden crear, editar y eliminar eventos y consultar la lista de asistentes según las capacidades del servidor. Cada miembro activo puede confirmar o cancelar su propia asistencia; una confirmación por miembro y evento.
- El resumen muestra próximos eventos publicados. La agenda de gestión incluye próximos eventos e historial, con consultas limitadas a 30 de cada grupo.
- La migración `supabase/migrations/20260930042056_published_member_events_access.sql` **se aplicó en Supabase**: miembros activos pueden ver eventos internos publicados, manteniendo RLS y controles de gestión.
- Las pruebas de la sesión anterior verificaron gestión de eventos, confirmación/cancelación y listado de asistentes. Se eliminaron los registros temporales de prueba y se conservaron los tres eventos originales.

## Auditoría activada en Supabase y publicada

- Pestaña **Auditoría** publicada en producción, visible solo para administradores activos. Consultas paginadas de 50 registros, filtros, búsqueda y detalle de campos antes/después; se consulta al abrir la pestaña para evitar cargarla durante el inicio de sesión.
- Migración `supabase/migrations/20260930050755_detailed_admin_audit_trail.sql` **aplicada en Supabase `rjqqqixfsxjfmhtobumu` el 2026-09-30**, después de la autorización expresa del usuario para terminar de activarla. Registra cambios en 16 tablas públicas, archivos de los buckets del club y cambios seguros en cuentas/sesiones de Auth. El registro es inmutable para la aplicación y su lectura exige administrador activo.
- Contraseñas, hashes y tokens quedan fuera del registro; un cambio de contraseña se representa como una indicación del cambio. No confundir datos de sesión con una atribución comprobada de quién causó su eliminación.
- Aplicación realizada desde el SQL Editor del Dashboard del proyecto, en una transacción. El conector MCP devolvió falta de permisos; no se utilizó otro proyecto ni se ejecutó un `db push` general. Antes de aplicar se confirmó que no existía `audit_log` y que las 16 tablas públicas estaban presentes.
- Verificación remota: RLS habilitado, 19 disparadores de captura activos, 2 disparadores de inmutabilidad, un registro de activación, lectura anónima denegada y permisos de escritura/borrado/ejecución del escritor retirados de la aplicación.
- Las pruebas SQL también pasaron sobre el backend real: atribución de actores, valores antes/después, supresión de cambios sin efecto, borrados en cascada, cuentas/sesiones de Auth, metadatos de archivos, lectura solo para administradores, inmutabilidad y exclusión de credenciales. Todos esos datos temporales se revirtieron con `ROLLBACK`. La eliminación de metadatos de Storage se probó en el PostgreSQL aislado, no se repitió directamente en el Storage remoto.
- Security Advisor se volvió a ejecutar después de aplicar: 0 errores y una advertencia independiente de Auth por protección de contraseñas filtradas desactivada. No se cambiaron los ajustes de Auth ni el plan durante esta activación.
- Verificación en la web autenticada: la pestaña Auditoría muestra la activación y cambios reales de una confirmación/cancelación temporal en «Prueba · Mesa de propuestas». Se comprobó el detalle antes/después mediante las acciones del servidor. Se retiró únicamente la fila temporal de asistencia y se verificó que volviera a estar ausente; el historial de esa comprobación se conserva. Los tres eventos originales y los datos del club permanecen intactos.
- El historial comenzó con la activación a las 01:56:28 de Santo Domingo el 2026-09-30; no reconstruye cambios anteriores. Evidencia local: `rotary-audit-active-detail.jpg` en la carpeta de visualizaciones de esta conversación.
- La base no tenía `supabase_migrations.schema_migrations` al aplicar. Esta aplicación manual está verificada en el catálogo y el registro de activación; antes de utilizar un futuro `supabase db push`, reconciliar el historial remoto sin volver a ejecutar migraciones ya aplicadas.
- Verificación local previa conservada: 15 pruebas Node, lint y TypeScript satisfactorios; migración y pruebas SQL en un PostgreSQL 17.9 aislado. Su servidor y datos temporales se eliminaron.

## Tabla de auditoría compacta

- Controles de 31 px y filas de 36 px; acción, módulo y registro en columnas separadas. El detalle conserva los valores completos antes/después, contexto y registros originales.
- Menú **Columnas** para mostrar, ocultar, mover y restablecer la distribución, guardada en este navegador. Solo se guardan preferencias de columnas, no los datos de auditoría.
- Encabezados con orden ascendente/descendente aplicado en Supabase sobre todo el historial. La paginación de 50 registros conserva el orden seleccionado, desempates por fecha/ID y microsegundos; valida columnas y escapa valores del cursor.
- Fechas numéricas día/mes/año y hora de 24 horas en la tabla y el detalle. Los filtros Desde/Hasta usan DD/MM/AA, validan fechas del calendario y consultan el intervalo inclusivo en Santo Domingo.
- Verificación local 2026-09-30: 21 pruebas Node, lint y TypeScript satisfactorios; web autenticada comprobada con los cuatro registros reales, orden por fecha/persona, mover/ocultar/mostrar y persistir columnas, búsqueda, fechas válidas/inválidas y detalle antes/después. Vista de 375 px sin desbordamiento de página; la tabla tiene desplazamiento horizontal propio.
- Publicada con el commit `2dfc5f7`; Vercel quedó `READY`. En la UI autenticada de producción se confirmó la tabla compacta con cinco registros y fechas DD/MM/AA en hora de 24 horas. No requirió cambios adicionales en el esquema ni en los permisos remotos de Supabase.

## Notificaciones de la plataforma

- Botón **Notificaciones** en la cabecera del panel para membresías activas. Muestra el total sin leer y un menú con los seis avisos recientes, estado vacío/error, fechas locales y acceso a **Mensajes**.
- **Marcar como leído** reutiliza `markNotificationReadAction` y valida la identidad, UUID y propiedad del aviso (`user_id`); no se añadieron tablas ni migraciones.
- Verificación 2026-09-30: compilación, TypeScript, lint y `git diff --check` satisfactorios. Commit `ebeb897` publicado en producción; despliegue Vercel `dpl_H1EwEpwT5PZXq98RgD7pfFmoNqEJ` `READY`. En `/plataforma` autenticado se comprobó botón, apertura del menú, estado **0 sin leer**, CTA a Mensajes y retorno a Resumen; no se cambió el estado de ningún aviso.

## Presentación de la agenda interna

- Los eventos publicados y futuros resaltan con un fondo suave en dorado Rotary y una guía lateral; cada evento usa una tarjeta compacta con fecha, lugar y controles agrupados. Borradores, eventos cancelados o archivados y eventos pasados conservan el tratamiento neutro. En pantallas estrechas, la información y los controles se apilan para evitar desbordamientos.
- El modelo de eventos no registra una fecha de creación/publicación para identificar novedad cronológica; se usa el mismo criterio de evento publicado y futuro que abre la confirmación de asistencia, sin etiquetar falsamente como “nuevo” por antigüedad.
- Verificación local 2026-09-30: `npm test` (33/33), `npm run lint`, `npx tsc --noEmit` y `git diff --check` satisfactorios. No se comprobó visualmente la vista autenticada del navegador ni se publicó el cambio.

## Gestión de comités

- Solo administradores activos pueden crear, editar, asignar o cambiar roles de integrantes, retirarlos y dar por terminado un comité. La pantalla ofrece cuatro roles: integrante, presidencia, secretaría y tesorería. La creación guarda el comité y la lista inicial en una sola función transaccional; solo acepta membresías activas y evita integrantes repetidos.
- Terminar un comité marca `is_active = false` y conserva el comité, su nómina y el historial de auditoría. Los comités terminados se muestran como archivo a los administradores; sus listas quedan protegidas contra cambios directos. No hay borrado de comités desde la aplicación.
- Implementación en `feature/admin-committee-management` y `main`: `app/plataforma/CommitteeManager.tsx`, acciones del servidor, permisos RLS y `supabase/migrations/20260930143808_admin_committee_management.sql`. La migración se aplicó el 2026-09-30 en el proyecto de producción `ClubRotarioSDC` (`rjqqqixfsxjfmhtobumu`) mediante el SQL Editor del Dashboard, dentro de una transacción. La verificación de catálogo confirmó las tablas, RLS y políticas esperadas. El acceso de MCP sigue devolviendo `-32600` y el CLI no lista este proyecto. No existe `supabase_migrations.schema_migrations`; no ejecutar un `db push` general ni inventar el historial de migraciones.
- Verificación local 2026-09-30: 33 pruebas Node, `npm run lint`, `npx tsc --noEmit` y `git diff --check` satisfactorios. La ruta local `/plataforma` responde y redirige a inicio de sesión; el navegador autenticado no se pudo inspeccionar porque la Mac estaba bloqueada. Las pruebas SQL pgTAP quedaron añadidas en `supabase/tests/admin_committee_management_test.sql`, pero no se ejecutaron porque el Docker local no está disponible.

## Propuestas y votación de miembros

- Cada propuesta guarda como autor el UUID de la sesión Supabase autenticada (`created_by`); la acción ignora cualquier identidad enviada desde el formulario. La base impide cambiar el autor luego de crearla y la tarjeta muestra el nombre asociado al perfil.
- Los miembros activos pueden consultar propuestas enviadas, en revisión y con decisión final. Las propuestas en borrador siguen limitadas a su autor y al equipo de gestión.
- Coordinadores, administradores y responsables del club pueden activar o cerrar una votación por propuesta mientras esté enviada o en revisión. Cada miembro activo puede votar a favor, en contra o abstenerse, y cambiar su voto mientras esté abierta. El conteo permanece oculto hasta el cierre; después se muestran totales agregados, sin revelar votos individuales. La auditoría registra quién participó, pero excluye la selección secreta.
- Implementación publicada en `main` en `app/plataforma/ProposalCard.tsx`, `app/plataforma/PlatformWorkspace.tsx`, `app/plataforma/actions.ts`, `lib/platform.ts` y `supabase/migrations/20260930153044_proposal_member_voting.sql`. La migración se aplicó en producción el 2026-09-30; la verificación confirmó `proposal_votes`, RLS, políticas y las columnas de votación. La prueba pgTAP `supabase/tests/proposal_voting_rls_test.sql` sigue pendiente: pgTAP no está instalado en el proyecto y no se instaló para esta activación.
- Verificación local 2026-09-30: 38 pruebas Node, lint, TypeScript, `git diff --check` y estado de CodeGraph satisfactorios. pgTAP no se ejecutó porque Docker no está disponible y no se verificó el flujo visual autenticado. La migración de producción se aplicó después de esta verificación local.

## Finanzas del club

- Módulo de gestión financiera local en `Plataforma → Finanzas`, con obligaciones mensuales por miembro, registro de pagos parciales, aportes para actividades, donaciones y gastos. Moneda inicial: pesos dominicanos (DOP/RD$). Los administradores y responsables activos del club gestionan los datos; cada miembro activo consulta sus propias obligaciones y aportes.
- `finance_monthly_dues` mantiene el saldo mensual pendiente y `finance_entries` registra movimientos inmutables. Las funciones RPC guardan el actor autenticado, operaciones transaccionales, referencias y snapshots de miembro/actividad; el trigger existente captura los cambios en la auditoría. Los ajustes se registran como movimientos adicionales. RLS restringe lecturas y la aplicación no concede escritura directa a las tablas.
- Implementación publicada en `main` en `app/plataforma/FinanceModule.tsx`, `lib/finance.ts`, `app/plataforma/actions.ts`, `app/plataforma/PlatformWorkspace.tsx`, `lib/platform.ts`, `supabase/migrations/20260930160850_club_finance_management.sql` y `supabase/tests/club_finance_management_rls_test.sql`. La migración se aplicó en producción el 2026-09-30; la verificación confirmó ambas tablas, RLS, políticas y las cinco funciones RPC previstas. La prueba pgTAP sigue pendiente porque la extensión no está instalada; no se instaló durante la activación.
- Verificación local 2026-09-30: 44 pruebas Node, lint, TypeScript, build de Next.js, `git diff --check` y CodeGraph satisfactorios. PgTAP no se pudo ejecutar porque el PostgreSQL local de Supabase no está disponible (conexión rechazada en 54322); la interfaz autenticada tampoco se verificó visualmente. La migración de producción se aplicó después de esta verificación local.

## Solicitudes públicas para ingresar al club

- Los botones **Quiero ser miembro** de la portada y el pie llevan a `/solicitar-membresia`; **Acceso miembros** conserva el inicio de sesión. El formulario solicita nombre, correo, teléfono y motivación; ocupación y referencia son opcionales. La persona debe consentir que sus datos de contacto y solicitud sean visibles para todos los miembros activos y la presidencia.
- El envío valida y normaliza datos en una Server Action, ignora un campo honeypot y solo inserta los campos permitidos. La pestaña **Solicitudes** carga las solicitudes al abrirse; todos los miembros activos pueden revisarlas y contactar al solicitante. Administradores y responsables del club pueden marcar seguimiento, invitación o rechazo; el servidor fija al revisor desde la sesión autenticada.
- La migración `supabase/migrations/20260930163901_public_membership_applications.sql` restringe columnas de inserción pública, no concede lectura a visitantes y protege la lectura con RLS. Incluye estados, consentimiento, atribución de revisión y captura en la auditoría. La prueba está en `supabase/tests/club_membership_applications_rls_test.sql`.
- Implementación publicada en `main` en `app/solicitar-membresia/`, `lib/membership-applications.ts`, `app/plataforma/MembershipApplicationsModule.tsx` y acciones de `app/plataforma/actions.ts`. La migración se aplicó en producción el 2026-09-30; la verificación confirmó RLS y políticas, inserción pública limitada a las columnas del formulario y ausencia de lectura o actualización anónimas. La prueba pgTAP sigue pendiente porque la extensión no está instalada. No existe el historial estándar de Supabase en este proyecto.
- Verificación local 2026-09-30: 53 pruebas Node, lint, TypeScript, CodeGraph actualizado, `git diff --check` y HTTP 200 para portada y formulario. El navegador local respondió a la ruta, pero el controlador visual no pudo enfocar su pestaña por timeout. La migración de producción se aplicó después; no se insertaron solicitudes de prueba en remoto.

## Mapa útil del código

| Área | Archivos principales |
| --- | --- |
| Portada e intro azul | `app/page.tsx`, `app/globals.css` |
| Header, footer y marca | `components/public/PublicChrome.tsx`, `components/public/public.module.css` |
| Contenido público | `lib/editorial.ts`, `lib/supabase/public-feed.ts`, `lib/supabase/timeout.ts` |
| Agenda y revista públicas | `app/eventos/`, `app/revista/`, `app/nosotros/` |
| Sesión y cliente Supabase | `app/auth/`, `utils/supabase/`, `proxy.ts` |
| Datos y capacidades de gestión | `lib/platform.ts`, `app/plataforma/page.tsx` |
| Interfaz y acciones de gestión | `app/plataforma/PlatformWorkspace.tsx`, `app/plataforma/CommitteeManager.tsx`, `app/plataforma/FinanceModule.tsx`, `app/plataforma/actions.ts` |
| Modelo financiero | `lib/finance.ts`, `supabase/migrations/20260930160850_club_finance_management.sql`, `supabase/tests/club_finance_management_rls_test.sql` |
| Gestión de eventos y asistencia | `app/plataforma/PlatformEvents.tsx` |
| Modelo e interfaz de auditoría | `lib/audit.ts`, `lib/audit-table.ts`, `app/plataforma/PlatformAudit.tsx` |
| Esquema y verificaciones de auditoría | `supabase/migrations/`, `supabase/tests/detailed_admin_audit_test.sql`, `tests/` |

Las portadas con ruta que comienza por `/` son recursos locales; conservar esa distinción frente a objetos de Supabase Storage. Las consultas públicas tienen un tiempo límite para que una caída del backend no bloquee la navegación indefinidamente. No presentar eventos inventados como eventos reales cuando falle la conexión.

## CodeGraph y flujo de trabajo

- CodeGraph 1.5.0 ya instalado e integrado como servidor MCP de Codex; índice local en `.codegraph/`, excluido de Git. Se verificaron el proyecto correcto, una consulta MCP y actualización automática en el registro del daemon el 2026-09-30.
- Consultar CodeGraph **antes** de buscar o leer código para ubicar símbolos y dependencias. Pasar la raíz correcta en `projectPath` cuando se use MCP. Consultar archivos directamente si el índice no cubre esa información.
- Comandos: `npm run codegraph:status`, `npm run codegraph:sync`, `npm run codegraph:explore -- "símbolos o pregunta"`. En una copia nueva: `npm run codegraph:init` con el CLI instalado.
- Leer la guía relevante de `node_modules/next/dist/docs/` antes de escribir código Next.js. Conservar el bloque generado de Next.js en `AGENTS.md`.
- Validación habitual según el cambio: `npm run lint`, `npx tsc --noEmit`, `npm test`, `git diff --check`; verificar en navegador los flujos modificados. CodeGraph ayuda a comprender el código, pero no prueba su funcionamiento.
- Al cerrar una tarea, actualizar esta memoria con decisiones duraderas, evidencia y pendientes. Registrar por separado cualquier migración remota o publicación, con su resultado real; nunca marcarla aplicada por existir el archivo.

## Registro de decisiones

| Fecha | Decisión | Motivo y evidencia |
| --- | --- | --- |
| 2026-09-30 | Conservar intro azul, ajustar el texto de marca y el hero | El usuario corrigió el header a “Generar un impacto duradero”; se conservan también el intro azul y “Dar de si antes de pensar en si”. |
| 2026-09-30 | Gestión de eventos con confirmación personal de asistencia | Petición del usuario; acciones protegidas, listado de asistentes y flujo verificados durante la sesión. |
| 2026-09-30 | Auditoría detallada solo para administradores activos | El usuario autorizó la activación; migración aplicada y pruebas de permisos/captura completadas en Supabase y la web local. |
| 2026-09-30 | Auditoría compacta y fechas DD/MM/AA con hora de 24 horas | Corrección expresa día/mes/año; controles de columnas, ordenación y filtros verificados en la web autenticada. |
| 2026-09-30 | Botón de notificaciones en la cabecera de gestión | Petición del usuario; publicado con `ebeb897`, Vercel `READY` y menú verificado en el panel autenticado de producción. |
| 2026-09-30 | Gestión y cierre histórico de comités solo para administradores activos | Petición del usuario; UI, acciones, RLS y migración local preparadas, con 32 pruebas Node, lint y TypeScript satisfactorios. La migración de producción está aplicada y verificada; la inspección visual autenticada no se completó. |
| 2026-09-30 | Guardar autor inmutable y habilitar votación secreta por propuesta | Petición del usuario; UI y migración integradas en `main` y publicadas en Vercel; pgTAP no ejecutado por falta de la extensión en remoto. |
| 2026-09-30 | Registrar cuotas, aportes, donaciones y gastos con visibilidad por rol | Petición del usuario; DOP inicial, pagos parciales y bitácora de movimientos para gestores; cada miembro solo ve sus propios datos. UI y migración en `main` y producción; pruebas de aplicación aprobadas, pgTAP no ejecutado por falta de la extensión remota. |
| 2026-09-30 | Recibir y revisar solicitudes de ingreso desde la portada | Formulario publicado desde la portada y desplegado en producción; migración aplicada en Supabase y permisos anónimos comprobados. |
| 2026-09-30 | Mantener CodeGraph y memoria en el repositorio | Petición expresa del usuario; MCP e índice existentes verificados, comandos e instrucciones permanentes añadidos. |
| 2026-09-30 | Descartar JEP | El usuario retiró expresamente esa integración; no añadir dependencias ni llamadas a ese servicio. |
| 2026-09-30 | Separar publicaciones reales y maquetas en Revista; crear editor modal con tres plantillas fijas | `stories` tenía 0 filas en Supabase. La página pública distingue el archivo del club de referencias y ejemplos; el formulario define posiciones de imagen, titular, cita y texto. Sin cambios de esquema ni filas de prueba. |

## Revista editorial y compositor de publicaciones

- `/revista` lista solo historias propias que están publicadas y son públicas. Con una consulta vacía o con error, muestra el estado vacío del archivo real y mantiene aparte las lecturas informativas y maquetas locales, identificadas por tipo; nunca las presenta como posts publicados.
- En `Plataforma → Revista`, el archivo de historias publicadas y borradores aparece junto al acceso **Nueva publicación**. El formulario es un diálogo modal con tres composiciones permitidas: **Portada**, **Crónica visual** y **Voces**. Cada una fija dónde aparecen titular, bajada, imágenes, cita y cuerpo.
- El documento editorial versionado se guarda en la columna `stories.content` ya existente, en JSON validado por `lib/editorial-content.ts`; los registros de texto plano antiguos mantienen el render anterior. No hizo falta migración.
- Las imágenes opcionales se suben con la sesión del usuario al bucket público existente `club-public`, usando solo JPG/PNG/WebP de hasta 10 MB. La base de datos y el bucket conservan los permisos de edición existentes (`editor`, `club_manager`, `admin`); solo esos roles pueden crear, publicar o cambiar la visibilidad de historias. La publicación pública revalida `/revista` y el detalle correspondiente.
- Verificación 2026-09-30: consulta administrativa confirmó `public.stories` con 0 filas; el modal y sus tres opciones se inspeccionaron en navegador, también la revista y una maqueta existente. La ruta pública de producción muestra el estado vacío real y las referencias/maquetas aparte. 27 pruebas Node, `npm run lint`, `npx tsc --noEmit` y `git diff --check` satisfactorios. No se enviaron posts ni imágenes a Supabase durante la prueba. Commit `2024e0a` está en `main`; Vercel `dpl_HBLQt9gZPhY86pS6RGJuP8bumM43` quedó `READY` y se verificó `/revista` en producción.


## Aplicación de migraciones en Supabase

- 2026-09-30: se aplicaron manualmente, cada una dentro de una transacción, `20260930143808_admin_committee_management.sql`, `20260930153044_proposal_member_voting.sql`, `20260930160850_club_finance_management.sql` y `20260930163901_public_membership_applications.sql` en `ClubRotarioSDC` (`rjqqqixfsxjfmhtobumu`, rama de producción), mediante el SQL Editor autenticado. Cada ejecución terminó con `Success. No rows returned`.
- Consulta remota de solo lectura confirmó las siete tablas de comités, propuestas, votos, finanzas y solicitudes con RLS activado; las políticas de votación, finanzas y solicitudes; las funciones RPC de votación/finanzas y la función de creación de comités; y privilegios de solicitudes que permiten insertar al rol `anon` solo los datos previstos sin lectura ni revisión anónimas.
- `supabase_migrations.schema_migrations` no existe en la base y la CLI no tiene enlazado este proyecto. No se ejecutó `db push` ni se fabricó el historial. Las pruebas pgTAP no se ejecutaron porque la extensión no está instalada; no se instaló en producción. Las migraciones quedan aplicadas, pero el historial CLI requiere reconciliación antes de volver a usar `db push`.
- El código local continúa en `feature/admin-committee-management`; no se hizo commit, push a `main` ni despliegue como parte de esta activación de esquema.


## Integración en main y publicación de los módulos

- El 2026-09-30, `f0f52184a574d4b61d2c7ef9b7b2cbd28680b1ce` (`feat: add club membership and management modules`) se integró por avance rápido en `main` y se subió a `origin/main`. Incluye solicitudes de membresía, comités, votación, finanzas, los ajustes de agenda y marca, sus pruebas y las cuatro migraciones aplicadas previamente en Supabase.
- Vercel desplegó ese commit en producción como `dpl_73mULZ38t7DLTA7L2g8EJ2wbhf1x` (`READY`), alias `https://clubrotariosdc.vercel.app`. Se comprobaron HTTP 200 para `/` y `/solicitar-membresia`. La UI autenticada de gestión no se inspeccionó visualmente y pgTAP sigue sin ejecutarse.

## Fotografías sociales para solicitudes de membresía

- `/solicitar-membresia` reserva tres espacios editoriales para foto grupal, servicio comunitario y compañerismo; mientras no haya imágenes publicadas, conserva marcos vacíos con su título. El módulo `Plataforma → Fotografías` solo se muestra a editores, responsables activos del club y administradores; permite cargar/reemplazar/retirar fotos, definir texto alternativo y pie de foto, y publicar cada espacio. Se aceptan JPG/PNG/WebP hasta 10 MB en el bucket público existente `club-public`; publicar requiere imagen y texto alternativo. La interfaz recuerda publicar solo imágenes autorizadas para uso público.
- `supabase/migrations/20260930204143_membership_photo_gallery.sql` crea los tres espacios con claves fijas, habilita RLS y registra cambios en la auditoría. Se aplicó manualmente en producción el 2026-09-30 mediante el SQL Editor autenticado y se verificaron tabla, tres filas, RLS, políticas y triggers. El CLI todavía no está enlazado al proyecto y no existe `supabase_migrations.schema_migrations`; no usar `db push` hasta reconciliar el historial.
- Verificación local 2026-09-30: 57 pruebas Node, lint, TypeScript, `git diff --check`, CodeGraph actualizado y revisión visual local de `/solicitar-membresia` con sus tres espacios vacíos. El módulo de gestión requiere sesión autorizada y queda para comprobación visual en producción; no se subieron fotos ni datos de personas durante la prueba.
- Código integrado en `main` y publicado el 2026-09-30 mediante `5a6fc73` (`feat: add editable club photo slots`). Vercel produjo `dpl_5noUoGBK5RPFq2Svkx1q2f5QzY9i` con estado `READY`; `/solicitar-membresia` respondió HTTP 200 en producción y mostró los títulos y marcos vacíos previstos. La consulta de logs no devolvió errores ni otros logs en la última hora. No hay fotografías cargadas todavía.
