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
	collectionName: z.string().optional(),
	searchMinScore: z.number().min(0).max(1).optional(),
	searchMaxResults: z.number().int().positive().optional(),
})

const configSchema = z.object({
	workspacePath: z.string().min(1, "workspacePath is required"),
	embedder: embedderSchema,
	qdrant: qdrantSchema,
	cachePath: z.string().optional(),
	batchSize: z.number().int().positive().optional(),
	fileGlobs: z.array(z.string()).optional(),
	maxFileSizeBytes: z.number().int().positive().optional(),
	watch: z
		.object({
			debounceMs: z.number().int().positive().optional(),
			enabled: z.boolean().optional(),
		})
		.optional(),
})

export const DEFAULT_CONFIG_PATH = "roo-index.config.json"
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
		pickEnv("ROO_WORKSPACE_PATH", "WORKSPACE_PATH", "INDEXER_WORKSPACE_PATH") ??
		process.cwd()
	return path.resolve(candidate)
}

function resolveEmbedderProvider(): EmbedderProvider {
	const explicit = pickEnv("ROO_EMBED_PROVIDER", "EMBED_PROVIDER", "IDX_EMBED_PROVIDER")
	if (explicit) {
		const normalized = explicit.toLowerCase()
		if (normalized === "openai" || normalized === "openai-compatible" || normalized === "ollama") {
			return normalized
		}
		throw new Error(
			`Unsupported embedder provider "${explicit}". Expected one of: openai, openai-compatible, ollama`,
		)
	}

	if (pickEnv("OPENAI_API_KEY", "ROO_OPENAI_API_KEY")) {
		return "openai"
	}
	if (pickEnv("EMBED_BASE_URL", "OPENAI_BASE_URL") && pickEnv("EMBED_API_KEY", "ROO_EMBED_API_KEY")) {
		return "openai-compatible"
	}
	if (pickEnv("OLLAMA_MODEL")) {
		return "ollama"
	}

	throw new Error(
		"Unable to infer embedder provider. Set OPENAI_API_KEY, or EMBED_BASE_URL + EMBED_API_KEY, or OLLAMA_MODEL.",
	)
}

function buildEmbedderConfig(): EmbedderConfig {
	const provider = resolveEmbedderProvider()

	if (provider === "openai") {
		const apiKey =
			pickEnv("OPENAI_API_KEY", "ROO_OPENAI_API_KEY") ??
			pickEnv("EMBED_API_KEY", "IDX_EMBED_API_KEY")
		if (!apiKey) {
			throw new Error("OPENAI_API_KEY is required for OpenAI provider")
		}
		const model = pickEnv("OPENAI_EMBED_MODEL", "EMBED_MODEL") ?? "text-embedding-3-small"
		const baseUrl = pickEnv("OPENAI_BASE_URL", "EMBED_BASE_URL")
		const dimension = parsePositiveInteger(pickEnv("OPENAI_EMBED_DIMENSION", "EMBED_DIMENSION"), "OPENAI_EMBED_DIMENSION")
		const maxBatch = parsePositiveInteger(pickEnv("OPENAI_MAX_BATCH", "EMBED_MAX_BATCH"), "OPENAI_MAX_BATCH")

		return {
			provider,
			model,
			apiKey,
			baseUrl,
			dimension,
			maxBatchSize: maxBatch,
		}
	}

	if (provider === "openai-compatible") {
		const baseUrl = pickEnv("EMBED_BASE_URL", "OPENAI_BASE_URL")
		if (!baseUrl) {
			throw new Error("EMBED_BASE_URL is required for openai-compatible provider")
		}
		const apiKey =
			pickEnv("EMBED_API_KEY", "ROO_EMBED_API_KEY") ??
			pickEnv("OPENAI_API_KEY", "ROO_OPENAI_API_KEY")
		if (!apiKey) {
			throw new Error("EMBED_API_KEY is required for openai-compatible provider")
		}
		const model =
			pickEnv("EMBED_MODEL", "OPENAI_EMBED_MODEL") ??
			pickEnv("OPENAI_MODEL")
		if (!model) {
			throw new Error("EMBED_MODEL (or OPENAI_EMBED_MODEL) is required for openai-compatible provider")
		}
		const dimension = parsePositiveInteger(pickEnv("EMBED_DIMENSION", "OPENAI_EMBED_DIMENSION"), "EMBED_DIMENSION")
		const maxBatch = parsePositiveInteger(pickEnv("EMBED_MAX_BATCH", "OPENAI_MAX_BATCH"), "EMBED_MAX_BATCH")

		return {
			provider,
			model,
			apiKey,
			baseUrl,
			dimension,
			maxBatchSize: maxBatch,
		}
	}

	// ollama
	const model = pickEnv("OLLAMA_MODEL")
	if (!model) {
		throw new Error("OLLAMA_MODEL is required for ollama provider")
	}
	const baseUrl = pickEnv("OLLAMA_BASE_URL", "EMBED_BASE_URL")
	const dimension =
		parsePositiveInteger(pickEnv("OLLAMA_EMBED_DIMENSION", "EMBED_DIMENSION"), "OLLAMA_EMBED_DIMENSION") ??
		parsePositiveInteger(pickEnv("EMBED_DIMENSION"), "EMBED_DIMENSION")

	if (!dimension) {
		throw new Error("OLLAMA_EMBED_DIMENSION (or EMBED_DIMENSION) is required for ollama provider")
	}

	const maxBatch = parsePositiveInteger(pickEnv("EMBED_MAX_BATCH"), "EMBED_MAX_BATCH")

	return {
		provider,
		model,
		baseUrl,
		dimension,
		maxBatchSize: maxBatch,
	}
}

