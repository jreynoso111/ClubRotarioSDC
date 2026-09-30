# Memoria del Club Rotario Santo Domingo Colonial

Última actualización: 2026-09-30. Documento permanente del repositorio para retomar el trabajo y conservar decisiones aceptadas. Verificar los estados que puedan haber cambiado antes de actuar.

## Contexto y decisiones vigentes

- Web pública en español con estilo de revista social, ilustraciones de la Ciudad Colonial, historias y llamados a integrarse al club. El Alcázar de Colón es el monumento emblema.
- Mantener el intro azul original con la identidad Rotary (`CinematicIntro` en `app/page.tsx`). El usuario descartó el intro de video y el recorrido 3D del Alcázar; no retomarlos sin una nueva instrucción.
- Texto del header, a la derecha del logo: **Crear un impacto duradero**.
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
- Los cambios recientes de esta sesión son locales; no se ha publicado este conjunto de cambios. No inferir el estado de producción a partir del servidor local ni de una compilación.
- No ejecutar `next build` sobre el mismo directorio de salida mientras el servidor de desarrollo esté activo: verificar primero para evitar interferencia con sus artefactos.

## Permisos y comportamiento de eventos

- La identidad se comprueba con `supabase.auth.getUser()` y los permisos con `public.memberships`: rol y estado de la membresía. No autorizar desde `user_metadata` editable.
- Roles de aplicación: `member`, `coordinator`, `editor`, `club_manager`, `admin`; una membresía suspendida o pendiente no conserva las capacidades de una activa.
- Administradores y gestión del club pueden crear, editar y eliminar eventos y consultar la lista de asistentes según las capacidades del servidor. Cada miembro activo puede confirmar o cancelar su propia asistencia; una confirmación por miembro y evento.
- El resumen muestra próximos eventos publicados. La agenda de gestión incluye próximos eventos e historial, con consultas limitadas a 30 de cada grupo.
- La migración `supabase/migrations/20260930042056_published_member_events_access.sql` **se aplicó en Supabase**: miembros activos pueden ver eventos internos publicados, manteniendo RLS y controles de gestión.
- Las pruebas de la sesión anterior verificaron gestión de eventos, confirmación/cancelación y listado de asistentes. Se eliminaron los registros temporales de prueba y se conservaron los tres eventos originales.

## Auditoría activada en Supabase

- Implementada localmente una pestaña **Auditoría**, visible solo para administradores activos. Consultas paginadas de 50 registros, filtros, búsqueda y detalle de campos antes/después; se consulta al abrir la pestaña para evitar cargarla durante el inicio de sesión.
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
- Estos cambios de interfaz siguen siendo locales; no requirieron cambios en el esquema ni en los permisos remotos de Supabase.

## Mapa útil del código

| Área | Archivos principales |
| --- | --- |
| Portada e intro azul | `app/page.tsx`, `app/globals.css` |
| Header, footer y marca | `components/public/PublicChrome.tsx`, `components/public/public.module.css` |
| Contenido público | `lib/editorial.ts`, `lib/supabase/public-feed.ts`, `lib/supabase/timeout.ts` |
| Agenda y revista públicas | `app/eventos/`, `app/revista/`, `app/nosotros/` |
| Sesión y cliente Supabase | `app/auth/`, `utils/supabase/`, `proxy.ts` |
| Datos y capacidades de gestión | `lib/platform.ts`, `app/plataforma/page.tsx` |
| Interfaz y acciones de gestión | `app/plataforma/PlatformWorkspace.tsx`, `app/plataforma/actions.ts` |
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
| 2026-09-30 | Conservar intro azul e ilustraciones del hero | Última preferencia expresa del usuario; `CinematicIntro` y los textos actuales verificados en código. |
| 2026-09-30 | Gestión de eventos con confirmación personal de asistencia | Petición del usuario; acciones protegidas, listado de asistentes y flujo verificados durante la sesión. |
| 2026-09-30 | Auditoría detallada solo para administradores activos | El usuario autorizó la activación; migración aplicada y pruebas de permisos/captura completadas en Supabase y la web local. |
| 2026-09-30 | Auditoría compacta y fechas DD/MM/AA con hora de 24 horas | Corrección expresa día/mes/año; controles de columnas, ordenación y filtros verificados en la web autenticada. |
| 2026-09-30 | Mantener CodeGraph y memoria en el repositorio | Petición expresa del usuario; MCP e índice existentes verificados, comandos e instrucciones permanentes añadidos. |
| 2026-09-30 | Descartar JEP | El usuario retiró expresamente esa integración; no añadir dependencias ni llamadas a ese servicio. |
