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
