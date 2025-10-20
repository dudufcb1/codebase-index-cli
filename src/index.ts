#!/usr/bin/env node

import fs from "fs/promises"
import path from "path"
import process from "process"
import lockfile from "proper-lockfile"

import { Logger, parseLogLevel, rootLogger, type LogLevel } from "./logger.js"
import { parseCliArgs, resolveConfig } from "./config.js"
import { WorkspaceIndexer } from "./indexer.js"
import { getGlobalEnvDirectories, loadEnvFiles } from "./env.js"
import { QdrantClient } from "@qdrant/js-client-rest"
import { ensureWorkspaceState, type WorkspaceState } from "./workspaceState.js"
import { createEmbedder } from "./embedder/index.js"
import type { CliOptions } from "./types.js"

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

interface SemanticSearchPayload {
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
	segmentHash?: string
}

interface SemanticSearchResult {
	id: string
	score: number
	payload: SemanticSearchPayload
	rerankScore?: number
}

type ResultWithMeta = SemanticSearchResult & { originalIndex: number }

function isSemanticSearchPayload(payload: unknown): payload is SemanticSearchPayload {
	if (!payload || typeof payload !== "object") {
		return false
	}

	const candidate = payload as Record<string, unknown>
	return (
		typeof candidate.filePath === "string" &&
		typeof candidate.codeChunk === "string" &&
		typeof candidate.startLine === "number" &&
		typeof candidate.endLine === "number"
	)
}

function formatCodeSnippet(code: string, maxLines = 20): string[] {
	const lines = code.split("\n")
	if (lines.length <= maxLines) {
		return lines
	}

	const visible = Math.max(1, maxLines - 1)
	return [...lines.slice(0, visible), "..."]
}

function printSemanticSearchResults(
	results: SemanticSearchResult[],
	query: string,
	collectionName: string,
	usedRerank: boolean,
	rerankModel?: string,
): void {
	const divider = "=".repeat(60)
	const lines: string[] = []

	lines.push(divider)
	lines.push(`Semantic search query: ${query}`)
	lines.push(`Collection: ${collectionName}`)
	lines.push(`Results returned: ${results.length}`)
	if (usedRerank) {
		lines.push(`Reranker: ${rerankModel ?? "unknown"} (Voyage AI)`)
	}
	lines.push(divider)

	if (results.length === 0) {
		lines.push("No results to display.")
	} else {
		results.forEach((result, index) => {
			lines.push(`${index + 1}. ${result.payload.filePath}:${result.payload.startLine}-${result.payload.endLine}`)

			const scoreParts = [`vectorScore=${result.score.toFixed(4)}`]
			if (typeof result.rerankScore === "number") {
				scoreParts.push(`rerankScore=${result.rerankScore.toFixed(4)}`)
			}
			if (result.payload.segmentHash) {
				scoreParts.push(`segment=${result.payload.segmentHash}`)
			}
			lines.push(`   ${scoreParts.join(" | ")}`)

			for (const line of formatCodeSnippet(result.payload.codeChunk)) {
				lines.push(`   ${line}`)
			}

			lines.push("")
		})
	}

	rootLogger.info(lines.join("\n"))
}

