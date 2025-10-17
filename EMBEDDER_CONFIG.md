# Vector-Store-Specific Embedder Configuration

## Overview

Starting from this version, you can configure **different embedders for SQLite and Qdrant** vector stores. This allows you to optimize your embedding strategy based on the characteristics of each vector store.

## Use Cases

### 1. **Cost Optimization**
Use a cheaper/smaller model for local SQLite development and a more powerful model for production Qdrant:

```bash
# Local development with SQLite - fast and cheap
SQLITE_EMBED_PROVIDER=openai
SQLITE_EMBED_MODEL=text-embedding-3-small
SQLITE_EMBED_DIMENSION=1536

# Production with Qdrant - high quality
QDRANT_EMBED_PROVIDER=openai
QDRANT_EMBED_MODEL=text-embedding-3-large
QDRANT_EMBED_DIMENSION=3072
```

### 2. **Offline vs Online**
Use local Ollama for SQLite (offline work) and cloud API for Qdrant (online work):

```bash
# SQLite with local Ollama - no internet required
SQLITE_EMBED_PROVIDER=ollama
SQLITE_OLLAMA_MODEL=nomic-embed-text
SQLITE_OLLAMA_BASE_URL=http://localhost:11434
SQLITE_OLLAMA_EMBED_DIMENSION=768

# Qdrant with cloud API - better quality
QDRANT_EMBED_PROVIDER=openai-compatible
QDRANT_EMBED_MODEL=Qwen/Qwen3-Embedding-8B
QDRANT_EMBED_BASE_URL=https://api.studio.nebius.com/v1/
QDRANT_EMBED_API_KEY=your-key
QDRANT_EMBED_DIMENSION=4096
```

### 3. **Different Providers**
Mix and match different embedding providers:

```bash
# SQLite with OpenAI
SQLITE_EMBED_PROVIDER=openai
SQLITE_OPENAI_API_KEY=sk-...
SQLITE_EMBED_MODEL=text-embedding-3-small

# Qdrant with Nebius
QDRANT_EMBED_PROVIDER=openai-compatible
QDRANT_EMBED_BASE_URL=https://api.studio.nebius.com/v1/
QDRANT_EMBED_API_KEY=nebius-key
QDRANT_EMBED_MODEL=Qwen/Qwen3-Embedding-8B
```

## Configuration Variables

### Prefix System

Variables follow this pattern:
- `SQLITE_*` - Used only when vector store is SQLite
- `QDRANT_*` - Used only when vector store is Qdrant  
- No prefix - Global fallback for both stores

### Fallback Logic

1. **Vector-store-specific variables take priority**
   - If `SQLITE_EMBED_MODEL` is set and you're using SQLite → uses that
   - If `QDRANT_EMBED_MODEL` is set and you're using Qdrant → uses that

2. **Falls back to global variables**
   - If vector-store-specific variable is not set → uses `EMBED_MODEL`
   - This maintains backward compatibility with existing configurations

### Available Variables

For each provider, you can set these variables with `SQLITE_` or `QDRANT_` prefix:

#### OpenAI Provider
```bash
SQLITE_EMBED_PROVIDER=openai
SQLITE_OPENAI_API_KEY=sk-...
SQLITE_OPENAI_EMBED_MODEL=text-embedding-3-small
SQLITE_OPENAI_BASE_URL=https://api.openai.com/v1/  # optional
SQLITE_OPENAI_EMBED_DIMENSION=1536  # optional
SQLITE_OPENAI_MAX_BATCH=60  # optional - max number of texts per request
SQLITE_OPENAI_MAX_TOKENS=8192  # optional - max tokens per request (IMPORTANT!)
```

#### OpenAI-Compatible Provider
```bash
QDRANT_EMBED_PROVIDER=openai-compatible
QDRANT_EMBED_BASE_URL=https://api.studio.nebius.com/v1/
QDRANT_EMBED_API_KEY=your-key
QDRANT_EMBED_MODEL=Qwen/Qwen3-Embedding-8B
QDRANT_EMBED_DIMENSION=4096  # optional
QDRANT_EMBED_MAX_BATCH=64  # optional - max number of texts per request
QDRANT_EMBED_MAX_TOKENS=8192  # optional - max tokens per request (CHECK YOUR PROVIDER!)
```

#### Ollama Provider
```bash
SQLITE_EMBED_PROVIDER=ollama
SQLITE_OLLAMA_MODEL=nomic-embed-text
SQLITE_OLLAMA_BASE_URL=http://localhost:11434  # optional
SQLITE_OLLAMA_EMBED_DIMENSION=768  # required
SQLITE_EMBED_MAX_TOKENS=8192  # optional - max tokens per request
```

## Examples

### Example 1: Simple Fallback (Backward Compatible)

If you don't set any vector-store-specific variables, it works exactly as before:

```bash
# This configuration works for BOTH SQLite and Qdrant
EMBED_PROVIDER=openai-compatible
EMBED_BASE_URL=https://api.studio.nebius.com/v1/
EMBED_API_KEY=your-key
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
```

### Example 2: Different Models, Same Provider

Use the same provider but different models:

```bash
# Global provider
EMBED_PROVIDER=openai-compatible
EMBED_BASE_URL=https://api.studio.nebius.com/v1/
EMBED_API_KEY=your-key

# SQLite uses smaller model
SQLITE_EMBED_MODEL=text-embedding-3-small
SQLITE_EMBED_DIMENSION=1536

# Qdrant uses larger model
QDRANT_EMBED_MODEL=Qwen/Qwen3-Embedding-8B
QDRANT_EMBED_DIMENSION=4096
```

