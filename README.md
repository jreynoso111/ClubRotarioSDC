# Club Rotario Santo Domingo Colonial

Primera base de la plataforma pública y privada del Club Rotario Santo Domingo Colonial.

El contexto vigente, las decisiones y el estado de las migraciones se conservan en [PROJECT_MEMORY.md](PROJECT_MEMORY.md). Consulta también [AGENTS.md](AGENTS.md) para las instrucciones de trabajo con Codex y CodeGraph.

## Primera iteración

La homepage inicial presenta la identidad visual del proyecto y deja preparados los puntos de entrada para:

- agenda pública de próximos eventos;
- blog y memoria de actividades realizadas;
- acceso a la plataforma privada de miembros;
- propuestas, organización interna y actividades virtuales.

El contenido de eventos de la homepage es demostrativo hasta que el club entregue fechas, lugares, imágenes y textos definitivos.

## Dirección del producto

La aplicación se construirá como un monolito modular con rutas públicas, área privada para miembros y gestión interna. Los cargos del club serán datos organizativos; los permisos de la aplicación se manejarán por capacidades separadas.

Roles previstos: visitante, solicitante, miembro, coordinador, editor, gestor del club y administrador.

La zona horaria de operación será `America/Santo_Domingo` y la interfaz inicial estará en español.

## Desarrollo local

```bash
npm install
npm run dev
```

La aplicación se abre por defecto en `http://localhost:3000`.

Para utilizar la dirección local de esta sesión:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Abre `http://127.0.0.1:3001/`. Comprueba que no exista ya un servidor del proyecto en ese puerto antes de iniciar otro.

Comprobaciones disponibles:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Ejecuta la compilación con el servidor de desarrollo detenido para no interferir con sus artefactos.

## CodeGraph

El CLI CodeGraph ya está instalado en este equipo y conectado a Codex como servidor MCP. El índice en `.codegraph/` se actualiza automáticamente y queda fuera de Git.

```bash
npm run codegraph:status
npm run codegraph:sync
npm run codegraph:explore -- "getPlatformSnapshot requireActor"
```

En una copia nueva del repositorio, con CodeGraph instalado, inicializa el índice con `npm run codegraph:init`. La memoria y las instrucciones permanecen en los archivos del repositorio; el índice se reconstruye localmente.

## Operación del backend local de producción

En este host, usar `node scripts/manage-local-stack.mjs start`, `stop` o `status` para operar únicamente `club-rotario`. El lanzador carga las variables de firma desde el almacenamiento protegido del servidor; no imprime las credenciales que el CLI devuelve en sus respuestas. La tarea `ClubRotarioSDC-Backend` utiliza el mismo entorno protegido al recuperar el servicio.

La configuración versionada contiene referencias a variables y al archivo de firma, nunca las claves. Los archivos reales están en `C:/ProgramData/ClubRotarioSDC/secrets`, con acceso limitado al operador, SYSTEM y Administradores. La identidad `ClubRotarioWebSvc` no necesita acceso a esa carpeta. La base sigue en su volumen persistente; no ejecutar reset para aplicar cambios de configuración. Un equipo nuevo necesita provisionar sus propias claves y rutas antes de publicar el backend.

## Diagnóstico de errores

Los administradores activos encuentran **Diagnóstico** en la barra de administración de `/plataforma`. Permite comprobar Auth y la lectura de membresía, filtrar por módulo/origen/referencia, revisar el detalle y exportar la selección a JSON. **Probar registro** guarda una incidencia claramente marcada como prueba, sin provocar un error real. Cada consulta comprueba `auth.getUser()` y la membresía vigente en servidor; las respuestas privadas no se almacenan en caché.

Se capturan los fallos de inicio de sesión, recuperación, cambio de contraseña, registro y confirmación; errores/rechazos no controlados del navegador; fallos HTTP/red del cliente Supabase del servidor; y errores no controlados de rutas, render y acciones mediante `instrumentation.ts`. Los errores de los formularios incluyen la referencia asignada por el servidor si el reporte pudo guardarse. Un reporte del navegador no confirma la causa del servidor y se identifica como tal.