async function runSemanticSearchCommand(options: CliOptions, workspacePath: string): Promise<void> {
	const query = options.searchQuery?.trim()
	if (!query) {
		rootLogger.error("semantic-search requires a non-empty query string")
		process.exit(1)
	}

	let resolvedConfig: Awaited<ReturnType<typeof resolveConfig>>
	try {
		resolvedConfig = await resolveConfig(options)
	} catch (error) {
		rootLogger.error("Failed to load configuration for semantic-search", error)
		process.exit(1)
	}

	const config = resolvedConfig.config
	if (config.vectorStore !== "qdrant") {
		rootLogger.error(
			"semantic-search requires the Qdrant vector store. Use the 'codebase' command or set VECTOR_STORE=qdrant.",
		)
		process.exit(1)
	}

	if (!config.qdrant) {
		rootLogger.error("Qdrant configuration is missing; cannot perform semantic search.")
		process.exit(1)
	}

	let workspaceState: WorkspaceState
	try {
		workspaceState = await ensureWorkspaceState(workspacePath)
	} catch (error) {
		rootLogger.error(`Failed to load workspace state from ${workspacePath}`, error)
		process.exit(1)
	}

	const collectionName = options.searchCollection ?? workspaceState.qdrantCollection

	const previousLogLevel = Logger.getGlobalLevel()
	const suppressEmbedderLogs = previousLogLevel === "info" || previousLogLevel === "debug"

	let queryVector: number[] | undefined
	let embedderError: unknown
	try {
		if (suppressEmbedderLogs) {
			Logger.setGlobalLevel("warn")
		}

		const embedder = createEmbedder(config.embedder)
		await embedder.validateConfiguration()
		const { embeddings } = await embedder.createEmbeddings([query])
		queryVector = embeddings?.[0]
	} catch (error) {
		embedderError = error
	} finally {
		if (suppressEmbedderLogs) {
			Logger.setGlobalLevel(previousLogLevel)
		}
	}

	if (embedderError) {
		rootLogger.error("Failed to prepare embeddings for semantic search", embedderError)
		process.exit(1)
	}

	if (!Array.isArray(queryVector)) {
		rootLogger.error("Embedding provider returned no vector for the query.")
		process.exit(1)
	}

	const requestedLimit = options.searchLimit ?? config.qdrant.searchMaxResults ?? 10
	const limit = Math.max(1, Math.trunc(requestedLimit))
	const minScore = config.qdrant.searchMinScore

	const client = new QdrantClient({
		url: config.qdrant.url,
		apiKey: config.qdrant.apiKey,
	})

	let points: any[]
	try {
		const response = await client.query(collectionName, {
			query: queryVector,
			limit,
			score_threshold: typeof minScore === "number" ? minScore : undefined,
			with_payload: {
				include: ["filePath", "codeChunk", "startLine", "endLine", "segmentHash"],
			},
		})
		points = Array.isArray(response?.points) ? response.points : []
	} catch (error) {
		rootLogger.error(`Failed to query Qdrant collection ${collectionName}`, error)
		process.exit(1)
	}

	const baseResults: ResultWithMeta[] = points.reduce<ResultWithMeta[]>((acc, point, index) => {
		const payload = point?.payload
		if (!isSemanticSearchPayload(payload)) {
			return acc
		}

		const idValue = point?.id
		const id = typeof idValue === "string" ? idValue : String(idValue ?? index)
		const score = typeof point?.score === "number" ? point.score : 0

		acc.push({
			id,
			score,
			payload: {
				filePath: payload.filePath,
				codeChunk: payload.codeChunk,
				startLine: payload.startLine,
				endLine: payload.endLine,
				segmentHash: payload.segmentHash,
			},
			originalIndex: index,
		})
		return acc
	}, [])

	if (baseResults.length === 0) {
		rootLogger.info(`No semantic matches found in collection ${collectionName} for query "${query}".`)
		return
	}

	let orderedResultsWithMeta: ResultWithMeta[] = baseResults
	let usedRerank = false
	let rerankModelUsed: string | undefined

	const shouldAttemptRerank = options.searchRerank !== false
	const rerankApiKey =
		process.env.VOYAGE_RERANK_API_KEY ??
		process.env.VOYAGEAI_API_KEY

	if (shouldAttemptRerank) {
		if (!rerankApiKey) {
			rootLogger.warn("VOYAGE_RERANK_API_KEY (o VOYAGEAI_API_KEY) no está definido; se omite el rerank.")
		} else {
			try {
				const { VoyageAIClient } = await import("voyageai")
				const rerankModel =
					process.env.VOYAGE_RERANK_MODEL ??
					process.env.VOYAGEAI_RERANK_MODEL ??
					"rerank-lite-1"
				const baseUrl =
					process.env.VOYAGE_RERANK_BASE_URL ??
					process.env.VOYAGEAI_BASE_URL
				const voyageClient = new VoyageAIClient({
					apiKey: rerankApiKey,
					...(baseUrl ? { environment: baseUrl } : {}),
				})
				const rerankResponse = await voyageClient.rerank({
					query,
					documents: baseResults.map((result) => `${result.payload.filePath}\n${result.payload.codeChunk}`),
					model: rerankModel,
					topK: Math.min(limit, baseResults.length),
				})

				const data = Array.isArray(rerankResponse?.data) ? rerankResponse.data : []
				const seen = new Set<number>()
				const reranked: ResultWithMeta[] = []

				for (const item of data) {
					const idx = typeof item?.index === "number" ? item.index : undefined
					if (idx === undefined || seen.has(idx)) {
						continue
					}
					const base = baseResults[idx]
					if (base) {
						reranked.push({
							...base,
							rerankScore: typeof item?.relevanceScore === "number" ? item.relevanceScore : undefined,
						})
						seen.add(idx)
					}
				}

				for (const base of baseResults) {
					if (!seen.has(base.originalIndex)) {
						reranked.push(base)
					}
				}

				if (reranked.length > 0) {
					orderedResultsWithMeta = reranked
					usedRerank = true
					rerankModelUsed = rerankModel
				}
			} catch (error) {
				rootLogger.warn(
					`Reranker failed (${(error as Error)?.message ?? error}). Returning vector search ordering.`,
				)
			}
		}
	}

	const orderedResults: SemanticSearchResult[] = orderedResultsWithMeta.map(({ originalIndex, ...rest }) => rest)

	printSemanticSearchResults(orderedResults, query, collectionName, usedRerank, rerankModelUsed)
}

