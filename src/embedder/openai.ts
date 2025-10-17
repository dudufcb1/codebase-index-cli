import OpenAI, { type ClientOptions } from "openai"

import type { Embedder } from "./types.js"
import type { EmbedderConfig } from "../types.js"
import { Logger } from "../logger.js"

const logger = new Logger("embedder:openai")

const DEFAULT_MAX_BATCH_TOKENS = 8192 // Safe default for most OpenAI models
const MAX_ITEM_TOKENS = 8_191

const OPENAI_MODEL_DIMENSIONS: Record<string, number> = {
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
	"text-embedding-ada-002": 1536,
}

export class OpenAIEmbedder implements Embedder {
	private client: OpenAI
	private readonly model: string
	private readonly dimensionOverride?: number
	private readonly maxBatchSize: number
	private readonly maxBatchTokens: number

	constructor(config: EmbedderConfig) {
		if (!config.apiKey) {
			throw new Error("OpenAI embedder requires apiKey")
		}

		const clientOptions: ClientOptions = {
			apiKey: config.apiKey,
		}

		if (config.baseUrl) {
			clientOptions.baseURL = config.baseUrl
		}

		this.client = new OpenAI(clientOptions)
		this.model = config.model
		this.dimensionOverride = config.dimension
		this.maxBatchSize = config.maxBatchSize ?? 60
		this.maxBatchTokens = config.maxBatchTokens ?? DEFAULT_MAX_BATCH_TOKENS
	}

	async validateConfiguration(): Promise<void> {
		await this.client.embeddings.create({
			model: this.model,
			input: ["health-check"],
		})
	}

	dimension(): number {
	const dimension = this.dimensionOverride ?? OPENAI_MODEL_DIMENSIONS[this.model]
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
	let currentTokens = 0

	for (const text of texts) {
			const itemTokens = approximateTokens(text)

			if (itemTokens > MAX_ITEM_TOKENS) {
				logger.warn(
					`Text length (${itemTokens} tokens) exceeds maximum supported tokens for embeddings. Truncating.`,
				)
			}

			const wouldOverflowTokens = currentTokens + itemTokens > this.maxBatchTokens
			const wouldOverflowBatch = currentBatch.length >= this.maxBatchSize

			if (currentBatch.length > 0 && (wouldOverflowTokens || wouldOverflowBatch)) {
				batches.push(currentBatch)
				currentBatch = []
				currentTokens = 0
			}

			currentBatch.push(text)
			currentTokens += itemTokens
		}

		if (currentBatch.length > 0) {
			batches.push(currentBatch)
		}

		logger.debug(`Split ${texts.length} texts into ${batches.length} batches (maxBatchSize: ${this.maxBatchSize}, maxBatchTokens: ${this.maxBatchTokens})`)

		const results: number[][] = []

		for (const batch of batches) {
			const response = await this.client.embeddings.create({
				model: this.model,
				input: batch,
			})
			results.push(...response.data.map((item: { embedding: number[] }) => item.embedding))
		}

		return { embeddings: results }
	}
}

function approximateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}
