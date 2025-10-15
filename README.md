# Roo Code Index CLI

Herramienta en Node.js para reusar el índice semántico de Roo Code fuera de VS Code.

## Instalación

```bash
pnpm install
pnpm --filter codebase-index-cli build
```

## Uso rápido

1. Corre el instalador una sola vez desde la raíz del repo:

   ```bash
   ./scripts/install.sh
   ```

   Esto compila la CLI y crea wrappers en `~/.local/bin`:
   - `codebase` - Uses Qdrant vector store (remote server)
   - `codesql` - Uses SQLite-vec (local database)
   - `codebase-index` - Legacy compatibility

2. Copia `.env.example` a `.env` (en la raíz de este proyecto) y edítalo con tus credenciales. Ese archivo se usa como configuración global para todos los workspaces; no hace falta crear `.env` adicionales en cada repositorio.

3. Desde cualquier proyecto:

   ```bash
   # Using SQLite-vec (local database)
   codesql -start .

   # Using Qdrant (requires Qdrant server running)
   codebase -start .
   ```

   El monitor hace un escaneo completo del directorio y queda observando cambios hasta que presiones `Ctrl+C`.

## Vector Store Options

The vector store is determined by which command you use:

### SQLite-vec (via `codesql` command)
- **Local database** stored in `.codebase/vectors.db`
- **No external services** required
- **Portable** - can be committed with your project
- **Best for**: Small/medium projects, local development, offline usage
- **Usage**: `codesql -start .`

### Qdrant (via `codebase` command)
- **High performance** vector search
- **Scalable** to millions of vectors
- **Best for**: Large projects, production, multiple projects sharing an index
- **Requires**: Qdrant server running (e.g., `docker run -p 6333:6333 qdrant/qdrant`)
- **Usage**: `codebase -start .`

Comandos disponibles:

- `-start <ruta>`: arranca el monitor (crea la colección si no existe, actualiza si ya estaba).
- `-restart <ruta>`: limpia caché local y recrea la colección antes de volver a indexar.
- `-stats <ruta>`: muestra la colección actual y el número de archivos rastreados sin modificar nada.
- `-full-reset <ruta>`: **elimina completamente** todos los datos locales (`.codebase/`, `.roo-index-cli/`, `.roo-code/`). Útil cuando no sabes qué vector store estabas usando o quieres empezar desde cero.

## Configuración manual (opcional)

Puedes crear un archivo `codebase-index.config.json` en el directorio del proyecto si prefieres definir todo de forma explícita:

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
pnpm --filter codebase-index-cli exec node dist/index.js -start /ruta/al/workspace
```

## ¿Qué guarda la CLI?

Cada workspace mantiene su propio estado en `.codebase/`:

- `.codebase/state.json`: colección Qdrant asignada, fechas de creación/actualización.
- `.codebase/cache.json`: hashes de archivos para detectar cambios. Se regenera automáticamente tras `-restart`.

Los archivos legacy (`.roo-index-cli/state.json` y `.roo-code/index-cache.json`) se migran en la primera ejecución.
