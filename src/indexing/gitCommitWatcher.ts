import chokidar, { type FSWatcher } from "chokidar"
import path from "path"
import fs from "fs/promises"

import { Logger } from "../logger.js"
import { updateLastActivity } from "../workspaceState.js"
import { GitCommitExtractor, type GitCommitData } from "./gitCommitExtractor.js"

const logger = new Logger("git-commit-watcher")

export interface GitCommitInfo {
	hash: string
	branch: string
	timestamp: string
	data?: GitCommitData // Full commit data (metadata, diff, files)
}

export type GitCommitCallback = (commit: GitCommitInfo) => Promise<void>

export class GitCommitWatcher {
	private watcher: FSWatcher | null = null
	private lastCommitHash: string | null = null
	private extractor: GitCommitExtractor

	constructor(
		private readonly workspacePath: string,
		private readonly onCommit: GitCommitCallback,
	) {
		this.extractor = new GitCommitExtractor(workspacePath)
	}

	async start(): Promise<void> {
		if (this.watcher) {
			return
		}

		const gitDir = path.join(this.workspacePath, ".git")

		// Verify .git directory exists
		try {
			const stats = await fs.stat(gitDir)
			if (!stats.isDirectory()) {
				logger.warn(`${gitDir} is not a directory, git tracking disabled`)
				return
			}
		} catch (error: any) {
			if (error?.code === "ENOENT") {
				logger.info(`No .git directory found at ${this.workspacePath}, git tracking disabled`)
			} else {
				logger.warn(`Failed to check .git directory: ${error?.message}`)
			}
			return
		}

		// Initialize last commit hash
		await this.updateLastCommitHash()

		// Watch .git directory for refs and logs changes
		// We watch directories instead of specific files because:
		// - refs/heads/main might not exist yet (no commits)
		// - logs/HEAD might not exist yet (no commits)
		// - logs/refs/heads/main might not exist yet
		const watchPaths = [
			path.join(gitDir, "HEAD"),           // Branch switches
			path.join(gitDir, "refs", "heads"),  // New commits (watch directory)
			path.join(gitDir, "logs"),           // Git reflog (watch directory)
		]

		this.watcher = chokidar.watch(watchPaths, {
			ignoreInitial: true,
			persistent: true,
			depth: 2, // Watch subdirectories up to 2 levels
			awaitWriteFinish: {
				stabilityThreshold: 100,
				pollInterval: 50,
			},
		})

		this.watcher
			.on("change", (filePath) => this.handleGitChange(filePath))
			.on("add", (filePath) => this.handleGitChange(filePath))  // Detect new files (first commit)
			.on("error", (error) => logger.error("Git watcher error", error))

		logger.info(`Git commit watcher initialized for ${this.workspacePath}`)
	}

	async stop(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close()
			this.watcher = null
		}
		this.lastCommitHash = null
	}

	private async handleGitChange(filePath: string): Promise<void> {
		try {
			const newCommitHash = await this.getCurrentCommitHash()

			// Only trigger if commit hash actually changed
			if (newCommitHash && newCommitHash !== this.lastCommitHash) {
				this.lastCommitHash = newCommitHash

				const branch = await this.getCurrentBranch()
				const timestamp = new Date().toISOString()

				logger.info(`New commit detected: ${newCommitHash.slice(0, 7)} on ${branch}`)

				// Extract full commit data
				const commitData = await this.extractor.extractCommitData(newCommitHash, branch)

				const commitInfo: GitCommitInfo = {
					hash: newCommitHash,
					branch,
					timestamp,
					data: commitData ?? undefined,
				}

				if (commitData) {
					logger.info(`Extracted commit data: ${commitData.changedFiles.length} files changed (+${commitData.stats.insertions}/-${commitData.stats.deletions})`)
				}

				await updateLastActivity(this.workspacePath, {
					timestamp,
					action: "indexed", // Using existing action type for now
					details: {
						gitCommit: commitInfo.hash,
						gitBranch: commitInfo.branch,
					},
				})

				await this.onCommit(commitInfo)
			}
		} catch (error) {
			logger.error("Failed to handle git change", error)
		}
	}

	private async updateLastCommitHash(): Promise<void> {
		try {
			this.lastCommitHash = await this.getCurrentCommitHash()
		} catch (error) {
			logger.debug("Failed to get initial commit hash", error)
		}
	}

	private async getCurrentCommitHash(): Promise<string | null> {
		try {
			const headPath = path.join(this.workspacePath, ".git", "HEAD")
			const headContent = await fs.readFile(headPath, "utf8")
			const trimmedHead = headContent.trim()

			// HEAD is detached (direct hash)
			if (/^[0-9a-f]{40}$/i.test(trimmedHead)) {
				return trimmedHead
			}

			// HEAD is a ref (e.g., "ref: refs/heads/main")
			const refMatch = trimmedHead.match(/^ref:\s*(.+)$/)
			if (refMatch) {
				const refPath = path.join(this.workspacePath, ".git", refMatch[1])
				const commitHash = await fs.readFile(refPath, "utf8")
				return commitHash.trim()
			}

			return null
		} catch (error) {
			return null
		}
	}

	private async getCurrentBranch(): Promise<string> {
		try {
			const headPath = path.join(this.workspacePath, ".git", "HEAD")
			const headContent = await fs.readFile(headPath, "utf8")
			const trimmedHead = headContent.trim()

			// Extract branch name from "ref: refs/heads/main"
			const refMatch = trimmedHead.match(/^ref:\s*refs\/heads\/(.+)$/)
			if (refMatch) {
				return refMatch[1]
			}

			// Detached HEAD
			return "HEAD (detached)"
		} catch (error) {
			return "unknown"
		}
	}
}
