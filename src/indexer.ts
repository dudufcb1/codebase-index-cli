import path from "path"

import { createEmbedder } from "./embedder/index.js"
import type { Embedder } from "./embedder/index.js"
import { Logger, rootLogger } from "./logger.js"
import type { IndexingConfig } from "./types.js"
import { QdrantVectorStore } from "./vectorStore/qdrantVectorStore.js"
import { SqliteVecClient } from "./vectorStore/sqliteVecClient.js"
import type { VectorStore } from "./vectorStore/interface.js"
import { updateIndexingStatus, updateLastActivity, ensureWorkspaceState } from "./workspaceState.js"

import { CacheManager } from "./indexing/cacheManager.js"
import { DirectoryScanner } from "./indexing/directoryScanner.js"
import { IgnoreManager } from "./indexing/ignoreManager.js"
import { WorkspaceWatcher } from "./indexing/workspaceWatcher.js"
import { GitCommitWatcher, type GitCommitInfo } from "./indexing/gitCommitWatcher.js"
import { CommitPromptFormatter } from "./indexing/commitPromptFormatter.js"
import { CommitLlmService } from "./indexing/commitLlmService.js"

export class WorkspaceIndexer {
	private readonly logger = new Logger("indexer")
	private workspacePath!: string
	private embedder!: Embedder
	private vectorStore!: VectorStore
	private cacheManager!: CacheManager
	private ignoreManager!: IgnoreManager
	private directoryScanner!: DirectoryScanner
	private watcher: WorkspaceWatcher | null = null
	private gitWatcher: GitCommitWatcher | null = null
	private commitLlmService: CommitLlmService | null = null

	constructor(private readonly config: IndexingConfig) {
}

	async initialize(): Promise<void> {
		this.workspacePath = path.resolve(this.config.workspacePath)

		await updateIndexingStatus(this.workspacePath, {
			state: 'initializing',
			startedAt: new Date().toISOString(),
		})

		this.embedder = createEmbedder(this.config.embedder)
		await this.embedder.validateConfiguration()

		const dimension = this.embedder.dimension()

		const vectorStoreType = this.config.vectorStore ?? "sqlite"

		if (vectorStoreType === "sqlite") {
			this.logger.info("Using SQLite-vec for vector storage")
			this.vectorStore = new SqliteVecClient(
				this.workspacePath,
				dimension,
				this.config.sqlite?.dbPath,
			)
		} else {
			this.logger.info("Using Qdrant for vector storage")
			if (!this.config.qdrant) {
				throw new Error("Qdrant configuration is required when vectorStore is 'qdrant'")
			}
			const workspaceState = await ensureWorkspaceState(this.workspacePath)
			this.vectorStore = new QdrantVectorStore(
				this.workspacePath,
				this.config.qdrant.url,
				dimension,
				this.config.qdrant.apiKey,
				workspaceState.qdrantCollection,
			)
		}

		this.ignoreManager = new IgnoreManager(this.workspacePath)
		await this.ignoreManager.initialize()

		this.cacheManager = new CacheManager(this.workspacePath, this.config.cachePath)
		await this.cacheManager.initialize()

		this.directoryScanner = new DirectoryScanner(
			this.workspacePath,
			this.embedder,
			this.vectorStore,
			this.cacheManager,
			this.ignoreManager,
			this.config,
		)

		const initResult = await this.vectorStore.initialize()

		// If cleanup happened (cache.json was deleted because collection didn't exist),
		// we need to reinitialize the cache manager to ensure it starts empty
		if (initResult.didCleanup) {
			this.logger.info("Vector store performed cleanup. Reinitializing cache manager...")

			// Reinitialize cache manager to start with empty cache
			this.cacheManager = new CacheManager(this.workspacePath, this.config.cachePath)
			await this.cacheManager.initialize()

			// Recreate directory scanner with fresh cache
			this.directoryScanner = new DirectoryScanner(
				this.workspacePath,
				this.embedder,
				this.vectorStore,
				this.cacheManager,
				this.ignoreManager,
				this.config,
			)

			this.logger.info("Cache manager reinitialized successfully")
		}

		await updateLastActivity(this.workspacePath, {
			timestamp: new Date().toISOString(),
			action: 'initialized',
			vectorStore: vectorStoreType,
		})
	}