async function printWorkspaceStats(workspacePath: string): Promise<void> {
	const codebaseDir = path.join(workspacePath, ".codebase")
	const legacyStatePath = path.join(workspacePath, ".roo-index-cli", "state.json")
	const legacyCachePath = path.join(workspacePath, ".roo-code", "index-cache.json")
	const statePath = path.join(codebaseDir, "state.json")
	const cachePath = path.join(codebaseDir, "cache.json")

	const state =
		(await readJsonFile<WorkspaceState>(statePath)) ??
		(await readJsonFile<WorkspaceState>(legacyStatePath))
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
		const indexedCommits =
			typeof state.commitStats?.totalIndexed === "number"
				? state.commitStats.totalIndexed
				: 0
		rootLogger.info(`Collection: ${collection}`)
		rootLogger.info(`Created: ${createdAt}`)
		rootLogger.info(`Last updated: ${updatedAt}`)
		rootLogger.info(`Indexed commits: ${indexedCommits}`)
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

async function indexHistoricalCommits(workspacePath: string, count: number): Promise<void> {
	rootLogger.info(`📚 Indexing last ${count} commits (excluding the most recent one)...`)
	rootLogger.info(`Workspace: ${workspacePath}`)

	// Import necessary modules
	const { GitCommitExtractor } = await import("./indexing/gitCommitExtractor.js")
	const { CommitLlmService } = await import("./indexing/commitLlmService.js")
	const { CommitPromptFormatter } = await import("./indexing/commitPromptFormatter.js")
	const { createEmbedder } = await import("./embedder/index.js")
	const { QdrantVectorStore } = await import("./vectorStore/qdrantVectorStore.js")
	const { loadConfig } = await import("./config.js")
	const { ensureWorkspaceState } = await import("./workspaceState.js")

	// Import GitCommitData type
	type GitCommitData = import("./indexing/gitCommitExtractor.js").GitCommitData

	// Load config to get embedder and vector store settings
	const config = await loadConfig({ command: "start", workspacePath, logLevel: undefined })

	// Check if using Qdrant (required for git tracking)
	if (config.vectorStore !== "qdrant") {
		rootLogger.error("❌ Historical commit indexing only works with Qdrant vector store.")
		rootLogger.error("   Set VECTOR_STORE=qdrant or use the 'codebase' command.")
		process.exit(1)
	}

	// Check if LLM is configured
	const hasLlmConfig =
		process.env.TRACK_GIT_LLM_PROVIDER &&
		process.env.TRACK_GIT_LLM_ENDPOINT &&
		process.env.TRACK_GIT_LLM_MODEL &&
		process.env.TRACK_GIT_LLM_API_KEY

	if (!hasLlmConfig) {
		rootLogger.error("❌ LLM configuration is required for commit indexing.")
		rootLogger.error("   Required env vars: TRACK_GIT_LLM_PROVIDER, TRACK_GIT_LLM_ENDPOINT, TRACK_GIT_LLM_MODEL, TRACK_GIT_LLM_API_KEY")
		process.exit(1)
	}

	// Initialize components
	const embedder = createEmbedder(config.embedder)
	const dimension = embedder.dimension()

	// Create Qdrant vector store
	if (!config.qdrant) {
		rootLogger.error("❌ Qdrant configuration is required.")
		process.exit(1)
	}
	const workspaceState = await ensureWorkspaceState(workspacePath)
	const vectorStore = new QdrantVectorStore(
		workspacePath,
		config.qdrant.url,
		dimension,
		config.qdrant.apiKey,
		workspaceState.qdrantCollection,
	)

	// Initialize the vector store (creates collection if needed)
	rootLogger.info("Initializing Qdrant collection...")
	await vectorStore.initialize()
	rootLogger.info(`Using Qdrant collection: ${workspaceState.qdrantCollection}`)

	const extractor = new GitCommitExtractor(workspacePath)
	const commitLlmService = new CommitLlmService(workspacePath, embedder, vectorStore)
	const formatter = new CommitPromptFormatter(workspacePath)
	await formatter.initialize()

	// Get current branch
	const currentBranch = await extractor.getCurrentBranch()
	rootLogger.info(`Branch: ${currentBranch}`)

	// Get historical commits (excluding most recent)
	rootLogger.info("🔍 Fetching commit history...")
	const commitHashes = await extractor.getHistoricalCommits(count, currentBranch)

	if (commitHashes.length === 0) {
		rootLogger.warn("⚠️  No historical commits found (besides the most recent one).")
		rootLogger.info("   This might mean your repository has only 1 commit.")
		return
	}

	rootLogger.info(`📋 Found ${commitHashes.length} commits to process`)
	rootLogger.info("")

	// Prepare commits for batch processing
	rootLogger.info("🔧 Preparing commits for batch processing...")
	const commitsToProcess: Array<{ commitData: GitCommitData; promptText: string }> = []
	let extractionErrors = 0

	for (let i = 0; i < commitHashes.length; i++) {
		const hash = commitHashes[i]
		const shortHash = hash.slice(0, 7)

		try {
			const commitData = await extractor.extractCommitData(hash, currentBranch)

			if (!commitData) {
				rootLogger.warn(`  ⚠️  Failed to extract data for ${shortHash}`)
				extractionErrors++
				continue
			}

			const promptText = await formatter.formatPrompt(commitData)
			commitsToProcess.push({ commitData, promptText })
		} catch (error) {
			rootLogger.error(`  ❌ Error extracting ${shortHash}`, error)
			extractionErrors++
		}
	}

	if (commitsToProcess.length === 0) {
		rootLogger.error("❌ No commits could be extracted. Aborting.")
		return
	}

	rootLogger.info(`✅ Extracted ${commitsToProcess.length} commits (${extractionErrors} extraction errors)`)
	rootLogger.info("")

	// Batch process commits
	const results = await commitLlmService.batchIndexCommits(commitsToProcess)

	// Calculate stats
	const indexed = results.filter(r => r.indexed).length
	const errors = results.filter(r => !r.indexed).length

	rootLogger.info("")
	rootLogger.info("=" .repeat(60))
	rootLogger.info("📊 Summary:")
	rootLogger.info(`   Total commits processed: ${commitHashes.length}`)
	rootLogger.info(`   ✅ Successfully indexed: ${indexed}`)
	rootLogger.info(`   ❌ Errors: ${errors}`)
	rootLogger.info("=" .repeat(60))
	rootLogger.info("")
	rootLogger.info("Note: If some commits were already indexed, they were updated (upsert).")

	if (indexed > 0) {
		rootLogger.info("")
		rootLogger.info("🎉 Historical commits indexed successfully!")
		rootLogger.info(`   You can now search them using the semantic search client.`)
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath)
		return true
	} catch (error: any) {
		if (error?.code === "ENOENT") {
			return false
		}

		rootLogger.warn(`Failed to access ${targetPath}`, error)
		return true
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error: any) {
		if (error?.code === "EPERM") {
			return true
		}
		return false
	}
}

