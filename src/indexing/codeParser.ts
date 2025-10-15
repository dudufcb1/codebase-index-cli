import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"

import { isSupportedExtension } from "./supportedExtensions.js"
import { parseSourceCodeDefinitionsForFile } from "../services/tree-sitter/index.js"

const MAX_BLOCK_CHARS = 5000
const MIN_BLOCK_CHARS = 50
const MIN_CHUNK_REMAINDER_CHARS = 500
const MAX_CHARS_TOLERANCE_FACTOR = 1.15

export interface CodeBlock {
	filePath: string
	startLine: number
	endLine: number
	content: string
	segmentHash: string
	fileHash: string
	identifier?: string // Function/class name from tree-sitter
	nodeType?: string // AST node type from tree-sitter
}

export class CodeParser {
	private useTreeSitter: boolean

	constructor(useTreeSitter: boolean = false) {
		this.useTreeSitter = useTreeSitter
	}

	async parseFile(filePath: string): Promise<CodeBlock[]> {
		const ext = path.extname(filePath).toLowerCase()
		if (!isSupportedExtension(ext)) {
			return []
		}

		const content = await fs.readFile(filePath, "utf8")
		const fileHash = this.hash(content)

		// Use tree-sitter if enabled
		if (this.useTreeSitter) {
			try {
				const blocks = await this.parseWithTreeSitter(filePath, content, fileHash)
				if (blocks.length > 0) {
					return blocks
				}
				// Fall back to regex chunking if tree-sitter fails
			} catch (error) {
				console.warn(`Tree-sitter parsing failed for ${filePath}, falling back to regex:`, error)
			}
		}

		return this.chunkSource(content, filePath, fileHash)
	}

	private async parseWithTreeSitter(
		filePath: string,
		content: string,
		fileHash: string,
	): Promise<CodeBlock[]> {
		// Parse file with tree-sitter
		const definitions = await parseSourceCodeDefinitionsForFile(filePath)
		if (!definitions) {
			return []
		}

		const blocks: CodeBlock[] = []
		const lines = content.split(/\r?\n/)

		// Parse the definitions output
		// Format: "startLine--endLine | code_snippet"
		const defLines = definitions.split("\n").filter((line) => line.includes("--"))

		for (const defLine of defLines) {
			const match = defLine.match(/^(\d+)--(\d+)\s*\|\s*(.+)$/)
			if (!match) continue

			const startLine = parseInt(match[1], 10)
			const endLine = parseInt(match[2], 10)
			const identifier = match[3].trim()

			// Extract content for this range
			const blockLines = lines.slice(startLine - 1, endLine)
			const blockContent = blockLines.join("\n")

			// Skip if too small
			if (blockContent.length < MIN_BLOCK_CHARS) {
				continue
			}

			const hash = this.segmentHash(filePath, startLine, endLine, blockContent)

			blocks.push({
				filePath,
				startLine,
				endLine,
				content: blockContent,
				segmentHash: hash,
				fileHash,
				identifier,
				nodeType: "definition", // Generic type for now
			})
		}

		return blocks
	}

	private chunkSource(source: string, filePath: string, fileHash: string): CodeBlock[] {
		const lines = source.split(/\r?\n/)
		const blocks: CodeBlock[] = []
		let currentLines: string[] = []
		let currentLength = 0
		let chunkStartLine = 0
		const effectiveMaxChars = MAX_BLOCK_CHARS * MAX_CHARS_TOLERANCE_FACTOR

		const flush = (endLineIndex: number) => {
			if (currentLength < MIN_BLOCK_CHARS || currentLines.length === 0) {
				currentLines = []
				currentLength = 0
				chunkStartLine = endLineIndex + 1
				return
			}

			const chunkContent = currentLines.join("\n")
			const startLine = chunkStartLine + 1
			const endLine = endLineIndex + 1
			const hash = this.segmentHash(filePath, startLine, endLine, chunkContent)

			blocks.push({
				filePath,
				startLine,
				endLine,
				content: chunkContent,
				segmentHash: hash,
				fileHash,
			})

			currentLines = []
			currentLength = 0
			chunkStartLine = endLineIndex + 1
		}

		const appendLine = (line: string, index: number) => {
			const lineLength = line.length + 1
			// Handle extremely long single-line files (e.g., minified assets)
			if (lineLength > effectiveMaxChars) {
				if (currentLines.length > 0) {
					flush(index - 1)
				}
				let remaining = line
				while (remaining.length > 0) {
					const slice = remaining.slice(0, Math.floor(effectiveMaxChars))
					currentLines = [slice]
					currentLength = slice.length
					chunkStartLine = index
					flush(index)
					chunkStartLine = index
					remaining = remaining.slice(slice.length)
				}
				chunkStartLine = index + 1
				currentLines = []
				currentLength = 0
				return
			}

			const remainingLines = lines.length - index - 1
			const isLastLine = remainingLines === 0
			const nextLine = lines[index + 1] ?? ""
			const nextLineLength = !isLastLine ? nextLine.length : 0

			if (
				currentLength + lineLength > effectiveMaxChars &&
				currentLines.length >= 1 &&
				nextLineLength < MIN_CHUNK_REMAINDER_CHARS
			) {
				flush(index - 1)
			}

			currentLines.push(line)
			currentLength += lineLength

			if (currentLength >= effectiveMaxChars) {
				flush(index)
			}
		}

		lines.forEach((line, index) => appendLine(line, index))
		flush(lines.length - 1)

		return blocks
	}

	private hash(value: string): string {
		return createHash("sha256").update(value).digest("hex")
	}

	private segmentHash(filePath: string, startLine: number, endLine: number, content: string): string {
		const preview = content.slice(0, 100)
		return createHash("sha256")
			.update(`${filePath}-${startLine}-${endLine}-${content.length}-${preview}`)
			.digest("hex")
	}
}
