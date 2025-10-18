import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import type { GitCommitData } from "./gitCommitExtractor.js"
import { Logger } from "../logger.js"
import type { VectorStore } from "../vectorStore/interface.js"
import { generatePointId } from "../vectorStore/interface.js"
import type { Embedder } from "../embedder/index.js"
import { incrementIndexedCommitCount } from "../workspaceState.js"

const logger = new Logger("commit-llm-service")
const FALLBACK_DIFF_CHAR_LIMIT = 20000
const CODEBASE_STRUCTURE_HEADER = "## CODEBASE STRUCTURE"
const COMMIT_METADATA_HEADER = "## COMMIT METADATA"
const FULL_DIFF_HEADER = "## FULL DIFF"
const ANALYSIS_REQUEST_HEADER = "ANALYSIS REQUEST"
const SECTION_SEPARATOR = "=".repeat(80)
const COMMIT_CACHE_FILENAME = "commit-cache.json"
const COMMIT_CACHE_VERSION = 1

interface CommitCacheEntry {
	model: string
	promptHash: string
	indexedAt: string
}

interface CommitCacheFile {
	version: number
	commits: Record<string, CommitCacheEntry>
}

interface PreparedCommit {
	commitData: GitCommitData
	promptText: string
	promptHash: string
	cached: boolean
}

class CommitAnalysisCache {
	private readonly cachePath: string
	private cache = new Map<string, CommitCacheEntry>()
	private loaded = false

	constructor(private readonly workspacePath: string) {
		this.cachePath = path.join(workspacePath, ".codebase", COMMIT_CACHE_FILENAME)
	}

	computePromptHash(promptText: string): string {
		return crypto.createHash("sha256").update(promptText).digest("hex")
	}

	async ensureLoaded(): Promise<void> {
		if (this.loaded) {
			return
		}

		await this.load()
		this.loaded = true
	}

	async isIndexed(commitHash: string, promptHash: string, model: string): Promise<boolean> {
		await this.ensureLoaded()
		const entry = this.cache.get(commitHash)
		return !!entry && entry.model === model && entry.promptHash === promptHash
	}

	async recordIndexed(entry: { commitHash: string; promptHash: string; model: string }): Promise<void> {
		await this.recordMany([entry])
	}

	async recordMany(entries: Array<{ commitHash: string; promptHash: string; model: string }>): Promise<void> {
		if (entries.length === 0) {
			return
		}

		await this.ensureLoaded()

		let updated = false
		const timestamp = new Date().toISOString()

		for (const entry of entries) {
			const existing = this.cache.get(entry.commitHash)
			if (!existing || existing.model !== entry.model || existing.promptHash !== entry.promptHash) {
				this.cache.set(entry.commitHash, {
					model: entry.model,
					promptHash: entry.promptHash,
					indexedAt: timestamp,
				})
				updated = true
			}
		}

		if (updated) {
			await this.persist()
		}
	}

	private async load(): Promise<void> {
		try {
			const raw = await fs.readFile(this.cachePath, "utf8")
			const parsed = JSON.parse(raw) as Partial<CommitCacheFile>

			if (parsed?.version === COMMIT_CACHE_VERSION && parsed.commits && typeof parsed.commits === "object") {
				this.cache = new Map(Object.entries(parsed.commits))
				return
			}

			logger.warn("Commit cache format mismatch. Resetting cache.")
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				logger.warn("Failed to read commit cache", error)
			}
		}

		this.cache = new Map()
	}

	private async persist(): Promise<void> {
		const dir = path.dirname(this.cachePath)
		await fs.mkdir(dir, { recursive: true })

		const data: CommitCacheFile = {
			version: COMMIT_CACHE_VERSION,
			commits: Object.fromEntries(this.cache.entries()),
		}

		const tmpPath = `${this.cachePath}.tmp.${crypto.randomUUID()}`

		try {
			await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8")
			await fs.rename(tmpPath, this.cachePath)
		} catch (error) {
			try {
				await fs.unlink(tmpPath)
			} catch {
				// ignore cleanup errors
			}

			throw error
		}
	}
}

interface LlmConfig {
	provider: string
	endpoint: string
	model: string
	apiKey: string
}

interface OpenAICompatibleRequest {
	model: string
	messages: Array<{
		role: "system" | "user" | "assistant"
		content: string
	}>
	temperature?: number
	max_tokens?: number
}

interface OpenAICompatibleResponse {
	choices: Array<{
		message: {
			role: string
			content: string
		}
	}>
}

export class CommitLlmService {
	private config: LlmConfig | null = null
	private readonly cache: CommitAnalysisCache

