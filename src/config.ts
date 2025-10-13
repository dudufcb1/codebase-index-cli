import fs from "fs/promises"
import path from "path"
import { z } from "zod"

import type { CliOptions, IndexingConfig } from "./types.js"

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

export function parseCliArgs(argv: string[]): CliOptions {
	const options: CliOptions = {}

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i] ?? ""
		switch (arg) {
			case "--config":
			case "-c": {
				const next = argv[i + 1]
				if (!next) {
					throw new Error("--config requires a path argument")
				}
				options.configPath = next
				i++
				break
			}
			case "--print-config":
				options.printConfig = true
				break
			case "--once":
				options.once = true
				break
			default:
				if (arg.startsWith("-")) {
					throw new Error(`Unknown option: ${arg}`)
				}
		}
	}

	return options
}

export async function loadConfig(options: CliOptions): Promise<IndexingConfig> {
	const configPath = resolveConfigPath(options.configPath)
	const raw = await fs.readFile(configPath, "utf8")
	const parsed = JSON.parse(raw)
	const normalized = configSchema.parse(parsed)

	return {
		...normalized,
		workspacePath: path.resolve(normalized.workspacePath),
		cachePath: normalized.cachePath ? path.resolve(normalized.cachePath) : undefined,
	}
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