async function removePidFile(pidFilePath: string): Promise<void> {
	try {
		await fs.unlink(pidFilePath)
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			rootLogger.warn(`Failed to remove PID file at ${pidFilePath}`, error)
		}
	}
}

async function cleanupWatcherArtifacts(pidFilePath: string, lockfilePath: string): Promise<void> {
	await removePidFile(pidFilePath)
	try {
		await fs.rm(lockfilePath, { recursive: true, force: true })
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			rootLogger.warn(`Failed to remove watcher lock at ${lockfilePath}`, error)
		}
	}
}

async function stopWatcher(workspacePath: string): Promise<void> {
	const codebaseDir = path.join(workspacePath, ".codebase")
	const lockfilePath = path.join(codebaseDir, "watcher.lock")
	const pidFilePath = path.join(codebaseDir, "watcher.pid")

	let pid: number | null = null
	try {
		const rawPid = await fs.readFile(pidFilePath, "utf8")
		const trimmed = rawPid.trim()
		if (trimmed.length > 0) {
			const parsed = Number.parseInt(trimmed, 10)
			if (Number.isFinite(parsed) && parsed > 0) {
				pid = parsed
			} else {
				rootLogger.warn(`Invalid PID "${trimmed}" found in ${pidFilePath}`)
			}
		}
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			rootLogger.error(`Failed to read watcher PID file at ${pidFilePath}`, error)
			process.exit(1)
		}
	}

	let lockActive = false
	try {
		lockActive = await lockfile.check(codebaseDir, { lockfilePath })
	} catch (error: any) {
		if (error?.code === "ENOENT") {
			lockActive = false
		} else {
			rootLogger.error(`Failed to inspect watcher lock at ${lockfilePath}`, error)
			process.exit(1)
		}
	}

	if (!pid) {
		if (lockActive) {
			rootLogger.warn(
				`Watcher lock exists at ${lockfilePath}, but PID file is missing. Remove the lock manually if the watcher is stuck.`,
			)
		} else {
			rootLogger.info("No running watcher found for this workspace.")
		}
		return
	}

	if (!isProcessAlive(pid)) {
		rootLogger.warn(`Watcher process ${pid} is not running. Cleaning up stale lock data.`)
		await cleanupWatcherArtifacts(pidFilePath, lockfilePath)
		rootLogger.info("Stale watcher metadata removed.")
		return
	}

	try {
		process.kill(pid, "SIGINT")
	} catch (error: any) {
		if (error?.code === "EPERM") {
			rootLogger.error(`Permission denied when signalling process ${pid}. Try running with elevated privileges.`)
		} else {
			rootLogger.error(`Failed to signal watcher process ${pid}`, error)
		}
		process.exit(1)
	}

	rootLogger.info(`Sent SIGINT to watcher process ${pid}. Waiting for it to shut down...`)

	const timeoutMs = 10000
	const intervalMs = 250
	const start = Date.now()

	while (Date.now() - start < timeoutMs) {
		await sleep(intervalMs)

		const alive = isProcessAlive(pid)
		const pidFileStillExists = await pathExists(pidFilePath)
		const lockStillExists = await pathExists(lockfilePath)

		if (!alive && !pidFileStillExists && !lockStillExists) {
			rootLogger.info("Watcher stopped successfully.")
			return
		}
	}

	rootLogger.warn(
		`Watcher process ${pid} may still be shutting down. If it remains running, stop it manually (kill ${pid}).`,
	)
}

