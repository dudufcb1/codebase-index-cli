#!/usr/bin/env python3

"""
Interactive SQLite-vec Search Demo (Python)

This script demonstrates how to search a codebase index stored in SQLite-vec.
It reads configuration from environment variables and provides an interactive
search interface.

Usage:
    python search-demo.py
    # or make it executable:
    chmod +x search-demo.py
    ./search-demo.py

Environment Variables (from .env):
    EMBED_PROVIDER - Embedding provider (openai, openai-compatible, ollama)
    EMBED_MODEL - Model name
    EMBED_API_KEY - API key for the embedding service
    EMBED_BASE_URL - Base URL for the embedding service
    EMBED_DIMENSION - Vector dimension (e.g., 1536, 4096)

Requirements:
    pip install sqlite-vec requests python-dotenv
"""

import os
import sys
import json
import sqlite3
import requests
from pathlib import Path
from typing import List, Dict, Any
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration from environment
CONFIG = {
    'embed_provider': os.getenv('EMBED_PROVIDER', 'openai-compatible'),
    'embed_model': os.getenv('EMBED_MODEL', 'Qwen/Qwen3-Embedding-8B'),
    'embed_api_key': os.getenv('EMBED_API_KEY', ''),
    'embed_base_url': os.getenv('EMBED_BASE_URL', 'https://api.studio.nebius.com/v1/'),
    'embed_dimension': int(os.getenv('EMBED_DIMENSION', '4096')),
}


def generate_embedding(text: str) -> List[float]:
    """Generate embedding for a text query"""
    url = f"{CONFIG['embed_base_url']}/embeddings"
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f"Bearer {CONFIG['embed_api_key']}"
    }
    
    payload = {
        'model': CONFIG['embed_model'],
        'input': text
    }
    
    response = requests.post(url, headers=headers, json=payload)
    
    if not response.ok:
        raise Exception(f"Embedding API error: {response.status_code} {response.text}")
    
    data = response.json()
    return data['data'][0]['embedding']


def search_database(conn: sqlite3.Connection, table_name: str, 
                   query_vector: List[float], limit: int = 10) -> List[Dict[str, Any]]:
    """Search the SQLite-vec database"""
    query_vector_json = json.dumps(query_vector)
    
    query = f"""
        SELECT 
            id,
            file_path,
            code_chunk,
            start_line,
            end_line,
            segment_hash,
            distance
        FROM {table_name}
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
    """
    
    cursor = conn.cursor()
    cursor.execute(query, (query_vector_json, limit))
    rows = cursor.fetchall()
    
    # Convert distance to similarity score (1 - distance for cosine)
    results = []
    for row in rows:
        results.append({
            'file_path': row[1],
            'code_chunk': row[2],
            'start_line': row[3],
            'end_line': row[4],
            'score': 1 - row[6],
            'distance': row[6]
        })
    
    return results


def display_results(results: List[Dict[str, Any]]) -> None:
    """Display search results"""
    print('\n' + '=' * 80)
    print(f'Found {len(results)} results:')
    print('=' * 80 + '\n')

    for index, result in enumerate(results, 1):
        print(f"\n{index}. {result['file_path']} (lines {result['start_line']}-{result['end_line']})")
        print(f"   Score: {result['score'] * 100:.2f}% | Distance: {result['distance']:.4f}")
        print('   ' + '-' * 76)

        # Show all code
        lines = result['code_chunk'].split('\n')
        for line in lines:
            print(f"   {line}")

    print('\n' + '=' * 80 + '\n')


def main():
    """Main interactive loop"""
    print('╔════════════════════════════════════════════════════════════════════════════╗')
    print('║              SQLite-vec Interactive Search Demo (Python)                  ║')
    print('╚════════════════════════════════════════════════════════════════════════════╝\n')
    
    print('Configuration:')
    print(f"  Provider: {CONFIG['embed_provider']}")
    print(f"  Model: {CONFIG['embed_model']}")
    print(f"  Base URL: {CONFIG['embed_base_url']}")
    print(f"  Dimension: {CONFIG['embed_dimension']}")
    print('')
    
    # Ask for database path
    db_path = input('Enter the path to the SQLite database (e.g., .codebase/vectors.db): ').strip()
    
    if not Path(db_path).exists():
        print(f'\n❌ Error: Database file not found: {db_path}')
        return
    
    # Open database
    print(f'\n✓ Opening database: {db_path}')
    conn = sqlite3.connect(db_path)
    
    # Load sqlite-vec extension
    try:
        conn.enable_load_extension(True)
        # Try to load sqlite-vec (path may vary)
        try:
            conn.load_extension('vec0')
        except:
            # Try alternative paths
            import sqlite_vec
            sqlite_vec.load(conn)
        print('✓ Loaded sqlite-vec extension')
    except Exception as e:
        print(f'⚠️  Warning: Could not load sqlite-vec extension: {e}')
        print('   Continuing anyway (extension might be built-in)...')
    
    # Get table name (assume 'code_vectors' or first vec0 table)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%vec0%'")
    tables = cursor.fetchall()
    
    if not tables:
        print('\n❌ Error: No vec0 tables found in database')
        conn.close()
        return
    
    table_name = tables[0][0]
    print(f'✓ Using table: {table_name}')
    
    # Get row count
    cursor.execute(f'SELECT COUNT(*) FROM {table_name}')
    count = cursor.fetchone()[0]
    print(f'✓ Database contains {count} vectors\n')
    
    # Interactive search loop
    while True:
        try:
            query = input('\nEnter your search query (or "exit" to quit): ').strip()
            
            if query.lower() in ['exit', 'quit']:
                break
            
            if not query:
                print('⚠️  Please enter a search query')
                continue
            
            print('\n⏳ Generating embedding...')
            query_vector = generate_embedding(query)
            print(f'✓ Generated {len(query_vector)}-dimensional embedding')
            
            print('⏳ Searching database...')
            results = search_database(conn, table_name, query_vector, limit=10)
            
            display_results(results)
            
        except KeyboardInterrupt:
            print('\n\n👋 Interrupted by user')
            break
        except Exception as error:
            print(f'\n❌ Error: {error}')
    
    # Cleanup
    conn.close()
    print('\n👋 Goodbye!\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Fatal error: {error}', file=sys.stderr)
        sys.exit(1)

