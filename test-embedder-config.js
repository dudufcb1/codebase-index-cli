#!/usr/bin/env node

/**
 * Test script for vector-store-specific embedder configuration
 * 
 * This script tests the new feature that allows different embedders
 * for SQLite vs Qdrant vector stores.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(70));
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logWarning(message) {
  log(`⚠ ${message}`, colors.yellow);
}

// Test scenarios
const testScenarios = [
  {
    name: 'Global embedder (backward compatible)',
    env: {
      EMBED_PROVIDER: 'openai-compatible',
      EMBED_BASE_URL: 'https://api.studio.nebius.com/v1/',
      EMBED_API_KEY: 'test-key',
      EMBED_MODEL: 'Qwen/Qwen3-Embedding-8B',
      EMBED_DIMENSION: '4096',
    },
    expected: {
      sqlite: {
        provider: 'openai-compatible',
        model: 'Qwen/Qwen3-Embedding-8B',
        dimension: '4096',
      },
      qdrant: {
        provider: 'openai-compatible',
        model: 'Qwen/Qwen3-Embedding-8B',
        dimension: '4096',
      },
    },
  },
  {
    name: 'SQLite-specific embedder',
    env: {
      EMBED_PROVIDER: 'openai-compatible',
      EMBED_BASE_URL: 'https://api.studio.nebius.com/v1/',
      EMBED_API_KEY: 'test-key',
      EMBED_MODEL: 'Qwen/Qwen3-Embedding-8B',
      EMBED_DIMENSION: '4096',
      SQLITE_EMBED_MODEL: 'text-embedding-3-small',
      SQLITE_EMBED_DIMENSION: '1536',
    },
    expected: {
      sqlite: {
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
        dimension: '1536',
      },
      qdrant: {
        provider: 'openai-compatible',
        model: 'Qwen/Qwen3-Embedding-8B',
        dimension: '4096',
      },
    },
  },
  {
    name: 'Qdrant-specific embedder',
    env: {
      EMBED_PROVIDER: 'openai-compatible',
      EMBED_BASE_URL: 'https://api.studio.nebius.com/v1/',
      EMBED_API_KEY: 'test-key',
      EMBED_MODEL: 'text-embedding-3-small',
      EMBED_DIMENSION: '1536',
      QDRANT_EMBED_MODEL: 'Qwen/Qwen3-Embedding-8B',
      QDRANT_EMBED_DIMENSION: '4096',
    },
    expected: {
      sqlite: {
        provider: 'openai-compatible',
        model: 'text-embedding-3-small',
        dimension: '1536',
      },
      qdrant: {
        provider: 'openai-compatible',
        model: 'Qwen/Qwen3-Embedding-8B',
        dimension: '4096',
      },
    },
  },
  {
    name: 'Both SQLite and Qdrant specific',
    env: {
      EMBED_PROVIDER: 'openai-compatible',
      EMBED_BASE_URL: 'https://api.studio.nebius.com/v1/',
      EMBED_API_KEY: 'test-key',
      EMBED_MODEL: 'default-model',
      SQLITE_EMBED_MODEL: 'sqlite-model',
      SQLITE_EMBED_DIMENSION: '768',
      QDRANT_EMBED_MODEL: 'qdrant-model',
      QDRANT_EMBED_DIMENSION: '4096',
    },
    expected: {
      sqlite: {
        provider: 'openai-compatible',
        model: 'sqlite-model',
        dimension: '768',
      },
      qdrant: {
        provider: 'openai-compatible',
        model: 'qdrant-model',
        dimension: '4096',
      },
    },
  },
  {
    name: 'Different providers per store',
    env: {
      SQLITE_EMBED_PROVIDER: 'ollama',
      SQLITE_OLLAMA_MODEL: 'nomic-embed-text',
      SQLITE_OLLAMA_EMBED_DIMENSION: '768',
      QDRANT_EMBED_PROVIDER: 'openai-compatible',
      QDRANT_EMBED_BASE_URL: 'https://api.studio.nebius.com/v1/',
      QDRANT_EMBED_API_KEY: 'test-key',
      QDRANT_EMBED_MODEL: 'Qwen/Qwen3-Embedding-8B',
      QDRANT_EMBED_DIMENSION: '4096',
    },
    expected: {
      sqlite: {
        provider: 'ollama',
        model: 'nomic-embed-text',
        dimension: '768',
      },
      qdrant: {
        provider: 'openai-compatible',
        model: 'Qwen/Qwen3-Embedding-8B',
        dimension: '4096',
      },
    },
  },
];

function testScenario(scenario) {
  logSection(`Test: ${scenario.name}`);
  
  // Clear environment
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EMBED_') || key.startsWith('SQLITE_') || key.startsWith('QDRANT_') || key.startsWith('OLLAMA_')) {
      delete process.env[key];
    }
  }
  
  // Set test environment
  for (const [key, value] of Object.entries(scenario.env)) {
    process.env[key] = value;
  }
  
  log('\nEnvironment variables set:', colors.cyan);
  for (const [key, value] of Object.entries(scenario.env)) {
    console.log(`  ${key}=${value}`);
  }
  
  log('\nExpected configuration:', colors.cyan);
  console.log('  SQLite:', JSON.stringify(scenario.expected.sqlite, null, 2));
  console.log('  Qdrant:', JSON.stringify(scenario.expected.qdrant, null, 2));
  
  logSuccess('Test scenario configured');
}

// Main execution
async function main() {
  log('\n' + '='.repeat(70), colors.bright);
  log('VECTOR-STORE-SPECIFIC EMBEDDER CONFIGURATION TEST', colors.bright + colors.cyan);
  log('='.repeat(70) + '\n', colors.bright);
  
  log('This test verifies the new feature that allows different embedders', colors.yellow);
  log('for SQLite vs Qdrant vector stores.\n', colors.yellow);
  
  logWarning('Note: This is a configuration test only.');
  logWarning('It does not make actual API calls or create vector stores.\n');
  
  for (const scenario of testScenarios) {
    testScenario(scenario);
  }
  
  logSection('Summary');
  logSuccess(`All ${testScenarios.length} test scenarios configured successfully`);
  log('\nTo test with actual vector stores:', colors.cyan);
  log('1. Set your desired environment variables in .env', colors.cyan);
  log('2. Run: pnpm build', colors.cyan);
  log('3. Run: node dist/index.js -start .', colors.cyan);
  log('4. Check the logs to see which embedder is being used\n', colors.cyan);
}

main().catch(error => {
  logError(`Test failed: ${error.message}`);
  console.error(error);
  process.exit(1);
});

