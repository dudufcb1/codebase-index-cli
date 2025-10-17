// Test tree-sitter parsing on the problematic file
import { parseSourceCodeDefinitionsForFile } from './dist/services/tree-sitter/index.js'

const filePath = '/media/eduardo/56087475087455C9/Dev/Python/QuillScribe/src/quillscribe/main.py'

console.log('🔍 Testing tree-sitter parsing on:', filePath)
console.log('')

try {
	const result = await parseSourceCodeDefinitionsForFile(filePath)
	
	if (!result) {
		console.log('❌ Tree-sitter returned null/undefined')
		process.exit(1)
	}
	
	console.log('✅ Tree-sitter parsing successful')
	console.log('')
	
	// Count blocks
	const lines = result.split('\n')
	const blockLines = lines.filter(line => line.includes('--'))
	
	console.log('📊 Statistics:')
	console.log(`   Total output lines: ${lines.length}`)
	console.log(`   Block definitions: ${blockLines.length}`)
	console.log('')
	
	// Show first 10 blocks
	console.log('📝 First 10 blocks:')
	blockLines.slice(0, 10).forEach((line, i) => {
		const match = line.match(/^(\d+)--(\d+)\s*\|\s*(.+)$/)
		if (match) {
			const start = match[1]
			const end = match[2]
			const lineCount = parseInt(end) - parseInt(start) + 1
			const identifier = match[3].substring(0, 60)
			console.log(`   ${i + 1}. Lines ${start}-${end} (${lineCount} lines): ${identifier}`)
		}
	})
	
	console.log('')
	
	// Check for very large blocks
	const largeBlocks = blockLines.filter(line => {
		const match = line.match(/^(\d+)--(\d+)/)
		if (match) {
			const lineCount = parseInt(match[2]) - parseInt(match[1]) + 1
			return lineCount > 200  // More than 200 lines
		}
		return false
	})
	
	if (largeBlocks.length > 0) {
		console.log(`⚠️  Found ${largeBlocks.length} large blocks (>200 lines):`)
		largeBlocks.forEach((line, i) => {
			const match = line.match(/^(\d+)--(\d+)\s*\|\s*(.+)$/)
			if (match) {
				const start = match[1]
				const end = match[2]
				const lineCount = parseInt(end) - parseInt(start) + 1
				const identifier = match[3].substring(0, 60)
				console.log(`   ${i + 1}. Lines ${start}-${end} (${lineCount} lines): ${identifier}`)
			}
		})
	}
	
} catch (error) {
	console.log('❌ Error:', error.message)
	console.log(error.stack)
	process.exit(1)
}

