import path from "path"

import { createEmbedder } from "./embedder/index.js"
import type { Embedder } from "./embedder/index.js"
import { Logger, rootLogger } from "./logger.js"
import type { IndexingConfig } from "./types.js"
import { QdrantVectorStore } from "./vectorStore/qdrantVectorStore.js"
import { SqliteVecClient } from "./vectorStore/sqliteVecClient.js"
import type { VectorStore } from "./vectorStore/interface.js"

import { CacheManager } from "./indexing/cacheManager.js"
import { DirectoryScanner } from "./indexing/directoryScanner.js"
import { IgnoreManager } from "./indexing/ignoreManager.js"
import { WorkspaceWatcher } from "./indexing/workspaceWatcher.js"

export class WorkspaceIndexer {
	private readonly logger = new Logger("indexer")
	private workspacePath!: string
	private embedder!: Embedder
	private vectorStore!: VectorStore
	private cacheManager!: CacheManager
	private ignoreManager!: IgnoreManager
	private directoryScanner!: DirectoryScanner
	private watcher: WorkspaceWatcher | null = null

	constructor(private readonly config: IndexingConfig) {
}

	async initialize(): Promise<void> {
		this.workspacePath = path.resolve(this.config.workspacePath)

		this.embedder = createEmbedder(this.config.embedder)
		await this.embedder.validateConfiguration()

		const dimension = this.embedder.dimension()

		// Create vector store based on configuration
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
			this.vectorStore = new QdrantVectorStore(
				this.workspacePath,
				this.config.qdrant.url,
				dimension,
				this.config.qdrant.apiKey,
				this.config.qdrant.collectionName,
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

		await this.vectorStore.initialize()
	}

	async forceRebuild(): Promise<void> {
		this.logger.info("Clearing cached hashes and resetting vector collection...")
		await this.cacheManager.clear()
		await this.vectorStore.resetCollection()
	}

	async runInitialScan(): Promise<void> {
		this.logger.info("Starting full workspace scan...")
		const stats = await this.directoryScanner.scan()
		this.logger.info(
			`Initial scan completed. Processed ${stats.processedFiles} files (${stats.totalBlocks} blocks), skipped ${stats.skippedFiles}.`,
		)
	}

	async startWatcher(): Promise<void> {
		if (this.config.watch?.enabled === false) {
			rootLogger.info("File watcher disabled in configuration")
			return
		}

		this.watcher = new WorkspaceWatcher(
			this.workspacePath,
			this.directoryScanner,
			this.ignoreManager,
			this.config.watch?.debounceMs,
		)
		await this.watcher.start()
	}

	async shutdown(): Promise<void> {
		if (this.watcher) {
			await this.watcher.stop()
			this.watcher = null
		}
		rootLogger.info("Indexer stopped")
	}
}
