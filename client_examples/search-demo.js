#!/usr/bin/env node

/**
 * Interactive SQLite-vec Search Demo (JavaScript/Node.js)
 * 
 * This script demonstrates how to search a codebase index stored in SQLite-vec.
 * It reads configuration from environment variables and provides an interactive
 * search interface.
 * 
 * Usage:
 *   node search-demo.js
 *   # or make it executable:
 *   chmod +x search-demo.js
 *   ./search-demo.js
 * 
 * Environment Variables (from .env):
 *   EMBED_PROVIDER - Embedding provider (openai, openai-compatible, ollama)
 *   EMBED_MODEL - Model name
 *   EMBED_API_KEY - API key for the embedding service
 *   EMBED_BASE_URL - Base URL for the embedding service
 *   EMBED_DIMENSION - Vector dimension (e.g., 1536, 4096)
 */

import Database from 'better-sqlite3';
import * as sqlite_vec from 'sqlite-vec';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration from environment
const CONFIG = {
  embedProvider: process.env.EMBED_PROVIDER || 'openai-compatible',
  embedModel: process.env.EMBED_MODEL || 'Qwen/Qwen3-Embedding-8B',
  embedApiKey: process.env.EMBED_API_KEY || '',
  embedBaseUrl: process.env.EMBED_BASE_URL || 'https://api.studio.nebius.com/v1/',
  embedDimension: parseInt(process.env.EMBED_DIMENSION || '4096'),
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Prompt user for input
 */
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Generate embedding for a text query
 */
async function generateEmbedding(text) {
  const url = `${CONFIG.embedBaseUrl}/embeddings`;
  
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
 * Main interactive loop
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         SQLite-vec Interactive Search Demo (JavaScript/Node.js)           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Provider: ${CONFIG.embedProvider}`);
  console.log(`  Model: ${CONFIG.embedModel}`);
  console.log(`  Base URL: ${CONFIG.embedBaseUrl}`);
  console.log(`  Dimension: ${CONFIG.embedDimension}`);
  console.log('');

  // Ask for database path
  const dbPath = await prompt('Enter the path to the SQLite database (e.g., .codebase/vectors.db): ');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`\n❌ Error: Database file not found: ${dbPath}`);
    rl.close();
    return;
  }

  // Open database
  console.log(`\n✓ Opening database: ${dbPath}`);
  const db = new Database(dbPath);
  
  // Load sqlite-vec extension
  sqlite_vec.load(db);
  console.log('✓ Loaded sqlite-vec extension');

  // Get table name (assume 'code_vectors' or first vec0 table)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%vec0%'").all();
  
  if (tables.length === 0) {
    console.error('\n❌ Error: No vec0 tables found in database');
    db.close();
    rl.close();
    return;
  }

  const tableName = tables[0].name;
  console.log(`✓ Using table: ${tableName}`);

  // Get row count
  const count = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
  console.log(`✓ Database contains ${count.count} vectors\n`);

  // Interactive search loop
  while (true) {
    const query = await prompt('\nEnter your search query (or "exit" to quit): ');
    
    if (query.toLowerCase() === 'exit' || query.toLowerCase() === 'quit') {
      break;
    }

    if (!query) {
      console.log('⚠️  Please enter a search query');
      continue;
    }

    try {
      console.log('\n⏳ Generating embedding...');
      const queryVector = await generateEmbedding(query);
      console.log(`✓ Generated ${queryVector.length}-dimensional embedding`);

      console.log('⏳ Searching database...');
      const results = searchDatabase(db, tableName, queryVector, 10);
      
      displayResults(results);

    } catch (error) {
      console.error(`\n❌ Error: ${error.message}`);
    }
  }

  // Cleanup
  db.close();
  rl.close();
  console.log('\n👋 Goodbye!\n');
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  rl.close();
  process.exit(1);
});