async function main() {
	let releaseLock: (() => Promise<void>) | null = null
	let pidFilePath: string | null = null
	let pidFileWritten = false

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

		if (options.command === "stop") {
			await stopWatcher(workspacePath)
			return
		}

		if (options.command === "stats") {
			await printWorkspaceStats(workspacePath)
			return
		}

		if (options.command === "full-reset") {
			await fullReset(workspacePath)
			return
		}

		if (options.command === "index-history") {
			await indexHistoricalCommits(workspacePath, options.historyCount!)
			return
		}

		if (options.command === "semantic-search") {
			await runSemanticSearchCommand(options, workspacePath)
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

		// Acquire lock to prevent duplicate instances
		// proper-lockfile locks directories, so we lock the .codebase directory
		const codebaseDir = path.join(config.workspacePath, ".codebase")
		pidFilePath = path.join(codebaseDir, "watcher.pid")

		if (!pidFilePath) {
			throw new Error("Watcher PID path could not be resolved")
		}

		try {
			releaseLock = await lockfile.lock(codebaseDir, {
				lockfilePath: path.join(codebaseDir, "watcher.lock"),
				stale: 10000, // Auto-release if process dies (10 seconds)
				retries: 0,   // Fail immediately if locked
			})
			rootLogger.debug(`Lock acquired on ${codebaseDir}`)

			const currentPidFilePath = pidFilePath

			try {
				await fs.writeFile(currentPidFilePath, `${process.pid}\n`, "utf8")
				pidFileWritten = true
				rootLogger.debug(`Recorded watcher PID ${process.pid} at ${currentPidFilePath}`)
			} catch (error) {
				if (releaseLock) {
					try {
						await releaseLock()
					} catch (releaseError) {
						rootLogger.warn("Failed to release lock after PID file write failure:", releaseError)
					}
				}
				rootLogger.error(`Failed to write watcher PID file at ${pidFilePath}`, error)
				process.exit(1)
			}
		} catch (err: any) {
			console.error("\n❌ Cannot start watcher\n")
			console.error("Another instance is already running in this workspace.")
			console.error(`Workspace: ${config.workspacePath}`)

			// Try to get lock info to show PID and timestamp
			const lockFilePath = path.join(codebaseDir, "watcher.lock")
			try {
				const lockInfo = await lockfile.check(codebaseDir, {
					lockfilePath: lockFilePath,
				})
				if (lockInfo && typeof lockInfo === "object") {
					const info = lockInfo as { pid?: number; mtime?: number }
					if (info.pid) {
						console.error(`Process ID: ${info.pid}`)
					}
					if (info.mtime) {
						const startTime = new Date(info.mtime).toLocaleString()
						console.error(`Started at: ${startTime}`)
					}
					if (info.pid) {
						console.error(`\nTo stop it, run: kill ${info.pid}`)
					}
				}
			} catch {
				// If we can't read lock info, just show generic message
			}

			console.error(`Or remove lock file: rm ${lockFilePath}\n`)
			process.exit(1)
		}

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
			if (pidFilePath) {
				await removePidFile(pidFilePath)
			}
			pidFileWritten = false

			// Release lock file
			if (releaseLock) {
				try {
					await releaseLock()
					rootLogger.debug("Lock released")
				} catch (err) {
					rootLogger.warn("Failed to release lock:", err)
				}
			}

			process.exit(0)
		}

		process.on("SIGINT", shutdown)
		process.on("SIGTERM", shutdown)

		await new Promise<void>(() => {
			// Intentionally never resolve; shutdown() handles process exit.
		})
	} catch (error) {
		if (pidFileWritten && pidFilePath) {
			await removePidFile(pidFilePath)
		}
		pidFileWritten = false

		if (releaseLock) {
			try {
				await releaseLock()
			} catch (releaseError) {
				rootLogger.warn("Failed to release lock during error handling:", releaseError)
			}
		}

		rootLogger.error("Indexer failed", error)
		process.exit(1)
	}
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main()
