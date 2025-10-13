# Roo Code Index CLI

Herramienta en Node.js para reusar el índice semántico de Roo Code fuera de VS Code.

## Instalación

```bash
pnpm install
pnpm --filter @roo-code/code-index-cli build
```

## Configuración

Crear un archivo `roo-index.config.json` en el directorio del proyecto:

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
    "enabled": true,
    "debounceMs": 500
  }
}
```

Variables importantes:

- `workspacePath`: ruta absoluta del repositorio a indexar.
- `embedder`: proveedor soportado (`openai`, `openai-compatible`, `ollama`), modelo y credenciales.
- `qdrant`: instancia Qdrant existente donde se almacenarán los vectores.

## Uso

```bash
pnpm --filter @roo-code/code-index-cli start -- --config ./roo-index.config.json
```

Opciones:

- `--once`: realiza un escaneo completo y termina el proceso.
- `--print-config`: muestra la configuración normalizada sin ejecutar.

La CLI ejecuta un escaneo inicial completo y monta un watcher basado en `chokidar` para reindexar archivos modificados o eliminados.
