import type { Embedder } from "./types.js"
import type { EmbedderConfig } from "../types.js"
import { Logger } from "../logger.js"

const logger = new Logger("embedder:openai-compatible")

const DEFAULT_MAX_BATCH_TOKENS = 8192 // Safe default for most models

const DEFAULT_DIMENSIONS: Record<string, number> = {
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
	"text-embedding-ada-002": 1536,
}

export class OpenAICompatibleEmbedder implements Embedder {
	private readonly baseUrl: string
	private readonly apiKey: string
	private readonly model: string
	private readonly dimensionOverride?: number
	private readonly maxBatchSize: number
	private readonly maxBatchTokens: number

	constructor(config: EmbedderConfig) {
		if (!config.apiKey) {
			throw new Error("OpenAI-compatible embedder requires apiKey")
		}
		if (!config.baseUrl) {
			throw new Error("OpenAI-compatible embedder requires baseUrl")
		}
		this.baseUrl = config.baseUrl.replace(/\/$/, "")
		this.apiKey = config.apiKey
		this.model = config.model
		this.dimensionOverride = config.dimension
		this.maxBatchSize = config.maxBatchSize ?? 60
		this.maxBatchTokens = config.maxBatchTokens ?? DEFAULT_MAX_BATCH_TOKENS

		// DEBUG: Log configuration
		logger.info(`OpenAI-compatible embedder config:`)
		logger.info(`  - model: ${this.model}`)
		logger.info(`  - maxBatchSize: ${this.maxBatchSize}`)
		logger.info(`  - maxBatchTokens: ${this.maxBatchTokens}`)
		logger.info(`  - dimension: ${this.dimensionOverride ?? 'auto'}`)
	}

	async validateConfiguration(): Promise<void> {
		await this.createEmbeddings(["health-check"])
	}

	dimension(): number {
	const dimension = this.dimensionOverride ?? DEFAULT_DIMENSIONS[this.model]
	if (!dimension) {
		throw new Error(`Could not determine embedding dimension for model ${this.model}`)
	}
	return dimension
}

	async createEmbeddings(texts: string[]) {
		if (texts.length === 0) {
			return { embeddings: [] }
		}

	const batches: string[][] = []
	let currentBatch: string[] = []
	let tokenEstimate = 0

	for (const text of texts) {
			const estimate = Math.ceil(text.length / 4)
			const exceedsTokens = tokenEstimate + estimate > this.maxBatchTokens

			if (currentBatch.length >= this.maxBatchSize || exceedsTokens) {
				if (exceedsTokens) {
					logger.debug(`Batch split due to token limit: ${tokenEstimate + estimate} > ${this.maxBatchTokens}`)
				}
				batches.push(currentBatch)
				currentBatch = []
				tokenEstimate = 0
			}

			currentBatch.push(text)
			tokenEstimate += estimate
		}

		if (currentBatch.length > 0) {
			batches.push(currentBatch)
		}

		logger.debug(`Split ${texts.length} texts into ${batches.length} batches (maxBatchSize: ${this.maxBatchSize}, maxBatchTokens: ${this.maxBatchTokens})`)

		const vectors: number[][] = []

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i]
			const batchTokens = batch.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0)
			logger.debug(`Processing batch ${i + 1}/${batches.length}: ${batch.length} texts, ~${batchTokens} tokens`)
			const response = await fetch(`${this.baseUrl}/embeddings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: this.model,
					input: batch,
				}),
			})

			if (!response.ok) {
				const message = await safeParseError(response)
				throw new Error(
					`OpenAI-compatible embeddings request failed with status ${response.status}: ${message ?? "Unknown error"}`,
				)
			}

		const payload = (await response.json()) as { data: Array<{ embedding: number[] }> }
		vectors.push(...payload.data.map((item: { embedding: number[] }) => item.embedding))
		}

		return { embeddings: vectors }
	}
}

async function safeParseError(response: Response): Promise<string | null> {
	try {
		const text = await response.text()
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch {
			return text
		}
		if (parsed && typeof parsed === "object" && "error" in parsed) {
			const error = (parsed as { error: { message?: string } }).error
			return error?.message ?? text
		}
		return text
	} catch (error) {
		logger.warn("Failed to parse error response", error)
		return null
	}
}