	constructor(
		private readonly workspacePath: string,
		private readonly embedder: Embedder,
		private readonly vectorStore: VectorStore,
	) {
		this.cache = new CommitAnalysisCache(workspacePath)
		this.loadConfig()
	}

	private loadConfig(): void {
		const provider = process.env.TRACK_GIT_LLM_PROVIDER
		const endpoint = process.env.TRACK_GIT_LLM_ENDPOINT
		const model = process.env.TRACK_GIT_LLM_MODEL
		const apiKey = process.env.TRACK_GIT_LLM_API_KEY

		if (!provider || !endpoint || !model || !apiKey) {
			logger.warn("LLM configuration incomplete. Commit analysis will be disabled.")
			logger.debug("Required env vars: TRACK_GIT_LLM_PROVIDER, TRACK_GIT_LLM_ENDPOINT, TRACK_GIT_LLM_MODEL, TRACK_GIT_LLM_API_KEY")
			return
		}

		this.config = { provider, endpoint, model, apiKey }
		logger.info(`LLM service configured: ${provider} @ ${endpoint} (model: ${model})`)
	}

	isConfigured(): boolean {
		return this.config !== null
	}

	/**
	 * Analyzes commit data using LLM and indexes the response
	 */
	async analyzeAndIndexCommit(
		commitData: GitCommitData,
		promptText: string,
	): Promise<void> {
		if (!this.config) {
			logger.warn("LLM not configured. Skipping commit analysis.")
			return
		}

		const model = this.config.model
		await this.cache.ensureLoaded()

		const promptHash = this.cache.computePromptHash(promptText)
		const commitHash = commitData.metadata.hash

		if (await this.cache.isIndexed(commitHash, promptHash, model)) {
			logger.info(`Skipping commit ${commitHash.slice(0, 7)} (analysis already cached)`)
			return
		}

		try {
			logger.info(`Sending commit ${commitHash.slice(0, 7)} to LLM for analysis...`)

			// Send to LLM
			const analysis = await this.callLlm(promptText)

			logger.info(`Received LLM analysis (${analysis.length} chars)`)

			// Index the analysis
			await this.indexAnalysis(commitData, analysis)

			logger.info(`Commit analysis indexed successfully`)

			try {
				await this.cache.recordIndexed({ commitHash, promptHash, model })
			} catch (cacheError) {
				logger.warn("Failed to update commit analysis cache", cacheError)
			}

			await this.incrementCommitStats(1)
		} catch (error) {
			logger.error("Failed to analyze and index commit", error)
			throw error
		}
	}

	/**
	 * Calls the LLM with the commit prompt
	 */
	private async callLlm(prompt: string): Promise<string> {
		if (!this.config) {
			throw new Error("LLM not configured")
		}

		const { provider, endpoint, model, apiKey } = this.config

		if (provider !== "openai-compatible") {
			throw new Error(`Unsupported LLM provider: ${provider}`)
		}

		const execute = async (promptText: string): Promise<string> => {
			const requestBody = this.buildRequestBody(model, promptText)

			const response = await fetch(`${endpoint}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${apiKey}`,
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`LLM request failed (${response.status}): ${errorText}`)
			}

			const data = (await response.json()) as OpenAICompatibleResponse

			if (!data.choices || data.choices.length === 0) {
				throw new Error("LLM returned no choices")
			}

			return data.choices[0].message.content
		}

