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

## Cierre de verificación autenticada y correcciones del 2026-09-30

- Se recuperó el contexto de las conversaciones «Anima el Alcázar con scroll» y «Rediseña web del Club Rotario», y se verificaron las sesiones autenticadas de la plataforma local y de producción. La inspección visual pendiente de Organización, Propuestas, Finanzas, Solicitudes, Fotografías, Agenda y Auditoría quedó completada; también se revisaron Mensajes y las tres plantillas del compositor editorial. La solicitud pública muestra los tres espacios fotográficos previstos. No se publicaron fotografías, historias ni solicitudes de prueba.
- Las pruebas pgTAP pendientes de comités, votación, finanzas y solicitudes **se ejecutaron en Supabase de producción**. Se añadieron pruebas de creación/cierre y permisos de comités, y de edición/publicación y permisos de fotografías. Las seis suites aprobaron **96/96 comprobaciones**, incluidos el anonimato de las boletas, los pagos parciales, la idempotencia y el consentimiento de solicitudes. Se corrigió una sentencia de la prueba de solicitudes: un CTE con `UPDATE` debe situarse al nivel superior de la consulta.
- `scripts/prepare-db-verification.mjs` genera una consulta para el SQL Editor con las seis suites y sus hashes SHA-256. Cada suite ejecuta pgTAP y sus datos dentro de una subtransacción que se revierte deliberadamente antes de devolver el resultado. Permite repetir las verificaciones sin instalar pgTAP permanentemente ni conservar cuentas, datos o historial de prueba. Revisar los campos `expected`, `passed`, `failures`, `diagnostics` y `error` del resultado; el éxito de la consulta por sí solo no indica que las pruebas hayan pasado.
- Consulta posterior confirmó 0 cuentas temporales, 0 propuestas/votos, 0 movimientos/cuotas, 0 solicitudes y 0 comités; se conservaron los tres eventos, los tres espacios fotográficos y los siete registros previos de auditoría. pgTAP continuó sin instalar. Evidencia: `supabase-integration-results.json` y `post-test-state.txt` en `/Users/jreynoso/.codex/visualizations/2026/09/30/01a0f471-436b-7780-8f95-17945cd88f9b/`.
- Se encontró y corrigió una omisión de Auditoría en `lib/audit.ts`: se añadió el filtro Finanzas; Miembros y solicitudes incluye `membership_applications`, Propuestas incluye `proposal_votes`, y Archivos y fotografías incluye `site_photo_slots`. Se añadieron nombres de tablas y campos para los módulos nuevos. La captura remota ya funcionaba; la corrección de interfaz y consultas no necesita una migración ni cambia los permisos. Filtro Finanzas verificado en la web local. 58 pruebas de aplicación, lint, TypeScript y compilación de producción satisfactorios. La compilación se realizó en una copia temporal para conservar el servidor local del usuario.
- Corrección integrada en `main` y publicada mediante `f8d4e49fb9a311104dd1098c7331a35219e37afd`. Vercel confirmó `dpl_7zWwEUn9Q8fwKZXiFe5dXydBjJBQ` en `READY` y asignado a `clubrotariosdc.vercel.app`. Verificación con sesión administrativa en producción: los módulos nuevos aparecen en el selector de Auditoría; el filtro Finanzas devuelve correctamente 0 registros frente a los 7 del historial completo. Consola del navegador y logs de ejecución de Vercel sin errores. Evidencia visual: `clubrotario-audit-finance-verified.jpg` junto con los resultados SQL en la carpeta de verificaciones indicada arriba.
- Security Advisor actualizado: **0 errores y 5 advertencias**. Cuatro señalan RPC `SECURITY DEFINER` de votación/finanzas que están intencionalmente expuestas solo a `authenticated`, tienen `search_path` vacío y validan la identidad y membresía/rol antes de operar. Las RPC financieras requieren administración activa; el resumen de votación exige membresía activa, limita las propuestas visibles y oculta el conteo mientras la boleta está abierta. Se revisaron sus definiciones y las pruebas de permisos. Cambiarlas directamente a `SECURITY INVOKER` rompería el libro financiero sin escritura directa y el conteo agregado secreto.
- La quinta advertencia es protección de contraseñas filtradas desactivada. El proyecto sigue en Free y [esta función requiere Pro o superior](https://supabase.com/docs/guides/auth/password-security). No se contrató un plan ni se modificaron contraseñas o ajustes de Auth.
- El historial `supabase_migrations.schema_migrations` sigue ausente. Las migraciones de producto están aplicadas y comprobadas; la reconciliación del historial sigue siendo un requisito de mantenimiento **antes de un futuro `db push`**. No se volvió a ejecutar ninguna migración ni se inventó un historial durante esta verificación.

## Rediseño del espacio de gestión · 2026-09-30

- Se implementó localmente una presentación de dashboard inspirada en la referencia UI Dux aportada por el usuario: barra lateral con iconos, cabecera compacta, fondo gris claro, tarjetas pastel y azul Rotary. En móvil, los módulos pasan a una navegación horizontal. Los estilos están limitados al espacio autenticado; la web pública mantiene su diseño.
- El resumen muestra propuestas visibles, tareas abiertas, comités activos y avisos/mensajes sin leer desde el snapshot real; ofrece accesos a módulos y a las tareas. Las tareas terminadas o canceladas no aparecen como abiertas. Se conservan controles y permisos existentes.
- Verificación: 58/58 pruebas, lint, TypeScript, compilación de producción en copia temporal y diff satisfactorios. Navegador autenticado local: resumen, acceso a propuestas, finanzas, auditoría y notificaciones comprobados; ancho de 390 px sin desbordamiento horizontal. Consola sin errores. Captura `gestion-redesign.png` en la carpeta de visualizaciones de esta conversación.
- Estado: cambios locales para revisión visual, sin commit, push ni despliegue de este rediseño. No se modificaron datos ni esquema remoto.

## Gestión operativa y pulido de módulos · 2026-09-30

- **Interfaz local:** la cabecera utiliza el mismo archivo de logo que la web. La navegación distingue Miembros y comités, Actividades y tareas, Agenda, Revista, Fotos de la web, Finanzas, Propuestas, Solicitudes, Mensajes y Auditoría. Actividades internas y eventos públicos tienen formularios propios; las descripciones de cada módulo aclaran su propósito.
- **Finanzas:** libro de ingresos/egresos con fecha, categoría, miembro, actividad, contraparte, medio de pago y comprobante. Los filtros incluyen miembros históricos y actividades finalizadas; las sumas cubren todos los resultados aunque la tabla pagine de 50 en 50. Las cuotas se generan por miembro seleccionado, con importe individual, vista previa y protección contra duplicados; admiten pagos parciales. No se modifica el importe de una obligación ya creada. El formulario conserva los datos ante errores y el movimiento guardado queda visible en su mes correspondiente.
- **Miembros y actividades:** directorio con búsqueda, estado, perfil, funciones, comités y tareas. Los cambios de acceso validan la sesión y el rol en servidor, preservan las fechas originales y evitan que responsables del club escalen privilegios o alteren administradores. Actividades y tareas permiten crear, editar, asignar y cambiar estados; se carga el historial visible completo con paginación. Las propuestas rechazadas pueden corregirse y reenviarse; la revisión registra al revisor autenticado, exige cerrar la votación y protege contra cambios concurrentes.
- **Revista:** Nueva publicación abre un formulario con contenido y fotografías primero. Se usa “Resumen” en lugar de “bajada”. El diseño de la publicación se elige al final, detrás de un botón que despliega las tres composiciones; la vista previa utiliza el diseño real de la revista. Se pueden editar borradores existentes sin duplicar la historia ni cambiar su ruta. Cancelar el selector de archivos conserva el diálogo, el texto y la imagen previa; los errores de guardado conservan el formulario.
- **Fotos de la web:** un mapa de `/solicitar-membresia` identifica las tres posiciones editables y enlaza a sus anclas exactas. Cada posición muestra fotografía, texto alternativo, pie, cambios pendientes y estado de publicación. Los borradores se conservan al cambiar de posición. Las fotos de artículos se gestionan desde Revista. El logo y las ilustraciones fijas se muestran en un inventario con su ubicación; siguen siendo recursos del diseño y no tienen un editor de reemplazo en este módulo.
- **Supabase aplicado:** `20261001000908_finance_member_dues_and_scope.sql` se ejecutó correctamente en `ClubRotarioSDC` (`rjqqqixfsxjfmhtobumu`) mediante el SQL Editor, dentro de una transacción. Añade `create_finance_member_dues` y `get_finance_scope_totals`; el catálogo confirmó sus privilegios, `search_path` y modelo de seguridad. El historial `supabase_migrations.schema_migrations` continúa ausente; no se ejecutó un `db push` general.
- **Ejemplos solicitados, guardados en Supabase:** `supabase/seeds/club_management_demo.sql` crea tres miembros claramente ficticios (Ana Rivera, Luis Méndez y Carla Santos, con prefijo Prueba), correos `.invalid`, sin contraseña y con inicio de sesión bloqueado. El ejemplo financiero está aislado en enero de 2000: cuotas de RD$500, RD$500 y RD$350; pago completo, parcial y pendiente; cinco movimientos, RD$1,900 de ingresos, RD$650 de egresos y RD$650 de cuotas pendientes. El botón Ver ejemplo abre ese mes. No se crearon movimientos del mes actual. La verificación por interfaz también dejó una historia privada en borrador, una propuesta de prueba, una actividad de prueba y una tarea de prueba; todos se identifican como ficticios. No se publicaron contenidos de prueba en la web ni se enviaron mensajes.
- **Verificación:** 84/84 pruebas de aplicación, lint, TypeScript, diff y compilación de producción satisfactorios; el build se ejecutó en una copia temporal para conservar el servidor local. Las 29/29 comprobaciones SQL de cuotas seleccionadas, pagos parciales, filtros, permisos y RLS aprobaron en el backend real con reversión de los fixtures. Evidencia: `finance-selected-dues-verification.json`. La interfaz autenticada permitió crear/editar contenido, miembros, actividades, tareas y propuestas; comprobó cuotas individuales, filtros financieros, cancelación del selector de archivos y conservación de borradores fotográficos. Todos los módulos se revisaron y los formularios principales se comprobaron a 390 px, sin desbordamiento de página. Capturas `gestion-finanzas-pulidas.png` y `revista-editor-pulido.png` en `/Users/jreynoso/.codex/visualizations/2026/09/30/01a0f49f-3cff-7e63-9430-c36ba46d96dd/`.
- **Estado de publicación:** el pulido de interfaz y acciones sigue local, sin commit, push ni despliegue. Las dos RPC financieras y los ejemplos descritos sí están en Supabase. El servidor local continúa en `http://127.0.0.1:3001/plataforma`.

## Barra de administración compacta · 2026-09-30

- Petición del usuario: separar la navegación administrativa de las páginas compartidas y mostrarla solo al administrador. Para una membresía `admin` activa, Revista (su vista editorial), Fotos de la web y Auditoría salen de la barra principal y pasan a una segunda barra de 60 px a la derecha. Arranca plegada, con iconos y nombres al pasar el puntero o enfocar; el botón superior despliega los nombres completos sin desplazar el contenido.
- La barra principal conserva Resumen, Propuestas, Agenda, Actividades y tareas, Finanzas, Solicitudes, Miembros y comités y Mensajes. Estos módulos tienen funciones compartidas con los miembros. Los editores y responsables del club conservan sus accesos editoriales autorizados en la navegación principal; solo la segunda barra requiere rol `admin`. No se cambiaron permisos de servidor ni RLS.
- En móvil, la segunda barra se convierte en una fila pequeña de iconos debajo de la navegación principal; al expandirla muestra los nombres en dos columnas. Botones con etiquetas accesibles, estado `aria-expanded`, página activa y foco visible.
- Verificación local: render de los cinco roles con acceso activo, pendiente y suspendido (15 combinaciones) confirmó que únicamente el administrador activo ve la barra. Se comprobó que las tres páginas no se duplican en su navegación principal. Navegador autenticado: expansión, contracción, navegación por iconos y selección activa correctas; a 390 px, la página mantiene un ancho de 390 px en ambos estados. Lint, TypeScript, build de producción en copia temporal, diff y CodeGraph satisfactorios; consola sin errores. Capturas `navegacion-admin-compacta.png` y `navegacion-admin-expandida.png` en la carpeta de visualizaciones de esta conversación.
- Estado: ajuste local, sin commit, push, despliegue ni cambios remotos. El servidor de desarrollo existente permanece activo.

## Organigrama rotario y permisos por cargo · 2026-09-30

- Petición del usuario: Miembros y comités debe representar el organigrama del club. Administración define, renombra, ordena, describe, relaciona y asigna cargos a perfiles por año rotario; presidencia, vicepresidencia, tesorería y los demás cargos no reciben privilegios automáticamente.
- Modelo vigente: cada cargo tiene un `access_role` independiente (`member`, `coordinator`, `editor`, `club_manager` o `admin`). Asignar un cargo solo registra la responsabilidad. En el año rotario actual, una casilla explícita permite aplicar ese nivel al miembro en una operación atómica; el administrador no puede degradarse a sí mismo. Los períodos históricos y futuros no alteran accesos actuales. La estructura copiada conserva jerarquía y niveles configurados, pero empieza sin miembros asignados.
- Supabase aplicado: `20261001012240_club_leadership_org_chart.sql` se ejecutó manualmente en `ClubRotarioSDC` mediante el SQL Editor autenticado. Crea períodos y cargos, RLS de lectura para miembros activos, edición solo para administradores, validación de ciclos/cargos activos, optimistic locking, auditoría y RPCs `create_club_leadership_term` y `save_club_leadership_position`. La comprobación posterior confirmó ambas tablas y exactamente una cuenta administradora activa. El historial `supabase_migrations.schema_migrations` continúa ausente; no ejecutar `db push` hasta reconciliarlo.
- Ejemplo visible: el año actual 2026–2027 quedó creado con la plantilla inicial de siete cargos vacantes y etiqueta `Directiva por definir`. Se creó además el período histórico 2000–2001 con etiqueta `Ejemplo ficticio · miembros de prueba`; se asignaron allí Presidencia, Vicepresidencia y Tesorería a los perfiles ficticios y se mostraron niveles independientes sin cambiar sus membresías actuales.
- Verificación: 40/40 comprobaciones SQL del organigrama pasaron en producción dentro de una transacción revertida (`organigrama-pruebas-supabase.json`); cubren RLS, creación idempotente, asignaciones, nombres históricos, ciclos, períodos cerrados, copia de estructura, aplicación explícita de niveles, fechas de membresía, conflicto optimista, autodegradación y roles no administradores. La suite local de organización pasó 8/8; la suite completa Node pasó 92/92; lint, TypeScript, build aislado y `git diff --check` pasaron. CodeGraph quedó sincronizado.
- Estado: código local y esquema remoto aplicados, sin commit, push ni despliegue. El servidor local queda activo en `http://127.0.0.1:3001/plataforma`; no se concedieron nuevos accesos administrativos.

## Ritmo vertical de la página pública del club · 2026-09-30

- Petición del usuario: `/nosotros` acumulaba demasiado fondo vacío entre sus secciones y podía parecer incompleta.
- Se redujeron los paddings verticales de las cronologías, estructura, áreas de interés y fuentes, y los márgenes de la banda final. La jerarquía, bordes, tarjetas y comportamiento móvil se mantienen; la transición entre bloques ya no suma dos espacios editoriales grandes consecutivos.
- Verificación local: `/nosotros` respondió HTTP 200, la revisión visual mostró las cronologías y la estructura sin huecos excesivos, y `npm run lint`, `npx tsc --noEmit` y `git diff --check` pasaron. Evidencia: `nosotros-espaciado-ajustado.png`, `nosotros-transicion-ajustada.png` y `nosotros-estructura-ajustada.png` en la carpeta de visualizaciones de esta conversación.
- Estado: ajuste local sin commit, push ni despliegue.

## Cierre de la transición a historia local · 2026-09-30

- Petición del usuario: retirar la línea bajo la estructura movida, acercar “Una memoria que merece quedar documentada” y eliminar el botón “Compartir información del club”, cuyo `mailto` estaba causando problemas.
- Se quitó el borde superior de `clubHistory`, se redujo su padding superior en escritorio, móvil y paisaje, y se eliminó el botón y sus estilos asociados. La sección del club conserva su aviso y estructura pública.
- Verificación local: el árbol accesible no contiene el botón ni `club@rotariosantodomingo.org`; la transición muestra historia local más arriba y sin la línea divisoria. `/nosotros` respondió HTTP 200; lint, TypeScript, `git diff --check` y CodeGraph pasaron. Evidencia: `nosotros-sin-linea-historia-cerca-2.png`.
- Estado: ajuste local sin commit, push ni despliegue.

## Una sola sección para los tres pilares · 2026-09-30

- Petición del usuario: “Tres piezas. Un mismo propósito” repetía la sección superior “Un club local dentro de una red mundial”.
- Se eliminó la sección superior y se movió la sección de tres piezas inmediatamente debajo del hero. Las cronologías y el resto de la página conservan su contenido; se retiraron los estilos exclusivos de la sección eliminada.
- Verificación local: `/nosotros` muestra una sola estructura, ubicada antes de “Historia local”; el árbol accesible confirma cero apariciones de la sección anterior y una de “Tres piezas”. HTTP 200, lint, TypeScript, `git diff --check` y CodeGraph satisfactorios. Evidencia: `nosotros-estructura-unica-top.png` y `nosotros-estructura-unica-visible.png`.
- Estado: ajuste local sin commit, push ni despliegue.

## Cronología del club sin etiqueta editorial superior · 2026-09-30

- Petición del usuario: en la sección “La red que empezó con una conversación” quitar el encabezado, la etiqueta pequeña “Rotary International”, su línea y el texto descriptivo, conservar la cronología y acercarla a la historia local anterior.
- Se eliminaron el encabezado, el `SectionLabel` y el texto descriptivo de esa cronología; permanecen la introducción, los cuatro hitos y el enlace. La clase específica usa margen superior negativo y padding superior cero (con ajustes propios para móvil y paisaje) para cerrar el espacio con la historia local.
- Verificación local: la vista accesible conserva la cronología y ya no muestra ninguno de los textos superiores retirados; la captura `nosotros-cronologia-sin-texto.png` muestra la transición compacta. `/nosotros` respondió HTTP 200 y pasaron lint, TypeScript, `git diff --check` y CodeGraph.
- Estado: ajuste local sin commit, push ni despliegue.

## Página del club sin referencias a fondos · 2026-09-30

- Petición del usuario: `/nosotros` no debe afirmar que Rotary International, La Fundación Rotaria ni otra entidad suministra fondos.
- Se actualizaron las descripciones de Rotary International y La Fundación Rotaria para hablar de coordinación, programas y colaboración, sin atribuir financiación ni provisión de fondos.
- Verificación local: no quedan coincidencias de fondos o financiamiento en `app/nosotros`; el árbol accesible muestra los nuevos textos, `/nosotros` respondió HTTP 200 y pasaron lint, TypeScript, `git diff --check` y CodeGraph.
- Estado: ajuste local sin commit, push ni despliegue.

## Página pública sin bloque de fuentes · 2026-09-30

- Petición del usuario: retirar “Fuentes consultadas” de `/nosotros`, porque la página representa la voz institucional del propio club.
- Se eliminó la sección completa, sus datos editoriales y sus estilos exclusivos. Se conservaron las referencias puntuales dentro de las cronologías y los enlaces institucionales que explican Rotary, sin dejar un hueco antes de “Ser parte”.
- Verificación local: el árbol accesible de `/nosotros` ya no contiene “Fuentes consultadas”, el cierre muestra directamente “Ser parte”, respondió HTTP 200 y pasaron lint, TypeScript, `git diff --check` y CodeGraph.
- Estado: ajuste local sin commit, push ni despliegue.
## Ajuste del espacio inferior de estructura pública · 2026-09-30

- Petición del usuario: eliminar el espacio inferior visible bajo “Tres piezas. Un mismo propósito.” para cerrar la transición hacia “Historia local”.
- Se dejó la sección `structure` sin padding inferior en escritorio, móvil y paisaje; se conserva el enlace de estructura oficial y el contenido de la sección.
- Estado: ajuste local sin commit, push ni despliegue.

## Publicaciones de revista con fotos dentro del texto y galería · 2026-10-01

- Petición del usuario: estandarizar los artículos según sus layouts y permitir foto principal, foto de apoyo dentro del texto y un carrusel inferior; mostrar fotos en las publicaciones relacionadas y compactar la transición “Continúa leyendo”.
- El editor y la publicación usan el mismo componente editorial para los tres diseños. El formato versionado pasa a v2 y conserva la lectura de documentos v1; cada foto de apoyo admite texto alternativo, pie, párrafo y alineación. La galería admite hasta 12 imágenes ordenables con descripciones y pies; avanza en bucle y ofrece pausa, controles manuales, teclado y gesto táctil.
- Las tarjetas de “Continúa leyendo” muestran la foto principal de cada artículo. Se quitó la línea superior y se redujo el espacio previo. La vista previa del gestor refleja la misma composición pública, con fotos seleccionadas.
- Verificación local: la suite completa pasó 95/95 en la ejecución previa y el caso editorial pasó 5/5 tras corregir su advertencia; lint y `git diff --check` pasaron sin avisos, TypeScript había pasado antes del ajuste de lint y CodeGraph está actualizado. El navegador autenticado mostró en “Nueva publicación” los campos de fotos y carrusel, el selector de tres diseños al final y la vista previa; no se guardaron datos. `/revista/una-plaza-que-guarda-nuestras-conversaciones` respondió HTTP 200; navegador local mostró la foto dentro del texto, el carrusel de 3 imágenes y las fotos de los tres artículos relacionados.
- Estado: cambios locales, sin migración ni modificación de datos remotos, commit, push o despliegue.
