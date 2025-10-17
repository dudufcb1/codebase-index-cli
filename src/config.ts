import fs from "fs/promises"
import path from "path"
import { z } from "zod"

import type {
	EmbedderConfig,
	EmbedderProvider,
	CliOptions,
	CliCommand,
	IndexingConfig,
	QdrantConfig,
	SqliteConfig,
	VectorStoreType,
} from "./types.js"
import { parseLogLevel } from "./logger.js"
import { ensureWorkspaceState, saveWorkspaceState } from "./workspaceState.js"

const embedderSchema = z.object({
	provider: z.enum(["openai", "openai-compatible", "ollama"]),
	model: z.string().min(1, "Model is required"),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
	dimension: z.number().int().positive().optional(),
	maxBatchSize: z.number().int().positive().optional(),
})

const qdrantSchema = z.object({
	url: z.string().min(1, "Qdrant URL is required"),
	apiKey: z.string().optional(),
	searchMinScore: z.number().min(0).max(1).optional(),
	searchMaxResults: z.number().int().positive().optional(),
})

const sqliteSchema = z.object({
	dbPath: z.string().optional(),
	searchMinScore: z.number().min(0).max(1).optional(),
	searchMaxResults: z.number().int().positive().optional(),
})

const configSchema = z.object({
	workspacePath: z.string().min(1, "workspacePath is required"),
	embedder: embedderSchema,
	vectorStore: z.enum(["qdrant", "sqlite"]).optional(),
	qdrant: qdrantSchema.optional(),
	sqlite: sqliteSchema.optional(),
	cachePath: z.string().optional(),
	batchSize: z.number().int().positive().optional(),
	fileGlobs: z.array(z.string()).optional(),
	maxFileSizeBytes: z.number().int().positive().optional(),
	useTreeSitter: z.boolean().optional(),
	watch: z
		.object({
			debounceMs: z.number().int().positive().optional(),
			enabled: z.boolean().optional(),
		})
		.optional(),
})

export const DEFAULT_CONFIG_PATH = "codebase-index.config.json"
export type ConfigSource = "file" | "auto"

export interface ResolvedConfig {
	config: IndexingConfig
	source: ConfigSource
	path?: string
}
const DEFAULT_WATCH_DEBOUNCE_MS = 500

function resolveWorkspacePath(options: CliOptions): string {
	const candidate =
		options.workspacePath ??
		pickEnv("CODEBASE_WORKSPACE_PATH", "WORKSPACE_PATH", "INDEXER_WORKSPACE_PATH") ??
		process.cwd()
	return path.resolve(candidate)
}

function resolveEmbedderProvider(vectorStoreType?: VectorStoreType): EmbedderProvider {
	const prefix = vectorStoreType === "sqlite" ? "SQLITE_" : vectorStoreType === "qdrant" ? "QDRANT_" : ""

	// Try vector-store-specific provider first, then fall back to global
	const explicit =
		pickEnv(`${prefix}EMBED_PROVIDER`) ??
		pickEnv("EMBED_PROVIDER", "IDX_EMBED_PROVIDER")
	if (explicit) {
		const normalized = explicit.toLowerCase()
		if (normalized === "openai" || normalized === "openai-compatible" || normalized === "ollama") {
			return normalized
		}
		throw new Error(
			`Unsupported embedder provider "${explicit}". Expected one of: openai, openai-compatible, ollama`,
		)
	}

	// Try to infer from vector-store-specific variables first
	if (pickEnv(`${prefix}OPENAI_API_KEY`) || pickEnv("OPENAI_API_KEY")) {
		return "openai"
	}
	if (
		(pickEnv(`${prefix}EMBED_BASE_URL`) || pickEnv("EMBED_BASE_URL", "OPENAI_BASE_URL")) &&
		(pickEnv(`${prefix}EMBED_API_KEY`) || pickEnv("EMBED_API_KEY"))
	) {
		return "openai-compatible"
	}
	if (pickEnv(`${prefix}OLLAMA_MODEL`) || pickEnv("OLLAMA_MODEL")) {
		return "ollama"
	}

	throw new Error(
		"Unable to infer embedder provider. Set OPENAI_API_KEY, or EMBED_BASE_URL + EMBED_API_KEY, or OLLAMA_MODEL.",
	)
}

