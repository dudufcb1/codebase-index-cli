import { QdrantClient } from "@qdrant/js-client-rest"
import * as dotenv from "dotenv"

dotenv.config()

async function cleanAllQdrant() {
  const url = process.env.QDRANT_URL ?? "http://localhost:6333"
  const apiKey = process.env.QDRANT_API_KEY

  console.log(`\n🔌 Conectando a Qdrant: ${url}`)
  const client = new QdrantClient({ url, apiKey })

  try {
    console.log('🔍 Obteniendo todas las colecciones...')
    const collections = await client.getCollections()

    if (collections.collections.length === 0) {
      console.log('✅ No hay colecciones para eliminar')
      return
    }

    console.log(`\n📦 Encontradas ${collections.collections.length} colecciones:`)
    collections.collections.forEach(col => console.log(`  - ${col.name}`))

    console.log('\n🔥 Eliminando todas las colecciones...')
    for (const col of collections.collections) {
      try {
        await client.deleteCollection(col.name)
        console.log(`  ✓ Eliminada: ${col.name}`)
      } catch (error) {
        console.error(`  ✗ Error eliminando ${col.name}:`, error.message)
      }
    }

    console.log('\n✅ Limpieza completa! Todas las colecciones han sido eliminadas.')
    console.log('\n💡 Ahora puedes ejecutar "codebase -start ." para recrear el índice desde cero.')
  } catch (error) {
    console.error('\n❌ Error al conectar con Qdrant:', error.message)
    console.error('\n💡 Verifica que:')
    console.error('  1. Qdrant esté corriendo')
    console.error('  2. QDRANT_URL en .env apunte a la instancia correcta')
    console.error('  3. QDRANT_API_KEY sea correcta (si aplica)')
    process.exit(1)
  }
}

cleanAllQdrant().catch(error => {
  console.error('\n💥 Error fatal:', error)
  process.exit(1)
})