	async forceRebuild(): Promise<void> {
		this.logger.info("Clearing cached hashes and resetting vector collection...")
		await this.cacheManager.clear()
		await this.vectorStore.resetCollection()
	}

	async runInitialScan(): Promise<void> {
		const startTime = Date.now()
		await updateIndexingStatus(this.workspacePath, {
			state: 'scanning',
		})
		this.logger.info("Starting full workspace scan...")
		const stats = await this.directoryScanner.scan()
		const durationMinutes = ((Date.now() - startTime) / 60000).toFixed(2)
		this.logger.info(
			`Initial scan completed in ${durationMinutes}m. Processed ${stats.processedFiles} files (${stats.totalBlocks} blocks), skipped ${stats.skippedFiles}.`,
		)
	}

	async startWatcher(): Promise<void> {
		if (this.config.watch?.enabled === false) {
			rootLogger.info("File watcher disabled in configuration")
			await updateIndexingStatus(this.workspacePath, {
				state: 'idle',
			})
			return
		}

		this.watcher = new WorkspaceWatcher(
			this.workspacePath,
			this.directoryScanner,
			this.ignoreManager,
			this.config.watch?.debounceMs,
		)
		await this.watcher.start()

		// Start git commit watcher if enabled
		if (this.config.git?.trackCommits) {
			// Initialize LLM service for commit analysis
			this.commitLlmService = new CommitLlmService(
				this.workspacePath,
				this.embedder,
				this.vectorStore,
			)

			this.gitWatcher = new GitCommitWatcher(
				this.workspacePath,
				(commit) => this.handleGitCommit(commit),
			)
			await this.gitWatcher.start()

			if (this.commitLlmService.isConfigured()) {
				this.logger.info("Git commit watcher started with LLM analysis enabled")
			} else {
				this.logger.info("Git commit watcher started (LLM analysis disabled)")
			}
		}

		await updateIndexingStatus(this.workspacePath, {
			state: 'watching',
		})
	}

	private async handleGitCommit(commit: GitCommitInfo): Promise<void> {
		this.logger.info(`Git commit detected: ${commit.hash.slice(0, 7)} on ${commit.branch}`)

		if (commit.data) {
			const { metadata, stats, changedFiles } = commit.data

			this.logger.info(`  Author: ${metadata.author} <${metadata.authorEmail}>`)
			this.logger.info(`  Date: ${metadata.date.toISOString()}`)
			this.logger.info(`  Message: ${metadata.message.split('\n')[0]}`) // First line only
			this.logger.info(`  Stats: ${stats.filesChanged} files, +${stats.insertions}/-${stats.deletions}`)
			this.logger.info(`  Changed files:`)

			for (const file of changedFiles.slice(0, 5)) { // Show first 5 files
				const statusIcon = file.status === 'added' ? '+' : file.status === 'modified' ? 'M' : file.status === 'deleted' ? '-' : 'R'
				this.logger.info(`    ${statusIcon} ${file.filePath}`)
			}

			if (changedFiles.length > 5) {
				this.logger.info(`    ... and ${changedFiles.length - 5} more files`)
			}

			// Send to LLM for analysis and index the result
			if (this.commitLlmService?.isConfigured()) {
				try {
					const formatter = new CommitPromptFormatter(this.workspacePath)
					await formatter.initialize()
					const prompt = await formatter.formatPrompt(commit.data)

					await this.commitLlmService.analyzeAndIndexCommit(commit.data, prompt)
				} catch (error) {
					this.logger.error("Failed to analyze and index commit", error)
				}
			} else {
				this.logger.debug("LLM service not configured, skipping commit analysis")
			}
		}
	}

	async shutdown(): Promise<void> {
		await updateIndexingStatus(this.workspacePath, {
			state: 'idle',
		})

		if (this.watcher) {
			await this.watcher.stop()
			this.watcher = null
		}

		if (this.gitWatcher) {
			await this.gitWatcher.stop()
			this.gitWatcher = null
		}

		rootLogger.info("Indexer stopped")
	}
}