function buildEmbedderConfig(vectorStoreType?: VectorStoreType): EmbedderConfig {
	const provider = resolveEmbedderProvider(vectorStoreType)

	if (provider === "openai") {
		const prefix = vectorStoreType === "sqlite" ? "SQLITE_" : vectorStoreType === "qdrant" ? "QDRANT_" : ""

		const apiKey =
			pickEnv(`${prefix}OPENAI_API_KEY`, `${prefix}EMBED_API_KEY`) ??
			pickEnv("OPENAI_API_KEY", "EMBED_API_KEY", "IDX_EMBED_API_KEY")
		if (!apiKey) {
			throw new Error(`${prefix}OPENAI_API_KEY (or OPENAI_API_KEY) is required for OpenAI provider`)
		}
		const model =
			pickEnv(`${prefix}OPENAI_EMBED_MODEL`, `${prefix}EMBED_MODEL`) ??
			pickEnv("OPENAI_EMBED_MODEL", "EMBED_MODEL") ??
			"text-embedding-3-small"
		const baseUrl =
			pickEnv(`${prefix}OPENAI_BASE_URL`, `${prefix}EMBED_BASE_URL`) ??
			pickEnv("OPENAI_BASE_URL", "EMBED_BASE_URL")
		const dimension =
			parsePositiveInteger(pickEnv(`${prefix}OPENAI_EMBED_DIMENSION`, `${prefix}EMBED_DIMENSION`), `${prefix}OPENAI_EMBED_DIMENSION`) ??
			parsePositiveInteger(pickEnv("OPENAI_EMBED_DIMENSION", "EMBED_DIMENSION"), "OPENAI_EMBED_DIMENSION")
		const maxBatch =
			parsePositiveInteger(pickEnv(`${prefix}OPENAI_MAX_BATCH`, `${prefix}EMBED_MAX_BATCH`), `${prefix}OPENAI_MAX_BATCH`) ??
			parsePositiveInteger(pickEnv("OPENAI_MAX_BATCH", "EMBED_MAX_BATCH"), "OPENAI_MAX_BATCH")
		const maxBatchTokens =
			parsePositiveInteger(pickEnv(`${prefix}OPENAI_MAX_TOKENS`, `${prefix}EMBED_MAX_TOKENS`), `${prefix}OPENAI_MAX_TOKENS`) ??
			parsePositiveInteger(pickEnv("OPENAI_MAX_TOKENS", "EMBED_MAX_TOKENS"), "OPENAI_MAX_TOKENS")

		return {
			provider,
			model,
			apiKey,
			baseUrl,
			dimension,
			maxBatchSize: maxBatch,
			maxBatchTokens,
		}
	}

	if (provider === "openai-compatible") {
		const prefix = vectorStoreType === "sqlite" ? "SQLITE_" : vectorStoreType === "qdrant" ? "QDRANT_" : ""

		const baseUrl =
			pickEnv(`${prefix}EMBED_BASE_URL`, `${prefix}OPENAI_BASE_URL`) ??
			pickEnv("EMBED_BASE_URL", "OPENAI_BASE_URL")
		if (!baseUrl) {
			throw new Error(`${prefix}EMBED_BASE_URL (or EMBED_BASE_URL) is required for openai-compatible provider`)
		}
		const apiKey =
			pickEnv(`${prefix}EMBED_API_KEY`) ??
			pickEnv(`${prefix}OPENAI_API_KEY`) ??
			pickEnv("EMBED_API_KEY", "OPENAI_API_KEY")
		if (!apiKey) {
			throw new Error(`${prefix}EMBED_API_KEY (or EMBED_API_KEY) is required for openai-compatible provider`)
		}
		const model =
			pickEnv(`${prefix}EMBED_MODEL`, `${prefix}OPENAI_EMBED_MODEL`) ??
			pickEnv("EMBED_MODEL", "OPENAI_EMBED_MODEL", "OPENAI_MODEL")
		if (!model) {
			throw new Error(`${prefix}EMBED_MODEL (or EMBED_MODEL) is required for openai-compatible provider`)
		}
		const dimension =
			parsePositiveInteger(pickEnv(`${prefix}EMBED_DIMENSION`, `${prefix}OPENAI_EMBED_DIMENSION`), `${prefix}EMBED_DIMENSION`) ??
			parsePositiveInteger(pickEnv("EMBED_DIMENSION", "OPENAI_EMBED_DIMENSION"), "EMBED_DIMENSION")
		const maxBatch =
			parsePositiveInteger(pickEnv(`${prefix}EMBED_MAX_BATCH`, `${prefix}OPENAI_MAX_BATCH`), `${prefix}EMBED_MAX_BATCH`) ??
			parsePositiveInteger(pickEnv("EMBED_MAX_BATCH", "OPENAI_MAX_BATCH"), "EMBED_MAX_BATCH")
		const maxBatchTokens =
			parsePositiveInteger(pickEnv(`${prefix}EMBED_MAX_TOKENS`, `${prefix}OPENAI_MAX_TOKENS`), `${prefix}EMBED_MAX_TOKENS`) ??
			parsePositiveInteger(pickEnv("EMBED_MAX_TOKENS", "OPENAI_MAX_TOKENS"), "EMBED_MAX_TOKENS")

		return {
			provider,
			model,
			apiKey,
			baseUrl,
			dimension,
			maxBatchSize: maxBatch,
			maxBatchTokens,
		}
	}

	// ollama
	const prefix = vectorStoreType === "sqlite" ? "SQLITE_" : vectorStoreType === "qdrant" ? "QDRANT_" : ""

	const model =
		pickEnv(`${prefix}OLLAMA_MODEL`) ??
		pickEnv("OLLAMA_MODEL")
	if (!model) {
		throw new Error(`${prefix}OLLAMA_MODEL (or OLLAMA_MODEL) is required for ollama provider`)
	}
	const baseUrl =
		pickEnv(`${prefix}OLLAMA_BASE_URL`, `${prefix}EMBED_BASE_URL`) ??
		pickEnv("OLLAMA_BASE_URL", "EMBED_BASE_URL")
	const dimension =
		parsePositiveInteger(pickEnv(`${prefix}OLLAMA_EMBED_DIMENSION`, `${prefix}EMBED_DIMENSION`), `${prefix}OLLAMA_EMBED_DIMENSION`) ??
		parsePositiveInteger(pickEnv("OLLAMA_EMBED_DIMENSION", "EMBED_DIMENSION"), "OLLAMA_EMBED_DIMENSION") ??
		parsePositiveInteger(pickEnv("EMBED_DIMENSION"), "EMBED_DIMENSION")

	if (!dimension) {
		throw new Error(`${prefix}OLLAMA_EMBED_DIMENSION (or OLLAMA_EMBED_DIMENSION) is required for ollama provider`)
	}

	const maxBatch =
		parsePositiveInteger(pickEnv(`${prefix}EMBED_MAX_BATCH`), `${prefix}EMBED_MAX_BATCH`) ??
		parsePositiveInteger(pickEnv("EMBED_MAX_BATCH"), "EMBED_MAX_BATCH")
	const maxBatchTokens =
		parsePositiveInteger(pickEnv(`${prefix}EMBED_MAX_TOKENS`, `${prefix}OLLAMA_MAX_TOKENS`), `${prefix}EMBED_MAX_TOKENS`) ??
		parsePositiveInteger(pickEnv("EMBED_MAX_TOKENS", "OLLAMA_MAX_TOKENS"), "EMBED_MAX_TOKENS")

	return {
		provider,
		model,
		baseUrl,
		dimension,
		maxBatchSize: maxBatch,
		maxBatchTokens,
	}
}

