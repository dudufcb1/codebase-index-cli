import type { LogLevel } from "./logger.js"

export type EmbedderProvider =
	| "openai"
	| "openai-compatible"
	| "ollama"

export interface EmbedderConfig {
	provider: EmbedderProvider
	model: string
	apiKey?: string
	baseUrl?: string
	dimension?: number
	maxBatchSize?: number
	maxBatchTokens?: number
}

export type VectorStoreType = "qdrant" | "sqlite"

export interface QdrantConfig {
	url: string
	apiKey?: string
	searchMinScore?: number
	searchMaxResults?: number
}

export interface SqliteConfig {
	dbPath?: string
	searchMinScore?: number
	searchMaxResults?: number
}

export interface IndexingConfig {
	workspacePath: string
	embedder: EmbedderConfig
	vectorStore?: VectorStoreType
	qdrant?: QdrantConfig
	sqlite?: SqliteConfig
	cachePath?: string
	batchSize?: number
	fileGlobs?: string[]
	maxFileSizeBytes?: number
	useTreeSitter?: boolean
	watch?: {
		debounceMs?: number
		enabled?: boolean
	}
	git?: {
		trackCommits?: boolean
	}
}

export type CliCommand = "start" | "restart" | "stats" | "full-reset" | "index-history"

export interface CliOptions {
	command: CliCommand
	workspacePath: string
	logLevel?: LogLevel
	historyCount?: number  // Number of commits to index for "index-history" command
}
