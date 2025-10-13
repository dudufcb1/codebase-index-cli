import { Logger } from "../logger.js"
import type { EmbedderConfig } from "../types.js"

import type { Embedder } from "./types.js"
import { OllamaEmbedder } from "./ollama.js"
import { OpenAIEmbedder } from "./openai.js"
import { OpenAICompatibleEmbedder } from "./openaiCompatible.js"

const logger = new Logger("embedder")

export function createEmbedder(config: EmbedderConfig): Embedder {
	switch (config.provider) {
		case "openai":
			logger.info(`Using OpenAI embedder (${config.model})`)
			return new OpenAIEmbedder(config)
		case "openai-compatible":
			logger.info(`Using OpenAI-compatible embedder (${config.model}) at ${config.baseUrl}`)
			return new OpenAICompatibleEmbedder(config)
		case "ollama":
			logger.info(`Using Ollama embedder (${config.model}) at ${config.baseUrl ?? "default"}`)
			return new OllamaEmbedder(config)
		default:
			throw new Error(`Unsupported embedder provider: ${config.provider}`)
	}
}

export type { Embedder } from "./types.js"
