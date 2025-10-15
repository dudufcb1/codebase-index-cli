# Installation Guide - Roo Code Index CLI

## 📋 Prerequisites

### Required Software

- **Node.js** >= 18.0.0
- **pnpm** (package manager)
  ```bash
  npm install -g pnpm
  ```

### Vector Store Options

You can choose between two options for storing vectors:

#### Option 1: SQLite-vec (Recommended for local development)
✅ **Advantages:**
- No external services required
- Local database in `.codebase/vectors.db`
- Portable (you can commit the index with your project)
- Automatic installation with `pnpm install`

❌ **Limitations:**
- Best for small/medium projects (<100k chunks)
- Moderate performance compared to Qdrant

#### Option 2: Qdrant (Recommended for production)
✅ **Advantages:**
- High performance
- Scalable to millions of vectors
- Ideal for multiple projects sharing an index

❌ **Limitations:**
- Requires Qdrant server running
- Additional configuration

**Qdrant Installation:**
```bash
# With Docker (recommended)
docker run -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage:z \
  qdrant/qdrant

# Or with Docker Compose
docker-compose up -d qdrant
```

## 🚀 Installation

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone <repo-url>
cd code-index-cli

# Install dependencies
pnpm install

# Build the project
pnpm build
```

### 2. Install Global Wrapper (Optional but Recommended)

```bash
# Run the installer
./scripts/install.sh
```

This will:
- Compile the CLI
- Create `codebase` and `codesql` wrappers in `~/.local/bin`
- Add `~/.local/bin` to your PATH if not already there

**Optional environment variables:**
```bash
# Change installation directory
export CODEBASE_INDEX_BIN_DIR="$HOME/bin"
./scripts/install.sh
```

### 3. Configure Credentials

Copy the example file and edit it:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Embedding provider (openai, openai-compatible, ollama)
EMBED_PROVIDER=openai-compatible

# For OpenAI
EMBED_API_KEY=sk-...
EMBED_MODEL=text-embedding-3-small

# For compatible APIs (e.g., Nebius)
EMBED_BASE_URL=https://api.studio.nebius.com/v1/
EMBED_API_KEY=your-api-key
EMBED_MODEL=Qwen/Qwen3-Embedding-8B

# For Ollama (local)
EMBED_BASE_URL=http://localhost:11434
EMBED_MODEL=nomic-embed-text

# Qdrant (only if using Qdrant)
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=  # Optional
```

## 📦 Installed Dependencies

When running `pnpm install`, the following are installed:

### Production Dependencies
- `@qdrant/js-client-rest` (^1.12.0) - Qdrant client
- `sqlite-vec` (0.1.7-alpha.2) - SQLite extension for vectors
- `openai` (^4.70.0) - Embeddings client
- `chokidar` (^3.6.0) - File watcher
- `dotenv` (^16.6.1) - Environment variables
- `ignore` (^5.3.2) - .gitignore parser
- `p-limit` (^4.0.0) - Concurrency control
- `uuid` (^9.0.1) - UUID generator
- `zod` (^3.23.8) - Schema validation
- `async-mutex` (^0.5.0) - Async synchronization

### Development Dependencies
- `typescript` (^5.4.5)
- `tsx` (^4.19.3)
- `@types/node` (^20.16.11)

## ✅ Verify Installation

```bash
# Check that commands are available
which codebase
which codesql

# Check version
codebase --version

# Test with a project
codebase -start .
```

## 🔧 Troubleshooting

### Error: "Cannot find module 'sqlite-vec'"

```bash
# Clean and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm build
```

### Error: "Qdrant connection refused"

If using `codebase` (Qdrant):
```bash
# Check that Qdrant is running
curl http://localhost:6333/health

# If not running, start it
docker run -p 6333:6333 qdrant/qdrant
```

If using `codesql` (SQLite-vec):
- You don't need Qdrant, ignore this error

### Error: "Permission denied" when running install.sh

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

### Commands not found after installation

Add `~/.local/bin` to your PATH:

```bash
# Bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## 🎯 Next Steps

Once installed, check the [README.md](./README.md) for:
- Basic usage of `codebase` and `codesql`
- Advanced configuration
- Available commands
- Usage examples

## 📚 Additional Resources

- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [sqlite-vec on GitHub](https://github.com/asg017/sqlite-vec)
- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)