`CLUB_DIAGNOSTICS_DIR` configura el directorio privado y persistente del registro; el fallback de desarrollo es `.diagnostics/`, ignorado por Git. En este host se usa `C:/ProgramData/ClubRotarioSDC/diagnostics`, con escritura limitada a la identidad de Next, el operador, SYSTEM y Administradores. No almacenar en `public/`, versionar o servir estos archivos. No requiere migraciones ni privilegios administrativos de Supabase. El registro usa un archivo activo y uno rotado, de aproximadamente 512 KiB cada uno, y devuelve como máximo 1.000 eventos de los últimos siete días. La limpieza por antigüedad se ejecuta como máximo una vez por hora durante nuevas escrituras; sin actividad, los archivos quedan privados y los eventos vencidos se excluyen de lectura. La rotación puede reducir la ventana disponible si hay mucho volumen.

Solo se admiten campos y códigos enumerados: no se guardan mensajes arbitrarios, correos, UUID de miembros, IP, cookies, cabeceras, cuerpos, consultas, fragmentos de enlaces ni contraseñas. De la pila del servidor se conservan únicamente coordenadas numéricas y el digest de Next para relacionarlo con la versión compilada. La entrada anónima exige origen público, JSON de hasta 2 KiB y límites por origen de red/global; no puede consultar registros, atribuirse origen servidor ni generar pruebas administrativas. Esos límites residen en memoria y se reinician con Next.

El diagnóstico empieza al publicarse y no reconstruye errores anteriores. No sustituye la auditoría de cambios ni mide Docker, DNS, SMTP o el trayecto de otro dispositivo. Los fallos que impidan enviar el reporte, los errores anteriores a ejecutar JavaScript y los cambios de cliente que omitan la captura pueden no registrarse. Para investigar un incidente: reproducirlo, anotar la referencia del formulario, abrir Diagnóstico y buscar esa referencia; contrastar ruta, hora, HTTP/código y siguiente comprobación. Si aparece «Referencia no disponible», comprobar conectividad y escritura del directorio privado.

## Recuperación y acceso de cuentas

La recuperación comprueba en el servidor si el correo está registrado y muestra el aviso correspondiente. Es una decisión expresa del producto: esta interfaz revela existencia de cuentas. La ruta exige el origen del sitio, JSON acotado y limita consultas; la RPC que devuelve exclusivamente el booleano permanece bloqueada en el hostname público del API y se consulta por loopback. Aplicar `20261016223645_auth_recovery_email_lookup.sql` en cada backend antes de publicar esta interfaz; no trasladar secretos de servicio a Next.

Tras guardar una contraseña nueva, la aplicación revoca las sesiones de la cuenta, expira las cookies de Auth y vuelve al inicio de sesión. Las altas nuevas quedan `member/pending`, necesitan confirmar el correo y ser aprobadas desde **Miembros y comités** por administración o gestión del club. Confirmar el correo no aprueba la membresía; el login consulta el estado vigente en la base antes de permitir gestión.

## Controles de seguridad en CI

`.github/workflows/security.yml` ejecuta en cada PR y en `main`:

- `application`: `npm ci`, pruebas, lint, build, auditoría de producción (sin excepciones) y `node scripts/audit-gate.mjs` para el árbol completo con umbral alto. Un aviso alto sin parche solo se admite con una entrada fechada en `security/audit-exceptions.json` (URL del aviso, motivo, vencimiento); al vencer, el CI vuelve a fallar.
- `database`: `bash scripts/run-db-tests.sh` aplica todas las migraciones a un Postgres 16 desechable con un stub mínimo de Supabase (`supabase/tests/support/`) y ejecuta `supabase/tests/*.sql`. No apuntar nunca a la base real: el script borra y recrea la base indicada en `PGDATABASE`.
- `secrets`: gitleaks sobre todo el historial.
