#!/usr/bin/env node

/**
 * Non-interactive SQLite-vec Search Test
 * For quick testing without interactive prompts
 */

import Database from 'better-sqlite3';
import * as sqlite_vec from 'sqlite-vec';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Configuration from environment
const CONFIG = {
  embedProvider: process.env.EMBED_PROVIDER || 'openai-compatible',
  embedModel: process.env.EMBED_MODEL || 'Qwen/Qwen3-Embedding-8B',
  embedApiKey: process.env.EMBED_API_KEY || '',
  embedBaseUrl: process.env.EMBED_BASE_URL || 'https://api.studio.nebius.com/v1/',
  embedDimension: parseInt(process.env.EMBED_DIMENSION || '4096'),
};

/**
 * Generate embedding for a text query
 */
async function generateEmbedding(text) {
  // Remove trailing slash and add /embeddings
  const baseUrl = CONFIG.embedBaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/embeddings`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.embedApiKey}`
    },
    body: JSON.stringify({
      model: CONFIG.embedModel,
      input: text
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Search the SQLite-vec database
 */
function searchDatabase(db, tableName, queryVector, limit = 10) {
  const queryVectorJson = JSON.stringify(queryVector);
  
  const query = `
    SELECT 
      id,
      file_path,
      code_chunk,
      start_line,
      end_line,
      segment_hash,
      distance
    FROM ${tableName}
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `;

  const stmt = db.prepare(query);
  const rows = stmt.all(queryVectorJson, limit);

  // Convert distance to similarity score (1 - distance for cosine)
  return rows.map(row => ({
    filePath: row.file_path,
    codeChunk: row.code_chunk,
    startLine: row.start_line,
    endLine: row.end_line,
    score: 1 - row.distance,
    distance: row.distance
  }));
}

/**
 * Display search results
 */
function displayResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log(`Found ${results.length} results:`);
  console.log('='.repeat(80) + '\n');

  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.filePath} (lines ${result.startLine}-${result.endLine})`);
    console.log(`   Score: ${(result.score * 100).toFixed(2)}% | Distance: ${result.distance.toFixed(4)}`);
    console.log('   ' + '-'.repeat(76));
    
    // Show first 5 lines of code
    const lines = result.codeChunk.split('\n').slice(0, 5);
    lines.forEach(line => {
      console.log(`   ${line}`);
    });
    
    if (result.codeChunk.split('\n').length > 5) {
      console.log(`   ... (${result.codeChunk.split('\n').length - 5} more lines)`);
    }
  });

  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Main function
 */
async function main() {
  const dbPath = process.argv[2];
  const query = process.argv[3];

  if (!dbPath || !query) {
    console.error('Usage: node search-test.js <db-path> <query>');
    console.error('Example: node search-test.js .codebase/vectors.db "authentication function"');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              SQLite-vec Search Test (Non-interactive)                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Provider: ${CONFIG.embedProvider}`);
  console.log(`  Model: ${CONFIG.embedModel}`);
  console.log(`  Base URL: ${CONFIG.embedBaseUrl}`);
  console.log(`  Dimension: ${CONFIG.embedDimension}`);
  console.log('');

  console.log(`Database: ${dbPath}`);
  console.log(`Query: "${query}"`);
  console.log('');

  // Open database
  console.log('⏳ Opening database...');
  const db = new Database(dbPath);
  
  // Load sqlite-vec extension
  sqlite_vec.load(db);
  console.log('✓ Loaded sqlite-vec extension');

  // Get table name
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%vec0%'").all();
  
  if (tables.length === 0) {
    console.error('❌ Error: No vec0 tables found in database');
    db.close();
    process.exit(1);
  }

  const tableName = tables[0].name;
  console.log(`✓ Using table: ${tableName}`);

  // Get row count
  const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
  console.log(`✓ Database contains ${count.count} vectors\n`);

  try {
    console.log('⏳ Generating embedding...');
    const queryVector = await generateEmbedding(query);
    console.log(`✓ Generated ${queryVector.length}-dimensional embedding`);

    console.log('⏳ Searching database...');
    const results = searchDatabase(db, tableName, queryVector, 10);
    
    displayResults(results);

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }

  // Cleanup
  db.close();
  console.log('✓ Done!\n');
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