		try {
			return await execute(prompt)
		} catch (error) {
			if (this.isTokenLimitError(error)) {
				const { prompt: compactPrompt, changed } = this.buildCompactPrompt(prompt)

				if (changed) {
					logger.warn(
						`Prompt exceeded token limit, retrying with compact version (reduced ${prompt.length - compactPrompt.length} chars, ${prompt.length} -> ${compactPrompt.length})`,
					)

					try {
						return await execute(compactPrompt)
					} catch (retryError) {
						logger.error("Fallback compact prompt retry failed", retryError)
						throw retryError
					}
				}
			}

			throw error
		}
	}

	private buildRequestBody(model: string, prompt: string): OpenAICompatibleRequest {
		return {
			model,
			messages: [
				{
					role: "system",
					content:
						"You are a code analysis assistant. Analyze git commits and provide structured, semantic insights about code changes.",
				},
				{
					role: "user",
					content: prompt,
				},
			],
			temperature: 0.3,
			max_tokens: 2000,
		}
	}

	private isTokenLimitError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false
		}

		const message = error.message ? error.message.toLowerCase() : ""

		return (
			message.includes("model_max_prompt_tokens_exceeded") ||
			message.includes("maximum context length") ||
			message.includes("prompt token count") ||
			message.includes("token limit")
		)
	}

	private buildCompactPrompt(originalPrompt: string): { prompt: string; changed: boolean } {
		let compactPrompt = originalPrompt
		let changed = false

		const structureHeaderIndex = compactPrompt.indexOf(CODEBASE_STRUCTURE_HEADER)
		const metadataHeaderIndex =
			structureHeaderIndex >= 0 ? compactPrompt.indexOf(COMMIT_METADATA_HEADER, structureHeaderIndex) : -1

		if (structureHeaderIndex >= 0 && metadataHeaderIndex > structureHeaderIndex) {
			const replacement = [
				CODEBASE_STRUCTURE_HEADER,
				"-".repeat(80),
				"(omitted in compact mode to avoid exceeding model token limits)",
				"",
			].join("\n")

			compactPrompt =
				compactPrompt.slice(0, structureHeaderIndex) +
				replacement +
				compactPrompt.slice(metadataHeaderIndex)

			changed = true
			logger.debug("Removed CODEBASE STRUCTURE section for compact prompt fallback")
		}

		const diffHeaderIndex = compactPrompt.indexOf(FULL_DIFF_HEADER)
		const analysisBoundary = `\n${SECTION_SEPARATOR}\n${ANALYSIS_REQUEST_HEADER}`
		const analysisBoundaryIndex =
			diffHeaderIndex >= 0 ? compactPrompt.indexOf(analysisBoundary, diffHeaderIndex) : -1

		if (diffHeaderIndex >= 0 && analysisBoundaryIndex > diffHeaderIndex) {
			const diffSection = compactPrompt.slice(diffHeaderIndex, analysisBoundaryIndex)
			const firstNewline = diffSection.indexOf("\n")
			const secondNewline = firstNewline === -1 ? -1 : diffSection.indexOf("\n", firstNewline + 1)
			const diffBodyStart = secondNewline === -1 ? diffSection.length : secondNewline + 1
			const diffHeader = diffSection.slice(0, diffBodyStart)
			const diffBody = diffSection.slice(diffBodyStart)

			if (diffBody.length > FALLBACK_DIFF_CHAR_LIMIT) {
				let truncatedBody = diffBody.slice(0, FALLBACK_DIFF_CHAR_LIMIT)

				const lastNewline = truncatedBody.lastIndexOf("\n")
				if (lastNewline > FALLBACK_DIFF_CHAR_LIMIT * 0.5) {
					truncatedBody = truncatedBody.slice(0, lastNewline + 1)
				}

				const notice = `[Diff truncated to fit token limit fallback. Showing first ${truncatedBody.length} of ${diffBody.length} characters.]`

				const truncatedSection = `${diffHeader}${truncatedBody}\n${notice}\n`

				compactPrompt =
					compactPrompt.slice(0, diffHeaderIndex) +
					truncatedSection +
					compactPrompt.slice(analysisBoundaryIndex)

				changed = true
				logger.debug(
					`Truncated FULL DIFF section for compact prompt fallback (original ${diffBody.length} chars, truncated to ${truncatedBody.length} chars)`,
				)
			}
		}

		return { prompt: compactPrompt, changed }
	}

	/**
	 * Indexes the LLM analysis in a separate Qdrant collection
	 */
	private async indexAnalysis(
		commitData: GitCommitData,
		analysis: string,
	): Promise<void> {
		const { metadata, stats, changedFiles } = commitData

		// Create a combined text for embedding
		const textToEmbed = [
			`Commit: ${metadata.message}`,
			`Author: ${metadata.author}`,
			`Branch: ${metadata.branch}`,
			`Files changed: ${changedFiles.map(f => f.filePath).join(", ")}`,
			``,
			`Analysis:`,
			analysis,
		].join("\n")

		logger.debug(`Creating embedding for commit analysis (${textToEmbed.length} chars)`)

		// Generate embedding
		const result = await this.embedder.createEmbeddings([textToEmbed])

		if (!result.embeddings || result.embeddings.length === 0) {
			throw new Error("Failed to generate embedding")
		}

		const embedding = result.embeddings[0]

		// Prepare metadata
		// Note: workspacePath is included to explicitly associate commits with their workspace
		// This is redundant (since each workspace has its own Qdrant collection)
		// but helpful for debugging and future queries
		const pointMetadata = {
			workspacePath: this.workspacePath,
			commitHash: metadata.hash,
			branch: metadata.branch,
			author: metadata.author,
			authorEmail: metadata.authorEmail,
			date: metadata.date.toISOString(),
			message: metadata.message,
			filesChanged: stats.filesChanged,
			insertions: stats.insertions,
			deletions: stats.deletions,
			changedFilePaths: changedFiles.map(f => f.filePath),
			analysis,
			type: "git-commit-analysis",
		}

		// Generate a valid UUID from the commit hash
		// Qdrant requires UUIDs or integers as point IDs
		// We hash the commit hash to get a 64-char hex string for generatePointId
		const commitHashForId = crypto
			.createHash("sha256")
			.update(`commit-${metadata.hash}`)
			.digest("hex")
		const pointId = generatePointId(commitHashForId)

		// Index in vector store
		// Note: This will use the same collection as the codebase
		// Future enhancement: Use a separate collection for commit history
		await this.vectorStore.upsertPoints([
			{
				id: pointId,
				vector: embedding,
				payload: pointMetadata,
			},
		])

		logger.debug(`Indexed commit ${metadata.hash.slice(0, 7)} in vector store`)
	}

	private async incrementCommitStats(amount: number): Promise<void> {
		if (amount <= 0) {
			return
		}

		try {
			await incrementIndexedCommitCount(this.workspacePath, amount)
		} catch (error) {
			logger.warn("Failed to update indexed commit count in workspace state", error)
		}
	}

	/**
	 * Index a single commit data
	 * Note: Qdrant's upsert will automatically handle duplicates using the point ID
	 * (which is generated deterministically from the commit hash)
	 * @param commitData Commit data to index
	 * @param promptText Formatted prompt for LLM analysis
	 */
	async indexSingleCommit(
		commitData: GitCommitData,
		promptText: string,
	): Promise<{ indexed: boolean; reason?: string }> {
		try {
			// Analyze and index (upsert will handle duplicates)
			await this.analyzeAndIndexCommit(commitData, promptText)

			return { indexed: true }
		} catch (error) {
			logger.error(`Failed to index commit ${commitData.metadata.hash.slice(0, 7)}`, error)
			return { indexed: false, reason: "error" }
		}
	}

	/**
	 * Batch index multiple commits efficiently
	 * Phase 1: Analyze each commit with LLM (sequential, necessary)
	 * Phase 2: Generate embeddings in batch (parallel API calls)
	 * Phase 3: Upsert all points in batch to vector store
	 *
	 * This is significantly more efficient for indexing historical commits.
	 *
	 * @param commits Array of {commitData, promptText} to process
	 * @returns Results for each commit {indexed, reason?, commitHash}
	 */
	async batchIndexCommits(
		commits: Array<{ commitData: GitCommitData; promptText: string }>,
	): Promise<Array<{ indexed: boolean; reason?: string; commitHash: string }>> {
		if (!this.config) {
			logger.warn("LLM not configured. Skipping batch commit analysis.")
			return commits.map(c => ({
				indexed: false,
				reason: "llm-not-configured",
				commitHash: c.commitData.metadata.hash,
			}))
		}

		if (commits.length === 0) {
			return []
		}

		await this.cache.ensureLoaded()

		const { model } = this.config
		const prepared: PreparedCommit[] = []

		for (const item of commits) {
			const commitHash = item.commitData.metadata.hash
			const promptHash = this.cache.computePromptHash(item.promptText)
			const cached = await this.cache.isIndexed(commitHash, promptHash, model)

			if (cached) {
				logger.info(`Skipping commit ${commitHash.slice(0, 7)} (analysis already cached)`)
			}

			prepared.push({
				commitData: item.commitData,
				promptText: item.promptText,
				promptHash,
				cached,
			})
		}

		const processedResults = new Map<string, { indexed: boolean; reason?: string }>()
		for (const item of prepared) {
			if (item.cached) {
				processedResults.set(item.commitData.metadata.hash, { indexed: true, reason: "cached" })
			}
		}

		const pending = prepared.filter(item => !item.cached)

		const buildResults = () =>
			prepared.map(item => {
				const hash = item.commitData.metadata.hash
				const entry = processedResults.get(hash)
				const indexed = entry?.indexed ?? false
				const reason = entry?.reason ?? (indexed ? undefined : "unknown-error")
				return {
					indexed,
					reason,
					commitHash: hash,
				}
			})

		if (pending.length === 0) {
			return buildResults()
		}

		logger.info(`Batch processing ${pending.length} commits...`)

		// Phase 1: LLM Analysis (sequential, cannot be parallelized)
		logger.info(`Phase 1/3: Analyzing commits with LLM...`)
		const analyses: Array<{
			commitData: GitCommitData
			promptText: string
			promptHash: string
			analysis: string
			error?: Error
		}> = []

		for (let i = 0; i < pending.length; i++) {
			const { commitData, promptText, promptHash } = pending[i]
			const shortHash = commitData.metadata.hash.slice(0, 7)

			try {
				logger.info(`  [${i + 1}/${pending.length}] Analyzing commit ${shortHash}...`)
				const analysis = await this.callLlm(promptText)
				analyses.push({ commitData, promptText, promptHash, analysis })
				logger.debug(`  ✓ Analysis received (${analysis.length} chars)`)
			} catch (error) {
				logger.error(`  ✗ LLM analysis failed for ${shortHash}`, error)
				analyses.push({ commitData, promptText, promptHash, analysis: "", error: error as Error })
				processedResults.set(commitData.metadata.hash, {
					indexed: false,
					reason: "llm-analysis-failed",
				})
			}

			// Small delay to avoid overwhelming LLM
			if (i < pending.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 300))
			}
		}

		// Phase 2: Generate embeddings in batch (parallel API calls)
		logger.info(`Phase 2/3: Generating embeddings in batch...`)
		const successfulAnalyses = analyses.filter(a => !a.error)

		if (successfulAnalyses.length === 0) {
			logger.warn("No successful analyses to embed")
			return buildResults()
		}

		// Prepare texts for embedding
		const textsToEmbed = successfulAnalyses.map(({ commitData, analysis }) => {
			const { metadata, changedFiles } = commitData
			return [
				`Commit: ${metadata.message}`,
				`Author: ${metadata.author}`,
				`Branch: ${metadata.branch}`,
				`Files changed: ${changedFiles.map(f => f.filePath).join(", ")}`,
				``,
				`Analysis:`,
				analysis,
			].join("\n")
		})

		logger.info(`  Generating ${textsToEmbed.length} embeddings...`)
		const embeddingResult = await this.embedder.createEmbeddings(textsToEmbed)

		if (!embeddingResult.embeddings || embeddingResult.embeddings.length !== successfulAnalyses.length) {
			logger.error("Embedding generation failed or returned incorrect count")
			for (const { commitData } of analyses) {
				if (!processedResults.has(commitData.metadata.hash)) {
					processedResults.set(commitData.metadata.hash, {
						indexed: false,
						reason: "embedding-failed",
					})
				}
			}
			return buildResults()
		}

		logger.info(`  ✓ Generated ${embeddingResult.embeddings.length} embeddings`)

		// Phase 3: Batch upsert to vector store
		logger.info(`Phase 3/3: Upserting ${successfulAnalyses.length} points to vector store...`)
		const points = successfulAnalyses.map(({ commitData, analysis, promptHash }, index) => {
			const { metadata, stats, changedFiles } = commitData
			const embedding = embeddingResult.embeddings[index]

			// Prepare metadata
			const pointMetadata = {
				workspacePath: this.workspacePath,
				commitHash: metadata.hash,
				branch: metadata.branch,
				author: metadata.author,
				authorEmail: metadata.authorEmail,
				date: metadata.date.toISOString(),
				message: metadata.message,
				filesChanged: stats.filesChanged,
				insertions: stats.insertions,
				deletions: stats.deletions,
				changedFilePaths: changedFiles.map(f => f.filePath),
				analysis,
				type: "git-commit-analysis",
			}

			// Generate point ID
			const commitHashForId = crypto
				.createHash("sha256")
				.update(`commit-${metadata.hash}`)
				.digest("hex")
			const pointId = generatePointId(commitHashForId)

			return {
				id: pointId,
				vector: embedding,
				payload: pointMetadata,
			}
		})

		try {
			await this.vectorStore.upsertPoints(points)
			logger.info(`  ✓ Batch upsert completed successfully`)
		} catch (error) {
			logger.error("Batch upsert failed", error)
			for (const { commitData } of analyses) {
				if (!processedResults.has(commitData.metadata.hash)) {
					processedResults.set(commitData.metadata.hash, {
						indexed: false,
						reason: "upsert-failed",
					})
				}
			}
			return buildResults()
		}

		try {
			await this.cache.recordMany(
				successfulAnalyses.map(({ commitData, promptHash }) => ({
					commitHash: commitData.metadata.hash,
					promptHash,
					model,
				})),
			)
		} catch (cacheError) {
			logger.warn("Failed to update commit analysis cache", cacheError)
		}

		await this.incrementCommitStats(successfulAnalyses.length)

		for (const { commitData } of successfulAnalyses) {
			processedResults.set(commitData.metadata.hash, { indexed: true })
		}

		for (const { commitData, error } of analyses) {
			if (error && !processedResults.has(commitData.metadata.hash)) {
				processedResults.set(commitData.metadata.hash, {
					indexed: false,
					reason: "llm-analysis-failed",
				})
			}
		}

		return buildResults()
	}
}
