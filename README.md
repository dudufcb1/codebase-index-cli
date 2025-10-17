# Codebase Index CLI

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)

Node.js tool for semantic code indexing and search using vector embeddings. Includes automatic git commit tracking with LLM analysis for semantic commit history search.

## Features

- **Semantic Code Search** - Vector-based search across your entire codebase
- **Dual Storage Options** - SQLite-vec (local) or Qdrant (scalable)
- **Real-time File Watching** - Automatically re-indexes on file changes
- **Git Commit Tracking** - Monitors commits and indexes them with LLM analysis
- **Tree-sitter Parsing** - Semantic code parsing for 29+ languages
- **Flexible Configuration** - Per-vector-store embedder configuration

## Installation

### Linux (Tested)

```bash
git clone https://github.com/dudufcb1/codebase-index-cli.git
cd codebase-index-cli
./scripts/install.sh
```

### macOS / Windows (Untested)

Installation scripts are provided but **have not been tested**:
- **macOS**: `./scripts/install-macos.sh`
- **Windows**: `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`

**If you test these scripts and they work (or you fix them), please submit a PR!** See [INSTALL.md](./INSTALL.md) for detailed platform-specific instructions and manual installation alternatives.

---

## Quick Start

1. **Run the installer** (see Installation above)

   The installer compiles the CLI and creates wrappers:
   - `codebase` - Uses Qdrant vector store (remote server)
   - `codesql` - Uses SQLite-vec (local database)
   - `codebase-index` - Legacy compatibility

2. **Configure environment**: Copy `.env.example` to `.env` (in the project root) and edit it with your credentials. This file serves as global configuration for all workspaces; no need to create additional `.env` files in each repository.

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

## 🆕 Vector-Store-Specific Embedders

**NEW**: You can now use **different embedders for SQLite vs Qdrant**!

This allows you to optimize your embedding strategy:
- Use a **smaller/cheaper model** for local SQLite development
- Use a **larger/more accurate model** for production Qdrant
- Use **local Ollama** for SQLite (offline) and **cloud API** for Qdrant (online)

### Quick Example

```bash
# Global fallback (used by both if no specific config)
EMBED_PROVIDER=openai-compatible
EMBED_BASE_URL=https://api.studio.nebius.com/v1/
EMBED_API_KEY=your-key
EMBED_MODEL=Qwen/Qwen3-Embedding-8B

# SQLite-specific (overrides global for SQLite)
SQLITE_EMBED_MODEL=text-embedding-3-small
SQLITE_EMBED_DIMENSION=1536

# Qdrant-specific (overrides global for Qdrant)
QDRANT_EMBED_MODEL=Qwen/Qwen3-Embedding-8B
QDRANT_EMBED_DIMENSION=4096
```

📖 **See [EMBEDDER_CONFIG.md](./EMBEDDER_CONFIG.md) for detailed examples and use cases.**

## Available Commands

