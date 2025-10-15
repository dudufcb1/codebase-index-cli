# Codebase Index CLI

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)

Node.js tool for semantic code indexing and search using vector embeddings.

## Installation

```bash
pnpm install
pnpm --filter codebase-index-cli build
```

## Quick Start

1. Run the installer once from the repository root:

   ```bash
   ./scripts/install.sh
   ```

   This compiles the CLI and creates wrappers in `~/.local/bin`:
   - `codebase` - Uses Qdrant vector store (remote server)
   - `codesql` - Uses SQLite-vec (local database)
   - `codebase-index` - Legacy compatibility

2. Copy `.env.example` to `.env` (in the project root) and edit it with your credentials. This file serves as global configuration for all workspaces; no need to create additional `.env` files in each repository.

3. From any project directory:

   ```bash
   # Using SQLite-vec (local database)
   codesql -start .

   # Using Qdrant (requires Qdrant server running)
   codebase -start .
   ```

   The monitor performs a complete directory scan and watches for changes until you press `Ctrl+C`.

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

## Available Commands

- `-start <path>`: Start the monitor (creates collection if it doesn't exist, updates if it does).
- `-restart <path>`: Clear local cache and recreate collection before re-indexing.
- `-stats <path>`: Show current collection and number of tracked files without modifying anything.
- `-full-reset <path>`: **Completely removes** all local data (`.codebase/`, `.roo-index-cli/`, `.roo-code/`). Useful when you don't know which vector store you were using or want to start from scratch.

## Manual Configuration (Optional)

You can create a `codebase-index.config.json` file in the project directory if you prefer to define everything explicitly:

```json
{
  "workspacePath": "/path/to/workspace",
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

Important variables:

- `workspacePath`: Absolute path to the repository to index.
- `embedder`: Supported provider (`openai`, `openai-compatible`, `ollama`) and credentials.
- `qdrant`: Qdrant instance where vectors will be stored.

## Direct Usage Without Wrapper

If you don't want to install the wrapper, you can run directly:

```bash
pnpm --filter codebase-index-cli exec node dist/index.js -start /path/to/workspace
```

## What Does the CLI Store?

Each workspace maintains its own state in `.codebase/`:

- `.codebase/state.json`: Assigned Qdrant collection, creation/update dates.
- `.codebase/cache.json`: File hashes to detect changes. Automatically regenerated after `-restart`.

Legacy files (`.roo-index-cli/state.json` and `.roo-code/index-cache.json`) are migrated on first run.