### Example 3: Completely Different Providers

Use different providers for each store:

```bash
# SQLite with Ollama (local)
SQLITE_EMBED_PROVIDER=ollama
SQLITE_OLLAMA_MODEL=nomic-embed-text
SQLITE_OLLAMA_EMBED_DIMENSION=768

# Qdrant with OpenAI (cloud)
QDRANT_EMBED_PROVIDER=openai
QDRANT_OPENAI_API_KEY=sk-...
QDRANT_EMBED_MODEL=text-embedding-3-large
QDRANT_OPENAI_EMBED_DIMENSION=3072
```

## How It Works

1. **Vector store type is determined first**
   - By `VECTOR_STORE` environment variable
   - Or by command used (`codebase` → Qdrant, `codesql` → SQLite)

2. **Embedder configuration is resolved**
   - Checks for vector-store-specific variables (e.g., `SQLITE_EMBED_MODEL`)
   - Falls back to global variables (e.g., `EMBED_MODEL`)
   - Throws error if required variables are missing

3. **Embedder is created with resolved configuration**
   - Uses the appropriate provider (OpenAI, OpenAI-compatible, or Ollama)
   - Connects to the specified API endpoint
   - Uses the configured model and dimensions

## Migration Guide

### From Single Embedder to Vector-Store-Specific

**Before:**
```bash
EMBED_PROVIDER=openai-compatible
EMBED_BASE_URL=https://api.studio.nebius.com/v1/
EMBED_API_KEY=your-key
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
```

**After (if you want different embedders):**
```bash
# Keep global as fallback
EMBED_PROVIDER=openai-compatible
EMBED_BASE_URL=https://api.studio.nebius.com/v1/
EMBED_API_KEY=your-key
EMBED_MODEL=Qwen/Qwen3-Embedding-8B

# Add SQLite-specific (optional)
SQLITE_EMBED_MODEL=text-embedding-3-small
SQLITE_EMBED_DIMENSION=1536

# Add Qdrant-specific (optional)
QDRANT_EMBED_MODEL=Qwen/Qwen3-Embedding-8B
QDRANT_EMBED_DIMENSION=4096
```

**Note:** Your existing configuration continues to work without any changes!

## Troubleshooting

### Error: "SQLITE_EMBED_MODEL is required"

You set `SQLITE_EMBED_PROVIDER` but didn't set the model. Either:
- Set `SQLITE_EMBED_MODEL=your-model`
- Or remove `SQLITE_EMBED_PROVIDER` to use global `EMBED_MODEL`

### Error: "Unable to infer embedder provider"

No embedder configuration found. Set at least one of:
- `OPENAI_API_KEY` (for OpenAI)
- `EMBED_BASE_URL` + `EMBED_API_KEY` (for OpenAI-compatible)
- `OLLAMA_MODEL` (for Ollama)

### Error: "This model's maximum context length is X tokens, however you requested Y tokens"

**This is the most common error!** It means you're sending too many tokens in a single API request.

**Solution:**
1. Find your model's token limit (check your provider's documentation)
2. Set `EMBED_MAX_TOKENS` to a value BELOW that limit (leave safety margin)

**Examples:**
```bash
# For text-embedding-3-small (8192 token limit)
EMBED_MAX_TOKENS=7000  # Safety margin of ~1200 tokens

# For Qwen/Qwen3-Embedding-8B on Nebius (check their docs!)
EMBED_MAX_TOKENS=8192  # Adjust based on actual limit

# Different limits per vector store
SQLITE_EMBED_MAX_TOKENS=7000  # Conservative for local
QDRANT_EMBED_MAX_TOKENS=8192  # More aggressive for cloud
```

**How it works:**
- `EMBED_MAX_BATCH` controls **number of texts** (e.g., 60 code blocks)
- `EMBED_MAX_TOKENS` controls **total tokens** (e.g., 8192 tokens)
- The system respects BOTH limits and creates multiple batches if needed

**Example:**
- You have 100 code blocks to embed
- Each block is ~200 tokens
- `EMBED_MAX_BATCH=60` → would try to send 60 blocks = 12,000 tokens ❌
- `EMBED_MAX_TOKENS=8192` → splits into batches of ~40 blocks each ✅

### Different dimensions between SQLite and Qdrant

This is expected if you're using different models. Make sure:
- SQLite database is created with the correct dimension for its model
- Qdrant collection is created with the correct dimension for its model
- Don't mix embeddings from different models in the same vector store

## Best Practices

1. **Start simple**: Use global variables first, add vector-store-specific only when needed
2. **Set token limits**: Always configure `EMBED_MAX_TOKENS` based on your model's actual limit
3. **Leave safety margin**: Set `EMBED_MAX_TOKENS` slightly below the model's limit (e.g., 7000 for 8192 limit)
4. **Document your setup**: Add comments in `.env` explaining why you chose different embedders
5. **Test both stores**: If using different embedders, test search quality in both SQLite and Qdrant
6. **Match dimensions**: Ensure vector store dimension matches embedder output dimension
7. **Consider costs**: Balance quality vs cost when choosing models for each store
8. **Monitor logs**: Check logs for batch splitting info to optimize your configuration

