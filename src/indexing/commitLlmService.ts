import crypto from "crypto"
import type { GitCommitData } from "./gitCommitExtractor.js"
import { Logger } from "../logger.js"
import type { VectorStore } from "../vectorStore/interface.js"
import { generatePointId } from "../vectorStore/interface.js"
import type { Embedder } from "../embedder/index.js"

const logger = new Logger("commit-llm-service")

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

	constructor(
		private readonly workspacePath: string,
		private readonly embedder: Embedder,
		private readonly vectorStore: VectorStore,
	) {
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

		try {
			logger.info(`Sending commit ${commitData.metadata.hash.slice(0, 7)} to LLM for analysis...`)

			// Send to LLM
			const analysis = await this.callLlm(promptText)

			logger.info(`Received LLM analysis (${analysis.length} chars)`)

			// Index the analysis
			await this.indexAnalysis(commitData, analysis)

			logger.info(`Commit analysis indexed successfully`)
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

		// Build request
		const requestBody: OpenAICompatibleRequest = {
			model,
			messages: [
				{
					role: "system",
					content: "You are a code analysis assistant. Analyze git commits and provide structured, semantic insights about code changes.",
				},
				{
					role: "user",
					content: prompt,
				},
			],
			temperature: 0.3,
			max_tokens: 2000,
		}

		// Call LLM using native fetch
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

		logger.info(`Batch processing ${commits.length} commits...`)

		// Phase 1: LLM Analysis (sequential, cannot be parallelized)
		logger.info(`Phase 1/3: Analyzing commits with LLM...`)
		const analyses: Array<{ commitData: GitCommitData; analysis: string; error?: Error }> = []

		for (let i = 0; i < commits.length; i++) {
			const { commitData, promptText } = commits[i]
			const shortHash = commitData.metadata.hash.slice(0, 7)

			try {
				logger.info(`  [${i + 1}/${commits.length}] Analyzing commit ${shortHash}...`)
				const analysis = await this.callLlm(promptText)
				analyses.push({ commitData, analysis })
				logger.debug(`  ✓ Analysis received (${analysis.length} chars)`)
			} catch (error) {
				logger.error(`  ✗ LLM analysis failed for ${shortHash}`, error)
				analyses.push({ commitData, analysis: "", error: error as Error })
			}

			// Small delay to avoid overwhelming LLM
			if (i < commits.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 300))
			}
		}

		// Phase 2: Generate embeddings in batch (parallel API calls)
		logger.info(`Phase 2/3: Generating embeddings in batch...`)
		const successfulAnalyses = analyses.filter(a => !a.error)

		if (successfulAnalyses.length === 0) {
			logger.warn("No successful analyses to embed")
			return analyses.map(a => ({
				indexed: false,
				reason: a.error ? "llm-analysis-failed" : "no-analysis",
				commitHash: a.commitData.metadata.hash,
			}))
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
			return analyses.map(a => ({
				indexed: false,
				reason: "embedding-failed",
				commitHash: a.commitData.metadata.hash,
			}))
		}

		logger.info(`  ✓ Generated ${embeddingResult.embeddings.length} embeddings`)

		// Phase 3: Batch upsert to vector store
		logger.info(`Phase 3/3: Upserting ${successfulAnalyses.length} points to vector store...`)
		const points = successfulAnalyses.map(({ commitData, analysis }, index) => {
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
			return analyses.map(a => ({
				indexed: false,
				reason: "upsert-failed",
				commitHash: a.commitData.metadata.hash,
			}))
		}

		// Build results
		const results: Array<{ indexed: boolean; reason?: string; commitHash: string }> = []
		const successfulHashes = new Set(successfulAnalyses.map(a => a.commitData.metadata.hash))

		for (const { commitData, error } of analyses) {
			if (error) {
				results.push({
					indexed: false,
					reason: "llm-analysis-failed",
					commitHash: commitData.metadata.hash,
				})
			} else if (successfulHashes.has(commitData.metadata.hash)) {
				results.push({
					indexed: true,
					commitHash: commitData.metadata.hash,
				})
			} else {
				results.push({
					indexed: false,
					reason: "unknown-error",
					commitHash: commitData.metadata.hash,
				})
			}
		}

		return results
	}
}
