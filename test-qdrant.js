#!/usr/bin/env node

/**
 * Script de prueba para verificar la conexión y consultas a Qdrant
 * Lee las variables de entorno y realiza operaciones de prueba
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
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
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

// Leer configuración de variables de entorno
function readEnvConfig() {
  logSection('📋 VARIABLES DE ENTORNO');
  
  const config = {
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    qdrantApiKey: process.env.QDRANT_API_KEY || '',
    qdrantCollection: process.env.QDRANT_COLLECTION || '',
    searchMinScore: parseFloat(process.env.QDRANT_SEARCH_MIN_SCORE || '0.1'),
    searchMaxResults: parseInt(process.env.QDRANT_SEARCH_MAX_RESULTS || '50'),
    embedProvider: process.env.EMBED_PROVIDER || 'openai',
    embedModel: process.env.EMBED_MODEL || process.env.OPENAI_EMBED_MODEL || '',
    embedDimension: parseInt(process.env.OPENAI_EMBED_DIMENSION || '4096'),
    embedBaseUrl: process.env.EMBED_BASE_URL || '',
  };

  log(`Qdrant URL: ${config.qdrantUrl}`, colors.green);
  log(`Qdrant API Key: ${config.qdrantApiKey ? '***' + config.qdrantApiKey.slice(-8) : '(vacío)'}`, colors.green);
  log(`Qdrant Collection: ${config.qdrantCollection || '(vacío - se generará automáticamente)'}`, colors.green);
  log(`Search Min Score: ${config.searchMinScore}`, colors.green);
  log(`Search Max Results: ${config.searchMaxResults}`, colors.green);
  log(`Embed Provider: ${config.embedProvider}`, colors.green);
  log(`Embed Model: ${config.embedModel}`, colors.green);
  log(`Embed Dimension: ${config.embedDimension}`, colors.green);
  log(`Embed Base URL: ${config.embedBaseUrl}`, colors.green);

  return config;
}

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
        'User-Agent': 'Qdrant-Test-Script',
      },
    });
  } catch (urlError) {
    return new QdrantClient({
      url,
      apiKey: apiKey || undefined,
      headers: {
        'User-Agent': 'Qdrant-Test-Script',
      },
    });
  }
}

// Generar nombre de colección basado en workspace
function generateCollectionName(workspacePath) {
  const hash = createHash('sha256').update(workspacePath).digest('hex');
  return `ws-${hash.substring(0, 16)}`;
}

// Probar conexión a Qdrant
async function testConnection(client) {
  logSection('🔌 PROBANDO CONEXIÓN A QDRANT');
  
  try {
    const collections = await client.getCollections();
    log('✅ Conexión exitosa a Qdrant', colors.green);
    log(`Total de colecciones: ${collections.collections.length}`, colors.blue);
    
    if (collections.collections.length > 0) {
      log('\nColecciones disponibles:', colors.yellow);
      collections.collections.forEach((col, idx) => {
        log(`  ${idx + 1}. ${col.name}`, colors.cyan);
      });
    }
    
    return true;
  } catch (error) {
    log('❌ Error al conectar con Qdrant:', colors.red);
    log(error.message, colors.red);
    return false;
  }
}

// Obtener información de una colección
async function getCollectionInfo(client, collectionName) {
  logSection(`📊 INFORMACIÓN DE LA COLECCIÓN: ${collectionName}`);
  
  try {
    const info = await client.getCollection(collectionName);
    
    log('✅ Colección encontrada', colors.green);
    log(`Nombre: ${info.name}`, colors.blue);
    log(`Vectores: ${info.vectors_count || 0}`, colors.blue);
    log(`Puntos indexados: ${info.indexed_vectors_count || 0}`, colors.blue);
    log(`Estado: ${info.status}`, colors.blue);
    
    if (info.config) {
      log('\nConfiguración de vectores:', colors.yellow);
      if (info.config.params?.vectors) {
        const vectorConfig = info.config.params.vectors;
        log(`  Dimensión: ${vectorConfig.size}`, colors.cyan);
        log(`  Distancia: ${vectorConfig.distance}`, colors.cyan);
        log(`  On disk: ${vectorConfig.on_disk}`, colors.cyan);
      }
      
      if (info.config.hnsw_config) {
        log('\nConfiguración HNSW:', colors.yellow);
        log(`  M: ${info.config.hnsw_config.m}`, colors.cyan);
        log(`  EF Construct: ${info.config.hnsw_config.ef_construct}`, colors.cyan);
        log(`  On disk: ${info.config.hnsw_config.on_disk}`, colors.cyan);
      }
    }
    
    return info;
  } catch (error) {
    log('❌ Error al obtener información de la colección:', colors.red);
    log(error.message, colors.red);
    return null;
  }
}

// Realizar una búsqueda de prueba
async function testSearch(client, collectionName, dimension) {
  logSection(`🔍 PRUEBA DE BÚSQUEDA EN: ${collectionName}`);
  
  try {
    // Crear un vector de prueba (todos ceros)
    const testVector = new Array(dimension).fill(0);
    testVector[0] = 1.0; // Poner un valor no-cero para que sea válido
    
    log(`Buscando con vector de dimensión ${dimension}...`, colors.yellow);
    
    const searchResult = await client.query(collectionName, {
      query: testVector,
      limit: 5,
      with_payload: true,
    });
    
    log(`✅ Búsqueda exitosa`, colors.green);
    log(`Resultados encontrados: ${searchResult.points.length}`, colors.blue);
    
    if (searchResult.points.length > 0) {
      log('\nPrimeros resultados:', colors.yellow);
      searchResult.points.slice(0, 3).forEach((point, idx) => {
        log(`\n  Resultado ${idx + 1}:`, colors.cyan);
        log(`    ID: ${point.id}`, colors.cyan);
        log(`    Score: ${point.score}`, colors.cyan);
        if (point.payload) {
          log(`    File: ${point.payload.filePath || 'N/A'}`, colors.cyan);
          log(`    Lines: ${point.payload.startLine || 'N/A'} - ${point.payload.endLine || 'N/A'}`, colors.cyan);
          if (point.payload.codeChunk) {
            const preview = point.payload.codeChunk.substring(0, 100).replace(/\n/g, ' ');
            log(`    Preview: ${preview}...`, colors.cyan);
          }
        }
      });
    } else {
      log('⚠️  No se encontraron resultados (la colección puede estar vacía)', colors.yellow);
    }
    
    return searchResult;
  } catch (error) {
    log('❌ Error al realizar búsqueda:', colors.red);
    log(error.message, colors.red);
    if (error.message.includes('dimension')) {
      log('\n💡 Sugerencia: Verifica que la dimensión del vector coincida con la configuración de la colección', colors.yellow);
    }
    return null;
  }
}

// Función principal
async function main() {
  log('\n🚀 SCRIPT DE PRUEBA DE QDRANT\n', colors.bright + colors.green);
  
  // 1. Leer configuración
  const config = readEnvConfig();
  
  // 2. Crear cliente
  logSection('🔧 CREANDO CLIENTE DE QDRANT');
  const client = createQdrantClient(config.qdrantUrl, config.qdrantApiKey);
  log('✅ Cliente creado', colors.green);
  
  // 3. Probar conexión
  const connected = await testConnection(client);
  if (!connected) {
    log('\n❌ No se pudo conectar a Qdrant. Verifica que el servicio esté corriendo.', colors.red);
    process.exit(1);
  }
  
  // 4. Determinar nombre de colección
  let collectionName = config.qdrantCollection;
  if (!collectionName) {
    const workspacePath = process.cwd();
    collectionName = generateCollectionName(workspacePath);
    log(`\n💡 Nombre de colección generado automáticamente: ${collectionName}`, colors.yellow);
  }
  
  // 5. Obtener información de la colección
  const collectionInfo = await getCollectionInfo(client, collectionName);
  
  if (!collectionInfo) {
    log('\n⚠️  La colección no existe. Ejecuta el indexador primero con: npm start -- -start .', colors.yellow);
    return;
  }
  
  // 6. Realizar búsqueda de prueba
  await testSearch(client, collectionName, config.embedDimension);
  
  // Resumen final
  logSection('✅ RESUMEN');
  log('Conexión a Qdrant: OK', colors.green);
  log(`Colección "${collectionName}": ${collectionInfo ? 'OK' : 'NO ENCONTRADA'}`, collectionInfo ? colors.green : colors.red);
  log(`Vectores en colección: ${collectionInfo?.vectors_count || 0}`, colors.blue);
  
  log('\n✨ Prueba completada\n', colors.bright + colors.green);
}

// Ejecutar
main().catch((error) => {
  log('\n💥 Error fatal:', colors.red);
  console.error(error);
  process.exit(1);
});

