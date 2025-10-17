#!/usr/bin/env node

/**
 * Qdrant Commit Search Test
 * Search for git commits analyzed by LLM in Qdrant
 * Uses native fetch - no external dependencies
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION - Edit these values for your setup
// ============================================================================
const QDRANT_URL = 'http://localhost:6333';
const QDRANT_API_KEY = undefined; // Set if using authentication

const EMBED_API_KEY = 'sk-111111';
const EMBED_BASE_URL = 'http://localhost:4141/v1';
const EMBED_MODEL = 'text-embedding-3-small';
// ============================================================================

/**
 * Generate embedding for a text query
 */
async function generateEmbedding(text) {
  const baseUrl = EMBED_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/embeddings`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${EMBED_API_KEY}`
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: [text] // OpenAI expects array of strings
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Search for commits in Qdrant using native fetch
 */
async function searchCommits(collectionName, queryVector, limit = 5) {
  const url = `${QDRANT_URL}/collections/${collectionName}/points/search`;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (QDRANT_API_KEY) {
    headers['api-key'] = QDRANT_API_KEY;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vector: queryVector,
      limit: limit,
      filter: {
        must: [
          {
            key: 'type',
            match: { value: 'git-commit-analysis' }
          }
        ]
      },
      with_payload: true,
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Qdrant search error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  return data.result.map(result => ({
    score: result.score,
    commitHash: result.payload.commitHash,
    branch: result.payload.branch,
    author: result.payload.author,
    date: result.payload.date,
    message: result.payload.message,
    filesChanged: result.payload.filesChanged,
    insertions: result.payload.insertions,
    deletions: result.payload.deletions,
    changedFilePaths: result.payload.changedFilePaths,
    analysis: result.payload.analysis,
    workspacePath: result.payload.workspacePath,
  }));
}

/**
 * Get all commits (no semantic search, just filter) using native fetch
 */
async function getAllCommits(collectionName, limit = 5) {
  const url = `${QDRANT_URL}/collections/${collectionName}/points/scroll`;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (QDRANT_API_KEY) {
    headers['api-key'] = QDRANT_API_KEY;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filter: {
        must: [
          {
            key: 'type',
            match: { value: 'git-commit-analysis' }
          }
        ]
      },
      limit: limit,
      with_payload: true,
      with_vector: false,
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Qdrant scroll error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  return data.result.points.map(result => ({
    commitHash: result.payload.commitHash,
    branch: result.payload.branch,
    author: result.payload.author,
    date: result.payload.date,
    message: result.payload.message,
    filesChanged: result.payload.filesChanged,
    insertions: result.payload.insertions,
    deletions: result.payload.deletions,
    changedFilePaths: result.payload.changedFilePaths,
    analysis: result.payload.analysis,
    workspacePath: result.payload.workspacePath,
  }));
}

/**
 * Get collection info using native fetch
 */
async function getCollectionInfo(collectionName) {
  const url = `${QDRANT_URL}/collections/${collectionName}`;

  const headers = {};
  if (QDRANT_API_KEY) {
    headers['api-key'] = QDRANT_API_KEY;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Collection not found: ${collectionName}`);
  }

  const data = await response.json();
  return data.result;
}

/**
 * Get all collections using native fetch
 */
async function getAllCollections() {
  const url = `${QDRANT_URL}/collections`;

  const headers = {};
  if (QDRANT_API_KEY) {
    headers['api-key'] = QDRANT_API_KEY;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to get collections`);
  }

  const data = await response.json();
  return data.result.collections;
}

/**
 * Display commit results
 */
function displayCommits(commits, isSemanticSearch = false) {
  console.log('\n' + '='.repeat(80));
  console.log(`Found ${commits.length} commit(s):`);
  console.log('='.repeat(80) + '\n');

  commits.forEach((commit, index) => {
    console.log(`\n${index + 1}. Commit: ${commit.commitHash.slice(0, 7)}`);
    if (isSemanticSearch) {
      console.log(`   Similarity Score: ${(commit.score * 100).toFixed(2)}%`);
    }
    console.log(`   Branch: ${commit.branch}`);
    console.log(`   Author: ${commit.author}`);
    console.log(`   Date: ${new Date(commit.date).toLocaleString()}`);
    console.log(`   Files: ${commit.filesChanged} (+${commit.insertions}/-${commit.deletions})`);
    console.log('   ' + '-'.repeat(76));

    console.log(`\n   📝 Message:`);
    const messageLines = commit.message.split('\n');
    messageLines.forEach(line => {
      console.log(`      ${line}`);
    });

    console.log(`\n   📁 Changed Files:`);
    const filesToShow = commit.changedFilePaths.slice(0, 5);
    filesToShow.forEach(file => {
      console.log(`      • ${file}`);
    });
    if (commit.changedFilePaths.length > 5) {
      console.log(`      ... and ${commit.changedFilePaths.length - 5} more files`);
    }

    console.log(`\n   🤖 LLM Analysis:`);
    const analysisLines = commit.analysis.split('\n');
    analysisLines.forEach(line => {
      if (line.trim()) {
        console.log(`      ${line}`);
      }
    });

    console.log('');
  });

  console.log('='.repeat(80) + '\n');
}

/**
 * Main function
 */
async function main() {
  const collectionName = process.argv[2];
  const query = process.argv[3];

  if (!collectionName) {
    console.error('Usage: node search-commits.js <collection-name> [query]');
    console.error('');
    console.error('Examples:');
    console.error('  # Get all commits (max 5):');
    console.error('  node search-commits.js codebase-908e5cbf73d44edcbc');
    console.error('');
    console.error('  # Search commits semantically:');
    console.error('  node search-commits.js codebase-908e5cbf73d44edcbc "cleanup and refactoring"');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    Qdrant Commit Search Test                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  Qdrant URL: ${QDRANT_URL}`);
  console.log(`  Collection: ${collectionName}`);
  console.log(`  Embedding Model: ${EMBED_MODEL}`);
  console.log('');

  try {
    // Check if collection exists
    console.log('⏳ Checking collection...');
    const collections = await getAllCollections();
    const collectionExists = collections.some(c => c.name === collectionName);

    if (!collectionExists) {
      console.error(`❌ Collection "${collectionName}" not found`);
      console.error('\nAvailable collections:');
      collections.forEach(c => {
        console.error(`  • ${c.name}`);
      });
      process.exit(1);
    }
    console.log('✓ Collection found');

    // Get collection info
    const collectionInfo = await getCollectionInfo(collectionName);
    const collectionDimension = collectionInfo.config.params.vectors.size;
    console.log(`✓ Collection contains ${collectionInfo.points_count} points`);
    console.log(`✓ Vector dimension: ${collectionDimension}\n`);

    let commits;

    if (query) {
      // Semantic search
      console.log(`Query: "${query}"`);
      console.log('⏳ Generating embedding...');
      const queryVector = await generateEmbedding(query);
      console.log(`✓ Generated ${queryVector.length}-dimensional embedding`);

      console.log('⏳ Searching for commits...');
      commits = await searchCommits(collectionName, queryVector, 5);

      displayCommits(commits, true);
    } else {
      // Get all commits
      console.log('Mode: Get all commits (no semantic search)');
      console.log('⏳ Fetching commits...');
      commits = await getAllCommits(collectionName, 5);

      displayCommits(commits, false);
    }

    if (commits.length === 0) {
      console.log('ℹ️  No commits found in this collection.');
      console.log('   Make sure TRACK_GIT=true and commits have been indexed.\n');
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  console.log('✓ Done!\n');
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
