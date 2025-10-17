#!/usr/bin/env node

import fs from "fs/promises"
import path from "path"
import process from "process"

import { Logger, parseLogLevel, rootLogger, type LogLevel } from "./logger.js"
import { parseCliArgs, resolveConfig } from "./config.js"
import { WorkspaceIndexer } from "./indexer.js"
import { getGlobalEnvDirectories, loadEnvFiles } from "./env.js"
import { QdrantClient } from "@qdrant/js-client-rest"

function determineLogLevel(explicit?: LogLevel): LogLevel | undefined {
	if (explicit) {
		return explicit
	}

	const value = process.env.LOG_LEVEL ?? process.env.LOG_LEVEL
	if (!value) {
		return undefined
	}

	try {
		return parseLogLevel(value)
	} catch {
		rootLogger.warn(`Ignoring invalid log level "${value}" from environment`)
		return undefined
	}
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8")
		return JSON.parse(raw) as T
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			rootLogger.warn(`Failed to read ${filePath}:`, error)
		}
		return null
	}
}

async function printWorkspaceStats(workspacePath: string): Promise<void> {
	const codebaseDir = path.join(workspacePath, ".codebase")
	const legacyStatePath = path.join(workspacePath, ".roo-index-cli", "state.json")
	const legacyCachePath = path.join(workspacePath, ".roo-code", "index-cache.json")
	const statePath = path.join(codebaseDir, "state.json")
	const cachePath = path.join(codebaseDir, "cache.json")

	const state =
		(await readJsonFile<{ qdrantCollection?: string; createdAt?: string; updatedAt?: string }>(statePath)) ??
		(await readJsonFile<{ qdrantCollection?: string; createdAt?: string; updatedAt?: string }>(legacyStatePath))
	const cache =
		(await readJsonFile<Record<string, string>>(cachePath)) ??
		(await readJsonFile<Record<string, string>>(legacyCachePath)) ??
		{}

	rootLogger.info(`Workspace: ${workspacePath}`)

	if (!state) {
		rootLogger.info("No local state file found.")
	} else {
		const collection = state.qdrantCollection ?? "unknown"
		const createdAt = state.createdAt ?? "unknown"
		const updatedAt = state.updatedAt ?? "unknown"
		rootLogger.info(`Collection: ${collection}`)
		rootLogger.info(`Created: ${createdAt}`)
		rootLogger.info(`Last updated: ${updatedAt}`)
	}

	const trackedFiles = Object.keys(cache).length
	rootLogger.info(`Tracked files: ${trackedFiles}`)
	if (trackedFiles > 0) {
		rootLogger.info(`Cache file: ${cachePath}`)
	} else {
		rootLogger.info("Cache file empty or missing; run -start to build index.")
	}
}

