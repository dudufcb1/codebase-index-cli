# SQLite-vec Search Demo Examples

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![Python](https://img.shields.io/badge/python-%3E%3D3.8-blue.svg)

Interactive search demos for querying codebase indexes stored in SQLite-vec.

## Overview

These scripts demonstrate how to:
- Connect to a SQLite-vec database
- Generate embeddings for search queries
- Search for similar code chunks
- Display results with similarity scores

Both scripts provide **identical functionality** in different languages:
- `search-demo.js` - JavaScript/Node.js version
- `search-demo.py` - Python version

## Quick Start

### JavaScript/Node.js

```bash
# Install dependencies
npm install better-sqlite3 sqlite-vec dotenv

# Run the demo
node search-demo.js

# Or make it executable
chmod +x search-demo.js
./search-demo.js
```

### Python

```bash
# Install dependencies
pip install sqlite-vec requests python-dotenv

# Run the demo
python search-demo.py

# Or make it executable
chmod +x search-demo.py
./search-demo.py
```

## Configuration

Both scripts read configuration from environment variables (`.env` file):

```bash
# Embedding Provider
EMBED_PROVIDER=openai-compatible

# Model Configuration
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_BASE_URL=https://api.studio.nebius.com/v1/
EMBED_API_KEY=your-api-key-here

# Vector Dimension (must match your indexed data)
EMBED_DIMENSION=4096
```

### Supported Providers

- **openai** - Official OpenAI API
- **openai-compatible** - OpenAI-compatible APIs (Nebius, Together, etc.)
- **ollama** - Local Ollama instance

## Usage

1. **Start the script**:
   ```bash
   node search-demo.js
   # or
   python search-demo.py
   ```

2. **Enter database path** when prompted:
   ```
   Enter the path to the SQLite database: .codebase/vectors.db
   ```

3. **Enter search queries**:
   ```
   Enter your search query: authentication function
   ```

4. **View results**:
   ```
   Found 10 results:
   ================================================================================

   1. src/auth/login.ts (lines 15-45)
      Score: 87.32% | Distance: 0.1268
      ------------------------------------------------------------------------------
      export async function authenticateUser(username: string, password: string) {
        const user = await db.users.findOne({ username });
        if (!user) {
          throw new Error('User not found');
        }
   ```

5. **Exit**:
   ```
   Enter your search query: exit
   ```

## How It Works

### 1. Load Configuration
Both scripts read embedding configuration from environment variables.

### 2. Connect to Database
```javascript
// JavaScript
const db = new Database(dbPath);
sqlite_vec.load(db);
```

```python
# Python
conn = sqlite3.connect(db_path)
sqlite_vec.load(conn)
```

### 3. Generate Query Embedding
```javascript
// JavaScript
const queryVector = await generateEmbedding(query);
```

```python
# Python
query_vector = generate_embedding(query)
```

### 4. Search Database
```sql
SELECT 
  file_path,
  code_chunk,
  start_line,
  end_line,
  distance
FROM code_vectors
WHERE embedding MATCH ?
ORDER BY distance
LIMIT 10
```

### 5. Display Results
Results are sorted by similarity score (1 - distance) and displayed with:
- File path and line numbers
- Similarity score (0-100%)
- Code preview (first 5 lines)

## Understanding Results

### Similarity Score
- **90-100%** - Excellent match (almost identical)
- **70-90%** - Good match (semantically similar)
- **50-70%** - Moderate match (related concepts)
- **<50%** - Weak match (loosely related)

### Distance
- Lower distance = Higher similarity
- Distance is converted to score: `score = 1 - distance`
- For cosine distance: 0 = identical, 2 = opposite

## Customization

### Change Number of Results

**JavaScript:**
```javascript
const results = searchDatabase(db, tableName, queryVector, 20); // 20 results
```

**Python:**
```python
results = search_database(conn, table_name, query_vector, limit=20)  # 20 results
```

### Filter by Directory

**JavaScript:**
```javascript
const query = `
  SELECT * FROM ${tableName}
  WHERE embedding MATCH ?
    AND file_path LIKE 'src/auth/%'
  ORDER BY distance
  LIMIT ?
`;
```

**Python:**
```python
query = f"""
  SELECT * FROM {table_name}
  WHERE embedding MATCH ?
    AND file_path LIKE 'src/auth/%'
  ORDER BY distance
  LIMIT ?
"""
```

### Adjust Minimum Score

```javascript
// JavaScript
const results = searchResults.filter(r => r.score >= 0.7); // 70% minimum
```

```python
# Python
results = [r for r in results if r['score'] >= 0.7]  # 70% minimum
```

## Troubleshooting

### "Database file not found"
- Check the path you entered
- Make sure you've indexed your codebase first:
  ```bash
  codesql -start .
  ```

### "No vec0 tables found"
- The database might not be a SQLite-vec database
- Try indexing your codebase first

### "Embedding API error"
- Check your `EMBED_API_KEY` is correct
- Verify `EMBED_BASE_URL` is accessible
- Ensure `EMBED_MODEL` is valid for your provider

### "Dimension mismatch"
- `EMBED_DIMENSION` must match the dimension used during indexing
- Check your `.env` file
- Common dimensions: 1536 (OpenAI small), 4096 (Qwen)

## Examples

### Search for Authentication Code
```
Query: user authentication login
```

### Search for Database Queries
```
Query: SQL query database connection
```

### Search for Error Handling
```
Query: try catch error handling
```

### Search for API Endpoints
```
Query: REST API endpoint route handler
```

## Related

- [SQLite-vec Documentation](https://github.com/asg017/sqlite-vec)
- [Main Project README](../README.md)
- [Installation Guide](../INSTALL.md)

## License

Same as the main project.

