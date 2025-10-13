# Roo Code Index CLI

Herramienta en Node.js para reusar el índice semántico de Roo Code fuera de VS Code.

## Instalación

```bash
pnpm install
pnpm --filter roo-index-cli build
```

## Uso rápido

1. Corre el instalador una sola vez desde la raíz del repo:

   ```bash
   ./scripts/install.sh
   ```

   Esto compila la CLI y crea un wrapper `codebase` en `~/.local/bin` (u otra ruta si defines `ROO_INDEX_BIN_DIR`). También deja `roo-index` por compatibilidad.

2. Copia `.env.example` a `.env` (en la raíz de este proyecto) y edítalo con tus credenciales. Ese archivo se usa como configuración global para todos los workspaces; no hace falta crear `.env` adicionales en cada repositorio.

3. Desde cualquier proyecto:

   ```bash
   codebase -start .
   ```

   (El comando `roo-index -start .` sigue funcionando para compatibilidad, pero el nombre recomendado es `codebase`).

   El monitor hace un escaneo completo del directorio y queda observando cambios hasta que presiones `Ctrl+C`.

Comandos disponibles:

- `-start <ruta>`: arranca el monitor (crea la colección si no existe, actualiza si ya estaba).
- `-restart <ruta>`: limpia caché local y recrea la colección antes de volver a indexar.
- `-stats <ruta>`: muestra la colección actual y el número de archivos rastreados sin modificar nada.

## Configuración manual (opcional)

Puedes crear un archivo `roo-index.config.json` en el directorio del proyecto si prefieres definir todo de forma explícita:

```json
{
  "workspacePath": "/ruta/al/workspace",
  "embedder": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "sk-..."
  },
  "qdrant": {
    "url": "http://localhost:6333",
    "apiKey": null
  },
  "watch": {
    "debounceMs": 500
  }
}
```

Variables importantes:

- `workspacePath`: ruta absoluta del repositorio a indexar.
- `embedder`: proveedor soportado (`openai`, `openai-compatible`, `ollama`) y credenciales.
- `qdrant`: instancia Qdrant donde se almacenarán los vectores.

## Uso directo sin wrapper

Si no deseas instalar el wrapper, puedes ejecutar directamente:

```bash
pnpm --filter roo-index-cli exec node dist/index.js -start /ruta/al/workspace
```

## ¿Qué guarda la CLI?

Cada workspace mantiene su propio estado en `.codebase/`:

- `.codebase/state.json`: colección Qdrant asignada, fechas de creación/actualización.
- `.codebase/cache.json`: hashes de archivos para detectar cambios. Se regenera automáticamente tras `-restart`.

Los archivos legacy (`.roo-index-cli/state.json` y `.roo-code/index-cache.json`) se migran en la primera ejecución.
