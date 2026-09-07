# Club Rotario Santo Domingo Colonial

Primera base de la plataforma pública y privada del Club Rotario Santo Domingo Colonial.

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

Comprobaciones disponibles:

```bash
npm run lint
npm run build
```
