// Test embedding dimensions with different approaches
import 'dotenv/config'

const BASE_URL = process.env.QDRANT_EMBED_BASE_URL || 'http://localhost:4141'
const API_KEY = process.env.QDRANT_EMBED_API_KEY || 'sk-2399292993920039293'
const MODEL = process.env.QDRANT_EMBED_MODEL || 'text-embedding-3-small'

console.log('🔍 Testing embedding dimensions...\n')
console.log(`Base URL: ${BASE_URL}`)
console.log(`Model: ${MODEL}`)
console.log(`API Key: ${API_KEY.substring(0, 10)}...\n`)

// Test with fetch (current approach)
async function testWithFetch() {
	console.log('📡 Test 1: Using fetch directly (OpenAICompatibleEmbedder approach)')
	try {
		// Remove trailing slash and add proper endpoint
		const baseUrl = BASE_URL.replace(/\/$/, '')
		const url = `${baseUrl}/v1/embeddings`
		console.log(`   Trying URL: ${url}`)

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${API_KEY}`
			},
			body: JSON.stringify({
				model: MODEL,
				input: ['test text for embedding']
			})
		})

		if (!response.ok) {
			const error = await response.text()
			console.log(`❌ Error: ${response.status} - ${error}\n`)
			return null
		}

		const data = await response.json()
		const embedding = data.data[0].embedding
		console.log(`✅ Success!`)
		console.log(`   Dimension: ${embedding.length}`)
		console.log(`   First 5 values: [${embedding.slice(0, 5).join(', ')}]`)
		console.log(`   Response structure:`, JSON.stringify(data, null, 2).substring(0, 200) + '...\n')
		return embedding.length
	} catch (error) {
		console.log(`❌ Error: ${error.message}\n`)
		return null
	}
}

// Test with OpenAI library (if available)
async function testWithOpenAILibrary() {
	console.log('📚 Test 2: Using OpenAI library (OpenAIEmbedder approach)')
	try {
		// Try to import OpenAI library
		const { default: OpenAI } = await import('openai')
		
		const client = new OpenAI({
			apiKey: API_KEY,
			baseURL: BASE_URL
		})

		const response = await client.embeddings.create({
			model: MODEL,
			input: ['test text for embedding']
		})

		const embedding = response.data[0].embedding
		console.log(`✅ Success!`)
		console.log(`   Dimension: ${embedding.length}`)
		console.log(`   First 5 values: [${embedding.slice(0, 5).join(', ')}]`)
		console.log(`   Response structure:`, JSON.stringify(response, null, 2).substring(0, 200) + '...\n')
		return embedding.length
	} catch (error) {
		if (error.code === 'ERR_MODULE_NOT_FOUND') {
			console.log(`⚠️  OpenAI library not installed. Run: npm install openai\n`)
		} else {
			console.log(`❌ Error: ${error.message}\n`)
		}
		return null
	}
}

// Run tests
async function main() {
	const fetchDim = await testWithFetch()
	const openaiDim = await testWithOpenAILibrary()

	console.log('📊 RESULTS:')
	console.log(`   Fetch approach: ${fetchDim || 'FAILED'}`)
	console.log(`   OpenAI library: ${openaiDim || 'FAILED/NOT INSTALLED'}`)
	
	if (fetchDim && openaiDim && fetchDim !== openaiDim) {
		console.log(`\n⚠️  WARNING: Dimensions are DIFFERENT!`)
		console.log(`   This confirms the library is doing something different.`)
	} else if (fetchDim && openaiDim && fetchDim === openaiDim) {
		console.log(`\n✅ Both approaches return the same dimension.`)
	}
}

main().catch(console.error)