async function fullReset(workspacePath: string): Promise<void> {
	rootLogger.info(`🔥 Full reset for workspace: ${workspacePath}`)

	const codebaseDir = path.join(workspacePath, ".codebase")
	const legacyRooIndexDir = path.join(workspacePath, ".roo-index-cli")
	const legacyRooCodeDir = path.join(workspacePath, ".roo-code")
	const statePath = path.join(codebaseDir, "state.json")
	const legacyStatePath = path.join(workspacePath, ".roo-index-cli", "state.json")

	// Try to delete Qdrant collection if it exists
	try {
		const state =
			(await readJsonFile<{ qdrantCollection?: string }>(statePath)) ??
			(await readJsonFile<{ qdrantCollection?: string }>(legacyStatePath))

		if (state?.qdrantCollection) {
			const qdrantUrl = process.env.QDRANT_URL ?? "http://localhost:6333"
			const qdrantApiKey = process.env.QDRANT_API_KEY

			try {
				const client = new QdrantClient({
					url: qdrantUrl,
					apiKey: qdrantApiKey,
				})

				await client.deleteCollection(state.qdrantCollection)
				rootLogger.info(`✓ Deleted Qdrant collection: ${state.qdrantCollection}`)
			} catch (error: any) {
				if (error?.status === 404) {
					rootLogger.info(`Collection ${state.qdrantCollection} not found in Qdrant (already deleted)`)
				} else {
					rootLogger.warn(`Failed to delete Qdrant collection ${state.qdrantCollection}:`, error.message)
				}
			}
		}
	} catch (error) {
		// Ignore errors reading state file
	}

	// Remove .codebase directory (SQLite DB, cache, state)
	try {
		await fs.rm(codebaseDir, { recursive: true, force: true })
		rootLogger.info(`✓ Removed ${codebaseDir}`)
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			rootLogger.warn(`Failed to remove ${codebaseDir}:`, error)
		}
	}

	// Remove legacy directories
	for (const dir of [legacyRooIndexDir, legacyRooCodeDir]) {
		try {
			await fs.rm(dir, { recursive: true, force: true })
			rootLogger.info(`✓ Removed ${dir}`)
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				rootLogger.warn(`Failed to remove ${dir}:`, error)
			}
		}
	}

	rootLogger.info("✅ Full reset complete!")
	rootLogger.info("Run 'codebase -start .' or 'codesql -start .' to rebuild the index from scratch.")
}

async function main() {
	try {
		const options = parseCliArgs(process.argv)

		const loadedEnvPaths = new Set<string>()
		const globalEnvDirs = getGlobalEnvDirectories()
		const workspacePath = path.resolve(process.cwd(), options.workspacePath)

		const envLoads = await loadEnvFiles(globalEnvDirs, loadedEnvPaths)

		const effectiveLogLevel = determineLogLevel(options.logLevel)
		if (effectiveLogLevel) {
			Logger.setGlobalLevel(effectiveLogLevel)
		}

		if (envLoads.length > 0) {
			rootLogger.debug(`Environment files loaded: ${envLoads.join(", ")}`)
		}

		if (options.command === "stats") {
			await printWorkspaceStats(workspacePath)
			return
		}

		if (options.command === "full-reset") {
			await fullReset(workspacePath)
			return
		}

		const resolved = await resolveConfig(options)
		const config = resolved.config
		const source = resolved.source
		const configPath = resolved.path

		if (source === "file") {
			rootLogger.info(
				`Loaded configuration from ${configPath ?? "unknown path"}; workspace: ${config.workspacePath}`,
			)
		} else {
			rootLogger.info(`Auto-configured workspace at ${config.workspacePath}`)
			const vectorStoreInfo = config.vectorStore === "sqlite"
				? "SQLite-vec (local)"
				: "Qdrant (collection from workspace state)"
			rootLogger.info(
				`Embedder ${config.embedder.provider} (${config.embedder.model}) | Vector store: ${vectorStoreInfo}`,
			)
		}

		const debounce = config.watch?.debounceMs ?? 500
		rootLogger.info(`Watching for changes (debounce ${debounce}ms)`)

		const indexer = new WorkspaceIndexer(config)
		await indexer.initialize()

		if (options.command === "restart") {
			rootLogger.info("Restart requested: rebuilding local cache and collection metadata before scanning.")
			await indexer.forceRebuild()
		}

		await indexer.runInitialScan()
		await indexer.startWatcher()

		const keepAlive = setInterval(() => {}, 2 ** 31 - 1)

		rootLogger.info("Watcher running. Press Ctrl+C to exit.")

		const shutdown = async () => {
			rootLogger.info("Received shutdown signal. Cleaning up...")
			clearInterval(keepAlive)
			await indexer.shutdown()
			process.exit(0)
		}

		process.on("SIGINT", shutdown)
		process.on("SIGTERM", shutdown)

		await new Promise<void>(() => {
			// Intentionally never resolve; shutdown() handles process exit.
		})
	} catch (error) {
		rootLogger.error("Indexer failed", error)
		process.exit(1)
	}
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main()