- `-start <path>`: Start the monitor (creates collection if it doesn't exist, updates if it does).
- `-restart <path>`: Clear local cache and recreate collection before re-indexing.
- `-stats <path>`: Show current collection and number of tracked files without modifying anything.
- `-full-reset <path>`: **Completely removes** all local data (`.codebase/`, `.roo-index-cli/`, `.roo-code/`). Useful when you don't know which vector store you were using or want to start from scratch.

## Git Commit Tracking (Experimental)

Enable automatic git commit monitoring and LLM-powered analysis to make your commit history semantically searchable.

> **⚠️ Important:** Git commit tracking is **only supported with Qdrant**. It will not work with SQLite-vec due to schema limitations. Use the `codebase` command (not `codesql`) to enable this feature.

### How It Works

When enabled, the CLI watches the `.git` directory and:

1. **Detects commits** - Monitors new commits, pulls, merges, and branch changes
2. **Extracts metadata** - Author, date, message, diff, changed files, and stats
3. **LLM Analysis** - Sends commit context to an LLM for semantic understanding
4. **Vector Indexing** - Stores the analysis in the same collection as your code
5. **Semantic Search** - Query your commit history using natural language

### Configuration

Add these variables to your `.env` file:

```bash
# Enable git tracking
TRACK_GIT=true

# Configure LLM for commit analysis (required for indexing)
TRACK_GIT_LLM_PROVIDER=openai-compatible
TRACK_GIT_LLM_ENDPOINT=http://localhost:4141/v1
TRACK_GIT_LLM_MODEL=gpt-4.1
TRACK_GIT_LLM_API_KEY=sk-your-key-here
```

### Searching Commits

Use the provided client example to search your commit history:

```bash
# Get all commits (max 5)
node client_examples/search-commits.js codebase-908e5cbf73d44edcbc

# Semantic search
node client_examples/search-commits.js codebase-908e5cbf73d44edcbc "cleanup and refactoring"
node client_examples/search-commits.js codebase-908e5cbf73d44edcbc "authentication improvements"
```

The search returns:
- Commit hash, branch, author, and date
- Commit message
- Files changed with statistics
- LLM-generated semantic analysis

### What Gets Indexed

Each commit includes:
- **Metadata**: Hash, author, email, date, branch
- **Changes**: Files added/modified/deleted/renamed
- **Statistics**: Insertions, deletions, files changed
- **Diff**: Full unified diff (for LLM context)
- **Analysis**: LLM-generated semantic summary

### Use Cases

- "Find commits related to authentication"
- "Show refactoring work in the last month"
- "Commits that fixed database issues"
- "Changes affecting the user service"
- "Security-related updates"

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

- `.codebase/state.json`: Assigned Qdrant collection, creation/update dates, indexing status.
- `.codebase/cache.json`: File hashes to detect changes. Automatically regenerated after `-restart`.
- `.codebase/vectors.db`: SQLite database (when using `codesql` command).

Legacy files (`.roo-index-cli/state.json` and `.roo-code/index-cache.json`) are migrated on first run.

## Client Examples

The `client_examples/` directory contains standalone scripts for querying your indexed codebase and commit history:

### Code Search (SQLite-vec)

Interactive search scripts that connect directly to your local `.codebase/vectors.db`:

```bash
# JavaScript (Node.js)
cd client_examples
npm install better-sqlite3 sqlite-vec dotenv
node search-demo.js

# Python
pip install sqlite-vec requests python-dotenv
python search-demo.py
```

### Commit History Search (Qdrant)

Search git commits analyzed by LLM (requires `TRACK_GIT=true`):

```bash
# No dependencies needed - uses native fetch
node client_examples/search-commits.js <collection-name> [query]

# Examples:
node client_examples/search-commits.js codebase-908e5cbf73d44edcbc
node client_examples/search-commits.js codebase-908e5cbf73d44edcbc "cleanup and refactoring"
```

See [client_examples/README.md](./client_examples/README.md) for detailed documentation.

## Architecture

The CLI is built with a modular architecture:

- **Indexer Core** (`src/indexer.ts`) - Main orchestrator
- **File Watching** (`src/indexing/workspaceWatcher.ts`) - Real-time change detection
- **Git Integration** (`src/indexing/gitCommitWatcher.ts`) - Commit monitoring
- **LLM Service** (`src/indexing/commitLlmService.ts`) - Commit analysis
- **Vector Stores** (`src/vectorStore/`) - Qdrant and SQLite-vec implementations
- **Embedders** (`src/embedder/`) - OpenAI, OpenAI-compatible, and Ollama support
- **Tree-sitter** (`src/services/tree-sitter/`) - Semantic code parsing for 29+ languages

## Supported Languages (Tree-sitter)

When `USE_TREE_SITTER=true`, the CLI parses code semantically for these languages:

C, C++, C#, CSS, Elisp, Elixir, Go, HTML, Java, JavaScript, Kotlin, Lua, OCaml, PHP, Python, Ruby, Rust, Scala, Solidity, Swift, SystemRDL, TLA+, TOML, TypeScript, TSX, Vue, Zig, and more.

## License

MIT

