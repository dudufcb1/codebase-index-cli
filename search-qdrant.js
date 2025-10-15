#!/usr/bin/env node

/**
 * Script para realizar búsquedas semánticas en Qdrant
 * Genera embeddings reales y busca en la colección
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
dotenv.config({ path: path.join(__dirname, '.env') });

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(70));
}

// Leer configuración
const config = {
  qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
  qdrantApiKey: process.env.QDRANT_API_KEY || '',
  qdrantCollection: process.env.QDRANT_COLLECTION || '',
  searchMinScore: parseFloat(process.env.QDRANT_SEARCH_MIN_SCORE || '0.1'),
  searchMaxResults: parseInt(process.env.QDRANT_SEARCH_MAX_RESULTS || '50'),
  embedBaseUrl: process.env.EMBED_BASE_URL || '',
  embedApiKey: process.env.EMBED_API_KEY || process.env.OPENAI_API_KEY || '',
  embedModel: process.env.EMBED_MODEL || process.env.OPENAI_EMBED_MODEL || '',
};

// Crear cliente de Qdrant
function createQdrantClient(url, apiKey) {
  try {
    const urlObj = new URL(url);
    let port;
    let useHttps;

    if (urlObj.port) {
      port = Number(urlObj.port);
      useHttps = urlObj.protocol === 'https:';
    } else {
      if (urlObj.protocol === 'https:') {
        port = 443;
        useHttps = true;
      } else {
        port = 80;
        useHttps = false;
      }
    }

    return new QdrantClient({
      host: urlObj.hostname,
      https: useHttps,
      port,
      prefix: urlObj.pathname === '/' ? undefined : urlObj.pathname.replace(/\/+$/, ''),
      apiKey: apiKey || undefined,
      headers: {
        'User-Agent': 'Qdrant-Search-Script',
      },
    });
  } catch (urlError) {
    return new QdrantClient({
      url,
      apiKey: apiKey || undefined,
      headers: {
        'User-Agent': 'Qdrant-Search-Script',
      },
    });
  }
}

// Generar embedding usando la API configurada
async function generateEmbedding(text) {
  logSection(`🧠 GENERANDO EMBEDDING PARA: "${text}"`);

  try {
    // Limpiar la base URL quitando slashes finales
    const cleanBaseUrl = config.embedBaseUrl.replace(/\/+$/, '');
    const url = `${cleanBaseUrl}/embeddings`;

    log(`API URL: ${url}`, colors.blue);
    log(`Modelo: ${config.embedModel}`, colors.blue);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.embedApiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: config.embedModel,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      throw new Error('Respuesta inválida de la API de embeddings');
    }

    const embedding = data.data[0].embedding;
    log(`✅ Embedding generado exitosamente`, colors.green);
    log(`Dimensión: ${embedding.length}`, colors.blue);
    log(`Primeros valores: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`, colors.cyan);
    
    return embedding;
  } catch (error) {
    log('❌ Error al generar embedding:', colors.red);
    log(error.message, colors.red);
    throw error;
  }
}

// Realizar búsqueda semántica
async function semanticSearch(client, collectionName, queryVector, minScore, maxResults) {
  logSection(`🔍 BÚSQUEDA SEMÁNTICA EN: ${collectionName}`);
  
  try {
    log(`Min Score: ${minScore}`, colors.blue);
    log(`Max Results: ${maxResults}`, colors.blue);
    
    const searchResult = await client.query(collectionName, {
      query: queryVector,
      score_threshold: minScore,
      limit: maxResults,
      with_payload: true,
      params: {
        hnsw_ef: 128,
        exact: false,
      },
    });
    
    log(`✅ Búsqueda completada`, colors.green);
    log(`Resultados encontrados: ${searchResult.points.length}`, colors.bright + colors.green);
    
    return searchResult.points;
  } catch (error) {
    log('❌ Error al realizar búsqueda:', colors.red);
    log(error.message, colors.red);
    throw error;
  }
}

// Mostrar resultados
function displayResults(results) {
  logSection(`📊 RESULTADOS (${results.length} encontrados)`);
  
  if (results.length === 0) {
    log('⚠️  No se encontraron resultados', colors.yellow);
    return;
  }

  results.forEach((result, idx) => {
    console.log('\n' + '-'.repeat(70));
    log(`Resultado #${idx + 1}`, colors.bright + colors.magenta);
    console.log('-'.repeat(70));
    
    log(`Score: ${result.score.toFixed(6)}`, colors.green);
    log(`ID: ${result.id}`, colors.cyan);
    
    if (result.payload) {
      log(`\n📁 Archivo: ${result.payload.filePath || 'N/A'}`, colors.blue);
      log(`📍 Líneas: ${result.payload.startLine || 'N/A'} - ${result.payload.endLine || 'N/A'}`, colors.blue);
      
      if (result.payload.codeChunk) {
        log(`\n📝 Contenido:`, colors.yellow);
        console.log(colors.cyan + '-'.repeat(70));
        
        // Mostrar el código con límite de líneas
        const lines = result.payload.codeChunk.split('\n');
        const maxLines = 20;
        const displayLines = lines.slice(0, maxLines);
        
        displayLines.forEach((line, lineIdx) => {
          const lineNumber = (result.payload.startLine || 0) + lineIdx;
          console.log(`${colors.cyan}${lineNumber.toString().padStart(4, ' ')} | ${line}${colors.reset}`);
        });
        
        if (lines.length > maxLines) {
          log(`... (${lines.length - maxLines} líneas más)`, colors.yellow);
        }
        
        console.log(colors.cyan + '-'.repeat(70) + colors.reset);
      }
    }
  });
}

// Función principal
async function main() {
  const searchQuery = process.argv[2] || 'RAG service context retrieval';
  
  log('\n🔎 BÚSQUEDA SEMÁNTICA EN QDRANT\n', colors.bright + colors.green);
  
  logSection('⚙️  CONFIGURACIÓN');
  log(`Query: "${searchQuery}"`, colors.yellow);
  log(`Colección: ${config.qdrantCollection}`, colors.blue);
  log(`Qdrant URL: ${config.qdrantUrl}`, colors.blue);
  log(`Min Score: ${config.searchMinScore}`, colors.blue);
  log(`Max Results: ${config.searchMaxResults}`, colors.blue);
  
  // Validar configuración
  if (!config.qdrantCollection) {
    log('\n❌ Error: QDRANT_COLLECTION no está configurado en .env', colors.red);
    process.exit(1);
  }
  
  if (!config.embedBaseUrl || !config.embedApiKey || !config.embedModel) {
    log('\n❌ Error: Configuración de embeddings incompleta en .env', colors.red);
    log('Verifica: EMBED_BASE_URL, EMBED_API_KEY, EMBED_MODEL', colors.yellow);
    process.exit(1);
  }
  
  // Crear cliente
  const client = createQdrantClient(config.qdrantUrl, config.qdrantApiKey);
  
  // Generar embedding
  const queryVector = await generateEmbedding(searchQuery);
  
  // Realizar búsqueda
  const results = await semanticSearch(
    client,
    config.qdrantCollection,
    queryVector,
    config.searchMinScore,
    config.searchMaxResults
  );
  
  // Mostrar resultados
  displayResults(results);
  
  // Resumen
  logSection('✅ RESUMEN');
  log(`Query: "${searchQuery}"`, colors.yellow);
  log(`Resultados encontrados: ${results.length}`, colors.green);
  if (results.length > 0) {
    log(`Mejor score: ${results[0].score.toFixed(6)}`, colors.green);
    log(`Peor score: ${results[results.length - 1].score.toFixed(6)}`, colors.green);
  }
  
  log('\n✨ Búsqueda completada\n', colors.bright + colors.green);
}

// Ejecutar
main().catch((error) => {
  log('\n💥 Error fatal:', colors.red);
  console.error(error);
  process.exit(1);
});