function resolveVectorStoreType(): VectorStoreType {
	const explicit = pickEnv("VECTOR_STORE", "VECTOR_STORE_TYPE")
	if (explicit) {
		const normalized = explicit.toLowerCase()
		if (normalized === "qdrant" || normalized === "sqlite") {
			return normalized
		}
		throw new Error(
			`Unsupported vector store type "${explicit}". Expected one of: qdrant, sqlite`,
		)
	}

	// Default to sqlite for local development
	return "sqlite"
}

function buildQdrantConfig(): QdrantConfig {
	const url = pickEnv("QDRANT_URL", "QDRANT_URL", "IDX_QDRANT_URL") ?? "http://localhost:6333"
	const apiKey = pickEnv("QDRANT_API_KEY", "QDRANT_API_KEY", "IDX_QDRANT_API_KEY")
	const searchMinScore = parseFloatInRange(
		pickEnv("QDRANT_SEARCH_MIN_SCORE"),
		"QDRANT_SEARCH_MIN_SCORE",
		0,
		1,
	)
	const searchMaxResults = parsePositiveInteger(
		pickEnv("QDRANT_SEARCH_MAX_RESULTS"),
		"QDRANT_SEARCH_MAX_RESULTS",
	)

	return {
		url,
		apiKey,
		searchMinScore,
		searchMaxResults,
	}
}