function buildQdrantConfig(defaultCollectionName: string): QdrantConfig {
	const url = pickEnv("QDRANT_URL", "ROO_QDRANT_URL", "IDX_QDRANT_URL") ?? "http://localhost:6333"
	const apiKey = pickEnv("QDRANT_API_KEY", "ROO_QDRANT_API_KEY", "IDX_QDRANT_API_KEY")
	const collection =
		pickEnv("QDRANT_COLLECTION", "QDRANT_COLLECTION_NAME", "ROO_QDRANT_COLLECTION") ??
		defaultCollectionName
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
		collectionName: collection,
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

	const embedder = buildEmbedderConfig()
	const qdrant = buildQdrantConfig(workspaceState.qdrantCollection)
	if (qdrant.collectionName && qdrant.collectionName !== workspaceState.qdrantCollection) {
		await saveWorkspaceState(workspacePath, {
			...workspaceState,
			qdrantCollection: qdrant.collectionName,
		})
	}

	const cachePath = resolveOptionalPath(
		pickEnv("INDEXER_CACHE_PATH", "ROO_CACHE_PATH"),
		workspacePath,
	) ?? path.join(workspacePath, ".codebase", "cache.json")
	const batchSize = parsePositiveInteger(
		pickEnv("INDEXER_BATCH_SIZE", "ROO_INDEX_BATCH_SIZE"),
		"INDEXER_BATCH_SIZE",
	)
	const fileGlobs = parseStringList(
		pickEnv("INDEXER_FILE_GLOBS", "ROO_INDEX_FILE_GLOBS"),
	)
	const maxFileSizeBytes = parsePositiveInteger(
		pickEnv("INDEXER_MAX_FILE_SIZE_BYTES", "ROO_INDEX_MAX_FILE_SIZE"),
		"INDEXER_MAX_FILE_SIZE_BYTES",
	)
	const watchEnabledValue = pickEnv("INDEXER_WATCH_ENABLED", "ROO_WATCH_ENABLED", "WATCH_ENABLED")
	const watchEnabledEnv = parseBoolean(watchEnabledValue, "INDEXER_WATCH_ENABLED")
	const watchDebounce = parsePositiveInteger(
		pickEnv("INDEXER_WATCH_DEBOUNCE_MS", "ROO_WATCH_DEBOUNCE_MS"),
		"INDEXER_WATCH_DEBOUNCE_MS",
	)

	const config: IndexingConfig = {
		workspacePath,
		embedder,
		qdrant,
		cachePath,
		batchSize,
		fileGlobs,
		maxFileSizeBytes,
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
					if (normalized === "start" || normalized === "restart" || normalized === "stats") {
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

	const explicitInput = process.env.ROO_INDEX_CONFIG
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
	const candidate = inputPath ?? process.env.ROO_INDEX_CONFIG ?? DEFAULT_CONFIG_PATH
	if (!path.isAbsolute(candidate)) {
		return path.resolve(process.cwd(), candidate)
	}
	return candidate
}

export function serializeConfig(config: IndexingConfig): string {
	return JSON.stringify(config, null, 2)
}
