import chokidar, { type FSWatcher } from "chokidar"
import path from "path"

import { Logger } from "../logger.js"
import { updateIndexingStatus, updateLastActivity } from "../workspaceState.js"

import type { DirectoryScanner, ProcessFileReason } from "./directoryScanner.js"
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
			ignored: [
				// Patrones regex para evitar que chokidar intente abrir estos directorios
				/(^|[\/\\])\../,           // Archivos/directorios que empiezan con punto
				/node_modules/,
				/__pycache__/,
				/\.git/,
				/\.vscode/,
				/\.idea/,
				/env[\/\\]/,
				/venv[\/\\]/,
				/dist[\/\\]/,
				/out[\/\\]/,
				/build[\/\\]/,
				/target[\/\\]/,
				/vendor[\/\\]/,
				/tmp[\/\\]/,
				/temp[\/\\]/,
				/\.next/,
				/\.nuxt/,
				/\.cache/,
				// Función adicional para verificaciones más complejas
				(watchedPath) => this.shouldIgnore(watchedPath),
			],
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

		logger.info(`File watcher initialized at ${this.workspacePath}`)
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

		await updateIndexingStatus(this.workspacePath, {
			state: 'indexing',
			startedAt: new Date().toISOString(),
			progress: {
				filesProcessed: 0,
				totalFiles: events.length,
			},
		})

		logger.info(`Processing ${events.length} file change(s)`)

		let filesProcessed = 0

		for (const event of events) {
			const relativePath = path.relative(this.workspacePath, event.path)
			const displayPath =
				!relativePath || relativePath.startsWith("..") ? event.path : relativePath

			if (event.type === "unlink") {
				await this.scanner.handleDeletion(event.path)
				logger.info(`[delete] removed ${displayPath}`)

				await updateLastActivity(this.workspacePath, {
					timestamp: new Date().toISOString(),
					action: 'deleted',
					filePath: displayPath,
				})

				filesProcessed++
				await updateIndexingStatus(this.workspacePath, {
					state: 'indexing',
					progress: {
						filesProcessed,
						totalFiles: events.length,
						currentFile: displayPath,
					},
				})
				continue
			}

			const result = await this.scanner.processFile(event.path, undefined, { force: true })
			if (result.processed) {
				logger.info(`[index] ${event.type} ${displayPath} (${result.blockCount} block(s))`)

				await updateLastActivity(this.workspacePath, {
					timestamp: new Date().toISOString(),
					action: 'indexed',
					filePath: displayPath,
					details: {
						blockCount: result.blockCount,
					},
				})
			} else {
				if (result.reason && result.reason !== "unchanged") {
					const reasonLabel = formatSkipReason(result.reason)
					logger.info(`[skip] ${event.type} ${displayPath}${reasonLabel ? ` (${reasonLabel})` : ""}`)

					await updateLastActivity(this.workspacePath, {
						timestamp: new Date().toISOString(),
						action: 'skipped',
						filePath: displayPath,
						details: {
							reason: result.reason,
						},
					})
				} else {
					logger.debug(`No changes detected for ${displayPath}`)
				}
			}

			filesProcessed++
			await updateIndexingStatus(this.workspacePath, {
				state: 'indexing',
				progress: {
					filesProcessed,
					totalFiles: events.length,
					currentFile: displayPath,
				},
			})
		}

		await updateIndexingStatus(this.workspacePath, {
			state: 'watching',
		})
	}
}

function formatSkipReason(reason: ProcessFileReason): string {
	switch (reason) {
		case "ignored":
			return "ignored by patterns"
		case "unsupported-extension":
			return "unsupported file type"
		case "too-large":
			return "exceeds size limit"
		case "no-blocks":
			return "no indexable content"
		case "error":
			return "failed to process"
		case "unchanged":
		default:
			return ""
	}
}
