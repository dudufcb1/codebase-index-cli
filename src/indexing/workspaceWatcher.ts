import chokidar, { type FSWatcher } from "chokidar"
import path from "path"

import { Logger } from "../logger.js"

import type { DirectoryScanner } from "./directoryScanner.js"
import { IgnoreManager } from "./ignoreManager.js"

const logger = new Logger("workspace-watcher")

type EventType = "add" | "change" | "unlink"

interface PendingEvent {
	type: EventType
	path: string
}

export class WorkspaceWatcher {
	private watcher: FSWatcher | null = null
	private readonly debounceMs: number
	private readonly pendingEvents = new Map<string, PendingEvent>()
	private timer: NodeJS.Timeout | null = null

	constructor(
		private readonly workspacePath: string,
		private readonly scanner: DirectoryScanner,
		private readonly ignoreManager: IgnoreManager,
		debounceMs?: number,
	) {
		this.debounceMs = debounceMs ?? 500
	}

	async start(): Promise<void> {
		if (this.watcher) {
			return
		}

		this.watcher = chokidar.watch(this.workspacePath, {
			ignoreInitial: true,
			ignored: (watchedPath) => this.shouldIgnore(watchedPath),
			awaitWriteFinish: {
				stabilityThreshold: 200,
				pollInterval: 100,
			},
		})

		this.watcher
			.on("add", (filePath) => this.enqueue("add", filePath))
			.on("change", (filePath) => this.enqueue("change", filePath))
			.on("unlink", (filePath) => this.enqueue("unlink", filePath))
			.on("error", (error) => logger.error("Watcher error", error))

		logger.info("File watcher initialized")
	}

	async stop(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close()
			this.watcher = null
		}
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		this.pendingEvents.clear()
	}

	private shouldIgnore(watchedPath: string): boolean {
		const absolute = path.isAbsolute(watchedPath) ? watchedPath : path.join(this.workspacePath, watchedPath)
		return this.ignoreManager.shouldIgnore(absolute)
	}

	private enqueue(type: EventType, filePath: string) {
		const absolute = path.isAbsolute(filePath) ? filePath : path.join(this.workspacePath, filePath)

		if (this.ignoreManager.shouldIgnore(absolute)) {
			return
		}

		this.pendingEvents.set(absolute, { type, path: absolute })

		if (this.timer) {
			clearTimeout(this.timer)
		}
		this.timer = setTimeout(() => this.flush(), this.debounceMs)
	}

	private async flush(): Promise<void> {
		const events = Array.from(this.pendingEvents.values())
		this.pendingEvents.clear()
		this.timer = null

		if (events.length === 0) {
			return
		}

		logger.info(`Processing ${events.length} file change(s)`)

		for (const event of events) {
			if (event.type === "unlink") {
				await this.scanner.handleDeletion(event.path)
				logger.debug(`Deleted index entries for ${event.path}`)
				continue
			}

			const result = await this.scanner.processFile(event.path, undefined, { force: true })
			if (result.processed) {
				logger.debug(`Indexed ${event.path} (${result.blockCount} block(s))`)
			}
		}
	}
}
