import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"

import type { Embedder } from "../embedder/index.js"
import { Logger } from "../logger.js"
import type { IndexingConfig } from "../types.js"
import type { QdrantVectorStore } from "../vectorStore/qdrantVectorStore.js"

import { CacheManager } from "./cacheManager.js"
import { CodeParser } from "./codeParser.js"
import type { CodeBlock } from "./codeParser.js"
import { IgnoreManager } from "./ignoreManager.js"

const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024

function generateNormalizedAbsolutePath(filePath: string, workspaceRoot: string): string {
	return path.normalize(path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath))
}

function generateRelativeFilePath(absolutePath: string, workspaceRoot: string): string {
	return path.relative(workspaceRoot, absolutePath)
}

const logger = new Logger("directory-scanner")

export interface ScanStats {
	processedFiles: number
	skippedFiles: number
	totalBlocks: number
}

export class DirectoryScanner {
	private readonly parser: CodeParser

	constructor(
		private readonly workspacePath: string,
		private readonly embedder: Embedder,
		private readonly vectorStore: QdrantVectorStore,
		private readonly cacheManager: CacheManager,
		private readonly ignoreManager: IgnoreManager,
		private readonly options: IndexingConfig,
	) {
		this.parser = new CodeParser()
	}

	async scan(): Promise<ScanStats> {
		const files = await collectFiles(this.workspacePath, this.ignoreManager)
		const cacheHashes = this.cacheManager.getAllHashes()
		const seenFiles = new Set<string>()

		let processedFiles = 0
		let skippedFiles = 0
		let totalBlocks = 0

		for (const filePath of files) {
			seenFiles.add(filePath)
			const result = await this.processFile(filePath, cacheHashes[filePath])
			if (result.processed) {
				processedFiles++
				totalBlocks += result.blockCount
			} else {
				skippedFiles++
			}
		}

		// Handle deleted files
		for (const cachedPath of Object.keys(cacheHashes)) {
			if (!seenFiles.has(cachedPath)) {
				await this.vectorStore.deletePointsByFilePath(cachedPath)
				await this.cacheManager.deleteHash(cachedPath)
			}
		}

		return { processedFiles, skippedFiles, totalBlocks }
	}

	async processFile(
		filePath: string,
		existingHash?: string,
		options?: { force?: boolean },
	): Promise<{ processed: boolean; blockCount: number }> {
		try {
			if (this.ignoreManager.shouldIgnore(filePath)) {
				return { processed: false, blockCount: 0 }
			}

			const stats = await fs.stat(filePath)
			if (!stats.isFile()) {
				return { processed: false, blockCount: 0 }
			}

			if (stats.size > (this.options.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES)) {
				logger.debug(`Skipping ${filePath} (larger than limit)`)
				return { processed: false, blockCount: 0 }
			}

			const content = await fs.readFile(filePath, "utf8")
			const fileHash = this.hash(content)

			if (!options?.force && existingHash && existingHash === fileHash) {
				return { processed: false, blockCount: 0 }
			}

			const blocks = await this.parser.parseFile(filePath)

			await this.vectorStore.deletePointsByFilePath(filePath)

			if (blocks.length > 0) {
				await this.indexBlocks(filePath, blocks)
			}

			await this.cacheManager.updateHash(filePath, fileHash)
			return { processed: true, blockCount: blocks.length }
		} catch (error) {
			logger.error(`Failed to process ${filePath}`, error)
			return { processed: false, blockCount: 0 }
		}
	}

	async handleDeletion(filePath: string): Promise<void> {
		await this.vectorStore.deletePointsByFilePath(filePath)
		await this.cacheManager.deleteHash(filePath)
	}

	private async indexBlocks(filePath: string, blocks: CodeBlock[]) {
		const entries = blocks
			.map((block) => ({ block, text: block.content.trim() }))
			.filter((entry) => entry.text.length > 0)
		if (entries.length === 0) {
			return
		}

		const embeddingResponse = await this.embedder.createEmbeddings(entries.map((entry) => entry.text))
		const embeddings = embeddingResponse.embeddings

		if (embeddings.length !== entries.length) {
			throw new Error(`Embedding response mismatch for ${filePath}`)
		}

		const points = entries.map((entry, index) => {
			const normalizedPath = generateNormalizedAbsolutePath(entry.block.filePath, this.workspacePath)
			const relativePath = generateRelativeFilePath(normalizedPath, this.workspacePath)
			const vector = embeddings[index]
			if (!vector) {
				throw new Error(`Missing embedding vector for block ${entry.block.segmentHash}`)
			}
			return {
				id: entry.block.segmentHash,
				vector,
				payload: {
					filePath: relativePath,
					codeChunk: entry.block.content,
						startLine: entry.block.startLine,
						endLine: entry.block.endLine,
						segmentHash: entry.block.segmentHash,
					},
				}
			})

		await this.vectorStore.upsertPoints(points)
	}

	private hash(value: string): string {
		return createHash("sha256").update(value).digest("hex")
	}
}

async function collectFiles(basePath: string, ignoreManager: IgnoreManager): Promise<string[]> {
	const results: string[] = []

	async function walk(current: string) {
		const entries = await fs.readdir(current, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(current, entry.name)

			if (ignoreManager.shouldIgnore(fullPath)) {
				continue
			}

			if (entry.isDirectory()) {
				await walk(fullPath)
			} else if (entry.isFile()) {
				results.push(fullPath)
			}
		}
	}

	await walk(basePath)
	return results
}
