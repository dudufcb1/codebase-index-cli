import type { Embedder } from "./types.js"
import type { EmbedderConfig } from "../types.js"

const DEFAULT_OLLAMA_URL = "http://localhost:11434"

export class OllamaEmbedder implements Embedder {
	private readonly baseUrl: string
	private readonly model: string
	private readonly dimensionOverride?: number
	private readonly maxBatchTokens: number

	constructor(config: EmbedderConfig) {
		this.baseUrl = (config.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "")
		this.model = config.model
		this.dimensionOverride = config.dimension
		// Ollama processes one text at a time, but we store this for consistency
		this.maxBatchTokens = config.maxBatchTokens ?? 8192
	}

	async validateConfiguration(): Promise<void> {
		await this.createEmbeddings(["health-check"])
	}

	dimension(): number {
		if (!this.dimensionOverride) {
			throw new Error("Ollama embedder requires dimension in config")
		}
		return this.dimensionOverride
	}

	async createEmbeddings(texts: string[]) {
		if (texts.length === 0) {
			return { embeddings: [] }
		}

		const embeddings: number[][] = []

		for (const text of texts) {
			const response = await fetch(`${this.baseUrl}/api/embeddings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.model,
					input: text,
				}),
			})

			if (!response.ok) {
				const message = await response.text()
				throw new Error(`Ollama embeddings request failed: ${response.status} ${message}`)
			}

			const payload = (await response.json()) as { embedding: number[] }
			embeddings.push(payload.embedding)
		}

		return { embeddings }
	}
}