function buildSqliteConfig(workspacePath: string): SqliteConfig {
	const dbPath = pickEnv("SQLITE_DB_PATH")
	const searchMinScore = parseFloatInRange(
		pickEnv("SQLITE_SEARCH_MIN_SCORE"),
		"SQLITE_SEARCH_MIN_SCORE",
		0,
		1,
	)
	const searchMaxResults = parsePositiveInteger(
		pickEnv("SQLITE_SEARCH_MAX_RESULTS"),
		"SQLITE_SEARCH_MAX_RESULTS",
	)

	return {
		dbPath: dbPath ? path.resolve(workspacePath, dbPath) : undefined,
		searchMinScore,
		searchMaxResults,
	}
}

function pickEnv(...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = process.env[key]
		if (value && value.trim() !== "") {
			return value.trim()
		}
	}
	return undefined
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
	if (value === undefined) {
		return undefined
	}
	const parsed = Number.parseInt(value, 10)
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}
	return parsed
}

function parseFloatInRange(value: string | undefined, name: string, min: number, max: number): number | undefined {
	if (value === undefined) {
		return undefined
	}
	const parsed = Number.parseFloat(value)
	if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
		throw new Error(`${name} must be between ${min} and ${max}`)
	}
	return parsed
}

function parseStringList(value: string | undefined): string[] | undefined {
	if (!value) {
		return undefined
	}
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.map((item) => item.replace(/^["']|["']$/g, ""))
}

function parseBoolean(value: string | undefined, name: string): boolean | undefined {
	if (value === undefined) {
		return undefined
	}
	const normalized = value.trim().toLowerCase()
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false
	}
	throw new Error(`${name} must be a boolean-like value (true/false)`)
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

function resolveOptionalPath(value: string | undefined, workspacePath: string): string | undefined {
	if (!value) {
		return undefined
	}
	if (path.isAbsolute(value)) {
		return value
	}
	return path.resolve(workspacePath, value)
}

async function loadConfigFromFilePath(configPath: string): Promise<IndexingConfig> {
	const raw = await fs.readFile(configPath, "utf8")
	const parsed = JSON.parse(raw)
	const normalized = configSchema.parse(parsed)

	return {
		...normalized,
		workspacePath: path.resolve(normalized.workspacePath),
		cachePath: normalized.cachePath ? path.resolve(normalized.cachePath) : undefined,
	}
}

async function loadAutoConfig(options: CliOptions): Promise<IndexingConfig> {
	const workspacePath = resolveWorkspacePath(options)
	const workspaceState = await ensureWorkspaceState(workspacePath)

	const vectorStoreType = resolveVectorStoreType()
	const embedder = buildEmbedderConfig(vectorStoreType)

	const qdrant = buildQdrantConfig()

	const sqlite = buildSqliteConfig(workspacePath)

	const cachePath = resolveOptionalPath(
		pickEnv("INDEXER_CACHE_PATH", "INDEXER_CACHE_PATH"),
		workspacePath,
	) ?? path.join(workspacePath, ".codebase", "cache.json")
	const batchSize = parsePositiveInteger(
		pickEnv("INDEXER_BATCH_SIZE", "INDEXER_BATCH_SIZE"),
		"INDEXER_BATCH_SIZE",
	)
	const fileGlobs = parseStringList(
		pickEnv("INDEXER_FILE_GLOBS", "INDEXER_FILE_GLOBS"),
	)
	const maxFileSizeBytes = parsePositiveInteger(
		pickEnv("INDEXER_MAX_FILE_SIZE_BYTES", "INDEXER_MAX_FILE_SIZE_BYTES"),
		"INDEXER_MAX_FILE_SIZE_BYTES",
	)
	const watchEnabledValue = pickEnv("INDEXER_WATCH_ENABLED", "INDEXER_WATCH_ENABLED", "WATCH_ENABLED")
	const watchEnabledEnv = parseBoolean(watchEnabledValue, "INDEXER_WATCH_ENABLED")
	const watchDebounce = parsePositiveInteger(
		pickEnv("INDEXER_WATCH_DEBOUNCE_MS", "INDEXER_WATCH_DEBOUNCE_MS"),
		"INDEXER_WATCH_DEBOUNCE_MS",
	)

	const useTreeSitterValue = pickEnv("USE_TREE_SITTER", "INDEXER_USE_TREE_SITTER")
	const useTreeSitter = parseBoolean(useTreeSitterValue, "USE_TREE_SITTER") ?? false

	const config: IndexingConfig = {
		workspacePath,
		embedder,
		vectorStore: vectorStoreType,
		qdrant,
		sqlite,
		cachePath,
		batchSize,
		fileGlobs,
		maxFileSizeBytes,
		useTreeSitter,
	}

	const watchEnabled = watchEnabledEnv ?? true
	config.watch = {
		enabled: watchEnabled,
		debounceMs: watchDebounce ?? DEFAULT_WATCH_DEBOUNCE_MS,
	}

	return config
}

export function parseCliArgs(argv: string[]): CliOptions {
	let command: CliCommand | undefined
	let workspacePath: string | undefined
	let logLevel: ReturnType<typeof parseLogLevel> | undefined

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i] ?? ""

		switch (arg) {
			case "-start":
			case "--start":
				if (command) {
					throw new Error("Only one command can be provided at a time")
				}
				command = "start"
				{
					const next = argv[i + 1]
					if (next && !next.startsWith("-")) {
						workspacePath = next
						i++
					}
				}
				break
			case "-restart":
			case "--restart":
				if (command) {
					throw new Error("Only one command can be provided at a time")
				}
				command = "restart"
				{
					const next = argv[i + 1]
					if (next && !next.startsWith("-")) {
						workspacePath = next
						i++
					}
				}
				break
			case "-stats":
			case "--stats":
				if (command) {
					throw new Error("Only one command can be provided at a time")
				}
				command = "stats"
				{
					const next = argv[i + 1]
					if (next && !next.startsWith("-")) {
						workspacePath = next
						i++
					}
				}
				break
			case "-full-reset":
			case "--full-reset":
				if (command) {
					throw new Error("Only one command can be provided at a time")
				}
				command = "full-reset"
				{
					const next = argv[i + 1]
					if (next && !next.startsWith("-")) {
						workspacePath = next
						i++
					}
				}
				break
			case "--log-level":
			case "--level": {
				const next = argv[i + 1]
				if (!next) {
					throw new Error("--log-level requires a value")
				}
				logLevel = parseLogLevel(next)
				i++
				break
			}
			default:
				if (!command && !arg.startsWith("-")) {
					// allow shorthand: cli <command> <path>
					const normalized = arg.toLowerCase()
					if (normalized === "start" || normalized === "restart" || normalized === "stats" || normalized === "full-reset") {
						if (command) {
							throw new Error("Only one command can be provided at a time")
						}
						command = normalized as CliCommand
						const next = argv[i + 1]
						if (next && !next.startsWith("-")) {
							workspacePath = next
							i++
						}
						break
					}
				}

				if (!workspacePath && !arg.startsWith("-")) {
					workspacePath = arg
					break
				}

				throw new Error(`Unknown option: ${arg}`)
		}
	}

	if (!command) {
		throw new Error("Please provide a command: -start, -restart, or -stats")
	}

	const resolvedWorkspace = workspacePath ?? "."

	return {
		command,
		workspacePath: resolvedWorkspace,
		logLevel,
	}
}

export async function resolveConfig(options: CliOptions): Promise<ResolvedConfig> {
	if (options.command === "stats") {
		throw new Error("Stats command does not require configuration resolution")
	}

	const explicitInput = process.env.CODEBASE_INDEX_CONFIG
	if (explicitInput) {
		const configPath = resolveConfigPath(explicitInput)
		if (!(await fileExists(configPath))) {
			console.warn(
				`[config] Configuration file not found at ${configPath}. Falling back to auto configuration via environment variables.`,
			)
			const autoConfig = await loadAutoConfig(options)
			return { config: autoConfig, source: "auto" }
		}
		const config = await loadConfigFromFilePath(configPath)
		return { config, source: "file", path: configPath }
	}

	const defaultConfigPath = resolveConfigPath(DEFAULT_CONFIG_PATH)
	const defaultExists = await fileExists(defaultConfigPath)

	if (defaultExists) {
		const config = await loadConfigFromFilePath(defaultConfigPath)
		return { config, source: "file", path: defaultConfigPath }
	}

	const config = await loadAutoConfig(options)
	return { config, source: "auto" }
}

export async function loadConfig(options: CliOptions): Promise<IndexingConfig> {
	const resolved = await resolveConfig(options)
	return resolved.config
}

export function resolveConfigPath(inputPath?: string): string {
	const candidate = inputPath ?? process.env.CODEBASE_INDEX_CONFIG ?? DEFAULT_CONFIG_PATH
	if (!path.isAbsolute(candidate)) {
		return path.resolve(process.cwd(), candidate)
	}
	return candidate
}

export function serializeConfig(config: IndexingConfig): string {
	return JSON.stringify(config, null, 2)
}
