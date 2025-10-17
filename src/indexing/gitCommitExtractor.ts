import { exec } from "child_process"
import { promisify } from "util"
import { Logger } from "../logger.js"

const execAsync = promisify(exec)
const logger = new Logger("git-commit-extractor")

export interface GitCommitMetadata {
	hash: string
	author: string
	authorEmail: string
	date: Date
	message: string
	branch: string
}

export interface GitFileChange {
	status: "added" | "modified" | "deleted" | "renamed"
	filePath: string
	oldPath?: string // For renames
}

export interface GitCommitData {
	metadata: GitCommitMetadata
	diff: string
	changedFiles: GitFileChange[]
	stats: {
		filesChanged: number
		insertions: number
		deletions: number
	}
}

export class GitCommitExtractor {
	constructor(private readonly workspacePath: string) {}

	/**
	 * Get the current branch name
	 */
	async getCurrentBranch(): Promise<string> {
		try {
			const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
				cwd: this.workspacePath,
			})
			return stdout.trim()
		} catch (error) {
			logger.error("Failed to get current branch", error)
			return "unknown"
		}
	}

	/**
	 * Get a list of historical commit hashes, excluding the most recent one
	 * @param count Number of commits to retrieve (excluding the latest)
	 * @param branch Branch to get commits from (default: current branch)
	 */
	async getHistoricalCommits(count: number, branch?: string): Promise<string[]> {
		try {
			const branchName = branch ?? (await this.getCurrentBranch())

			// Get N+1 commits (we'll skip the first one)
			const { stdout } = await execAsync(
				`git log ${branchName} -n ${count + 1} --format=%H`,
				{
					cwd: this.workspacePath,
					maxBuffer: 10 * 1024 * 1024, // 10MB
				}
			)

			const allHashes = stdout
				.trim()
				.split("\n")
				.filter(Boolean)

			// Skip the first commit (most recent) and return the rest
			return allHashes.slice(1, count + 1)
		} catch (error) {
			logger.error(`Failed to get historical commits`, error)
			return []
		}
	}

	async extractCommitData(hash: string, branch: string): Promise<GitCommitData | null> {
		try {
			// Extract metadata
			const metadata = await this.extractMetadata(hash, branch)
			if (!metadata) {
				return null
			}

			// Extract diff
			const diff = await this.extractDiff(hash)

			// Extract changed files
			const changedFiles = await this.extractChangedFiles(hash)

			// Extract stats
			const stats = await this.extractStats(hash)

			return {
				metadata,
				diff,
				changedFiles,
				stats,
			}
		} catch (error) {
			logger.error(`Failed to extract commit data for ${hash}`, error)
			return null
		}
	}

	private async extractMetadata(hash: string, branch: string): Promise<GitCommitMetadata | null> {
		try {
			// Format: hash\nauthor\nemail\ntimestamp\nsubject\nbody
			const format = "%H%n%an%n%ae%n%at%n%s%n%b"
			const { stdout } = await execAsync(`git show ${hash} --format='${format}' --no-patch`, {
				cwd: this.workspacePath,
				maxBuffer: 10 * 1024 * 1024, // 10MB
			})

			const lines = stdout.trim().split("\n")
			if (lines.length < 5) {
				logger.warn(`Invalid git show output for ${hash}`)
				return null
			}

			const commitHash = lines[0]
			const author = lines[1]
			const authorEmail = lines[2]
			const timestamp = parseInt(lines[3], 10)
			const subject = lines[4]
			const body = lines.slice(5).join("\n").trim()

			const message = body ? `${subject}\n\n${body}` : subject

			return {
				hash: commitHash,
				author,
				authorEmail,
				date: new Date(timestamp * 1000),
				message,
				branch,
			}
		} catch (error) {
			logger.error(`Failed to extract metadata for ${hash}`, error)
			return null
		}
	}

	private async extractDiff(hash: string): Promise<string> {
		try {
			const { stdout } = await execAsync(`git show ${hash} --format= --unified=3`, {
				cwd: this.workspacePath,
				maxBuffer: 50 * 1024 * 1024, // 50MB for large diffs
			})
			return stdout.trim()
		} catch (error) {
			logger.error(`Failed to extract diff for ${hash}`, error)
			return ""
		}
	}

	private async extractChangedFiles(hash: string): Promise<GitFileChange[]> {
		try {
			const { stdout } = await execAsync(`git diff-tree --no-commit-id --name-status -r ${hash}`, {
				cwd: this.workspacePath,
			})

			const lines = stdout.trim().split("\n").filter(Boolean)
			const changes: GitFileChange[] = []

			for (const line of lines) {
				const parts = line.split("\t")
				if (parts.length < 2) continue

				const statusCode = parts[0]
				const filePath = parts[1]

				if (statusCode.startsWith("R")) {
					// Rename: R100	old_path	new_path
					const oldPath = parts[1]
					const newPath = parts[2]
					changes.push({
						status: "renamed",
						filePath: newPath,
						oldPath,
					})
				} else if (statusCode === "A") {
					changes.push({ status: "added", filePath })
				} else if (statusCode === "M") {
					changes.push({ status: "modified", filePath })
				} else if (statusCode === "D") {
					changes.push({ status: "deleted", filePath })
				}
			}

			return changes
		} catch (error) {
			logger.error(`Failed to extract changed files for ${hash}`, error)
			return []
		}
	}

	private async extractStats(hash: string): Promise<GitCommitData["stats"]> {
		try {
			const { stdout } = await execAsync(`git show ${hash} --format= --shortstat`, {
				cwd: this.workspacePath,
			})

			// Example output: " 1 file changed, 4 insertions(+), 4 deletions(-)"
			const match = stdout.match(/(\d+) file[s]? changed(?:, (\d+) insertion[s]?\(\+\))?(?:, (\d+) deletion[s]?\(-\))?/)

			if (!match) {
				return { filesChanged: 0, insertions: 0, deletions: 0 }
			}

			return {
				filesChanged: parseInt(match[1], 10) || 0,
				insertions: parseInt(match[2], 10) || 0,
				deletions: parseInt(match[3], 10) || 0,
			}
		} catch (error) {
			logger.error(`Failed to extract stats for ${hash}`, error)
			return { filesChanged: 0, insertions: 0, deletions: 0 }
		}
	}
}
