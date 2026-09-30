## Memoria permanente del proyecto

- Al iniciar trabajo en este repositorio, lee `PROJECT_MEMORY.md` para recuperar las decisiones vigentes, el mapa del código y el estado local/remoto.
- Contrasta los datos que puedan haber cambiado con el código y las herramientas actuales. La memoria conserva contexto; no sustituye la verificación.
- Actualiza `PROJECT_MEMORY.md` cuando cambien decisiones aceptadas, comportamientos, arquitectura, verificaciones relevantes o pendientes. Registra fecha, decisión, motivo breve y evidencia; evita transcripciones y razonamiento interno.
- Distingue siempre código local, migraciones aplicadas en Supabase y cambios publicados. Una acción pendiente de aprobación sigue pendiente hasta recibirla.
- Nunca guardes contraseñas, tokens, claves, cookies ni datos privados de miembros en la memoria.
- JEP fue descartado por el usuario. Las decisiones se apoyan en el contexto del proyecto, evidencia verificable y el razonamiento de Codex.

<!-- CODEGRAPH_START -->
## CodeGraph

Este proyecto tiene un índice local en `.codegraph/`. Antes de buscar o leer código para entenderlo o localizarlo, consulta CodeGraph:

- MCP: `codegraph_explore`, con `projectPath` apuntando a la raíz de este repositorio y una pregunta, símbolo o archivo concreto.
- CLI: `npm run codegraph:explore -- "símbolos o pregunta"`.
- Comprueba el índice con `npm run codegraph:status`. Si está desactualizado, ejecuta `npm run codegraph:sync` antes de continuar.
- Consulta archivos directamente cuando CodeGraph no cubra la información necesaria, por ejemplo documentación y configuración. El índice no reemplaza lint, TypeScript, pruebas ni verificación de la interfaz.
- La base de datos y el daemon son locales y no se versionan. En una copia nueva, con el CLI instalado, ejecuta `npm run codegraph:init`.
- Conserva el índice y la integración existentes; no actualices el CLI ni detengas procesos de otros proyectos como parte de tareas rutinarias.

Si una copia todavía no tiene `.codegraph/`, utiliza las herramientas habituales hasta que se inicialice; no consultes repetidamente un índice inexistente.
<!-- CODEGRAPH_END -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
