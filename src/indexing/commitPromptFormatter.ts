import fs from "fs/promises"
import path from "path"
import type { GitCommitData } from "./gitCommitExtractor.js"
import { Logger } from "../logger.js"
import { IgnoreManager } from "./ignoreManager.js"

const logger = new Logger("commit-prompt-formatter")

export class CommitPromptFormatter {
	private ignoreManager: IgnoreManager

	constructor(private readonly workspacePath: string) {
		this.ignoreManager = new IgnoreManager(workspacePath)
	}

	async initialize(): Promise<void> {
		await this.ignoreManager.initialize()
	}

	/**
	 * Formats commit data into a prompt for LLM analysis
	 */
	async formatPrompt(commitData: GitCommitData): Promise<string> {
		const { metadata, diff, changedFiles, stats } = commitData

		const sections: string[] = []

		// Header
		sections.push("=".repeat(80))
		sections.push("GIT COMMIT ANALYSIS REQUEST")
		sections.push("=".repeat(80))
		sections.push("")

		// Codebase structure section
		sections.push("## CODEBASE STRUCTURE")
		sections.push("-".repeat(80))
		sections.push("Project files (for context):")
		sections.push("")
		const fileTree = await this.getCodebaseFileTree()
		sections.push(fileTree)
		sections.push("")

		// Metadata section
		sections.push("## COMMIT METADATA")
		sections.push("-".repeat(80))
		sections.push(`Commit Hash: ${metadata.hash}`)
		sections.push(`Branch: ${metadata.branch}`)
		sections.push(`Author: ${metadata.author} <${metadata.authorEmail}>`)
		sections.push(`Date: ${metadata.date.toISOString()}`)
		sections.push(`Message:`)
		sections.push("")
		sections.push(metadata.message)
		sections.push("")

		// Stats section
		sections.push("## COMMIT STATISTICS")
		sections.push("-".repeat(80))
		sections.push(`Files Changed: ${stats.filesChanged}`)
		sections.push(`Insertions: +${stats.insertions}`)
		sections.push(`Deletions: -${stats.deletions}`)
		sections.push("")

		// Changed files section
		sections.push("## CHANGED FILES")
		sections.push("-".repeat(80))
		for (const file of changedFiles) {
			const statusIcon = this.getStatusIcon(file.status)
			if (file.oldPath) {
				sections.push(`${statusIcon} ${file.oldPath} → ${file.filePath}`)
			} else {
				sections.push(`${statusIcon} ${file.filePath}`)
			}
		}
		sections.push("")

		// Diff section
		sections.push("## FULL DIFF")
		sections.push("-".repeat(80))
		sections.push(diff)
		sections.push("")

		// Analysis prompt
		sections.push("=".repeat(80))
		sections.push("ANALYSIS REQUEST")
		sections.push("=".repeat(80))
		sections.push("")
		sections.push("Based on the commit information above, please provide:")
		sections.push("")
		sections.push("1. **Semantic Summary**: A concise description of what changed and why")
		sections.push("2. **Purpose/Intent**: The likely reason or goal behind this commit")
		sections.push("3. **Impact Analysis**: How this affects the codebase (new features, bug fixes, refactoring, etc.)")
		sections.push("4. **Key Changes**: The most important modifications in this commit")
		sections.push("")

		return sections.join("\n")
	}

	/**
	 * Writes the formatted prompt to prompt.txt in workspace root
	 */
	async writePromptToFile(commitData: GitCommitData): Promise<void> {
		try {
			const prompt = await this.formatPrompt(commitData)
			const promptPath = path.join(this.workspacePath, "prompt.txt")

			await fs.writeFile(promptPath, prompt, "utf8")

			logger.info(`Commit prompt written to ${promptPath}`)
			logger.info(`File size: ${Buffer.byteLength(prompt, "utf8")} bytes`)
		} catch (error) {
			logger.error("Failed to write prompt.txt", error)
			throw error
		}
	}

	/**
	 * Appends a new commit to prompt.txt (for tracking multiple commits)
	 */
	async appendPromptToFile(commitData: GitCommitData): Promise<void> {
		try {
			const prompt = await this.formatPrompt(commitData)
			const separator = "\n\n" + "█".repeat(80) + "\n\n"
			const content = separator + prompt
			const promptPath = path.join(this.workspacePath, "prompt.txt")

			// Check if file exists
			try {
				await fs.access(promptPath)
				// File exists, append
				await fs.appendFile(promptPath, content, "utf8")
				logger.info(`Commit prompt appended to ${promptPath}`)
			} catch {
				// File doesn't exist, write new
				await fs.writeFile(promptPath, prompt, "utf8")
				logger.info(`Commit prompt written to ${promptPath} (new file)`)
			}
		} catch (error) {
			logger.error("Failed to append to prompt.txt", error)
			throw error
		}
	}

	/**
	 * Gets a tree-like listing of codebase files
	 */
	private async getCodebaseFileTree(): Promise<string> {
		try {
			const files = await this.collectFiles(this.workspacePath)

			if (files.length === 0) {
				return "(No files found)"
			}

			// Group files by directory
			const filesByDir = new Map<string, string[]>()

			for (const file of files) {
				const relativePath = path.relative(this.workspacePath, file)
				const dir = path.dirname(relativePath)
				const fileName = path.basename(relativePath)

				if (!filesByDir.has(dir)) {
					filesByDir.set(dir, [])
				}
				filesByDir.get(dir)!.push(fileName)
			}

			// Sort directories
			const sortedDirs = Array.from(filesByDir.keys()).sort()

			const lines: string[] = []
			const maxFiles = 200 // Limit to avoid huge prompts
			let fileCount = 0

			for (const dir of sortedDirs) {
				if (fileCount >= maxFiles) {
					lines.push(`... (${files.length - fileCount} more files omitted)`)
					break
				}

				const dirFiles = filesByDir.get(dir)!.sort()
				const displayDir = dir === '.' ? '/' : `/${dir}/`

				lines.push(displayDir)

				for (const file of dirFiles) {
					if (fileCount >= maxFiles) break
					lines.push(`  - ${file}`)
					fileCount++
				}
			}

			return lines.join("\n")
		} catch (error) {
			logger.error("Failed to get codebase file tree", error)
			return "(Error loading file tree)"
		}
	}

	/**
	 * Recursively collects all files in the workspace (respecting .gitignore)
	 */
	private async collectFiles(basePath: string): Promise<string[]> {
		const results: string[] = []

		async function walk(current: string, ignoreManager: IgnoreManager) {
			try {
				const entries = await fs.readdir(current, { withFileTypes: true })

				for (const entry of entries) {
					const fullPath = path.join(current, entry.name)

					if (ignoreManager.shouldIgnore(fullPath)) {
						continue
					}

					if (entry.isDirectory()) {
						await walk(fullPath, ignoreManager)
					} else if (entry.isFile()) {
						results.push(fullPath)
					}
				}
			} catch (error) {
				// Skip directories we can't read
			}
		}

		await walk(basePath, this.ignoreManager)
		return results
	}

	private getStatusIcon(status: string): string {
		switch (status) {
			case "added":
				return "[+]"
			case "modified":
				return "[M]"
			case "deleted":
				return "[-]"
			case "renamed":
				return "[R]"
			default:
				return "[?]"
		}
	}
}
