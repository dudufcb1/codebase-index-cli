import fs from "fs/promises"
import path from "path"
import * as ignorePackage from "ignore"
import type { Ignore, Options as IgnoreOptions } from "ignore"

const DIRS_TO_IGNORE = [
	"node_modules",
	"__pycache__",
	"env",
	"venv",
	"target/dependency",
	"build/dependencies",
	"dist",
	"out",
	"bundle",
	"vendor",
	"tmp",
	"temp",
	"deps",
	"pkg",
	"Pods",
	".git",
	".*",
]

function isPathInIgnoredDirectory(filePath: string): boolean {
	const normalizedPath = filePath.replace(/\\/g, "/")
	const pathParts = normalizedPath.split("/")

	for (const part of pathParts) {
		if (!part) continue
		if (DIRS_TO_IGNORE.includes(".*") && part.startsWith(".") && part !== ".") {
			return true
		}
		if (DIRS_TO_IGNORE.includes(part)) {
			return true
		}
	}

	for (const dir of DIRS_TO_IGNORE) {
		if (dir === ".*") continue
		if (normalizedPath.includes(`/${dir}/`)) {
			return true
		}
	}

	return false
}

export class IgnoreManager {
private gitIgnore: Ignore = createIgnoreInstance()
private rooIgnore: Ignore = createIgnoreInstance()

	constructor(private readonly workspacePath: string) {}

	async initialize(): Promise<void> {
		await Promise.all([this.loadGitIgnore(), this.loadRooIgnore()])
	}

	shouldIgnore(filePath: string): boolean {
		const relative = path.relative(this.workspacePath, filePath)
		if (!relative || relative === "") {
			// Workspace root should never be ignored
			return false
		}
		if (relative.startsWith("..")) {
			return true
		}

		if (isPathInIgnoredDirectory(filePath)) {
			return true
		}

		return this.gitIgnore.ignores(relative) || this.rooIgnore.ignores(relative)
	}

	filter(paths: string[]): string[] {
		return paths.filter((filePath) => !this.shouldIgnore(filePath))
	}

	private async loadGitIgnore(): Promise<void> {
		const gitIgnorePath = path.join(this.workspacePath, ".gitignore")
	this.gitIgnore = createIgnoreInstance()

		try {
			const content = await fs.readFile(gitIgnorePath, "utf8")
			this.gitIgnore.add(content)
			this.gitIgnore.add(".gitignore")
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				console.warn("[IgnoreManager] Failed to read .gitignore:", error)
			}
		}
	}

	private async loadRooIgnore(): Promise<void> {
		const rooIgnorePath = path.join(this.workspacePath, ".rooignore")
	this.rooIgnore = createIgnoreInstance()

		try {
			const content = await fs.readFile(rooIgnorePath, "utf8")
			this.rooIgnore.add(content)
			this.rooIgnore.add(".rooignore")
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				console.warn("[IgnoreManager] Failed to read .rooignore:", error)
			}
		}
	}

	static isDirectoryIgnored(filePath: string): boolean {
		return isPathInIgnoredDirectory(filePath) || DIRS_TO_IGNORE.some((dir) => filePath.includes(`/${dir}/`))
	}
}

function createIgnoreInstance(): Ignore {
	const possibleFactory =
		(ignorePackage as unknown as { default?: (options?: IgnoreOptions) => Ignore }).default ??
		(ignorePackage as unknown as (options?: IgnoreOptions) => Ignore)

	if (typeof possibleFactory !== "function") {
		throw new Error("Failed to create ignore instance. The ignore module did not export a factory function.")
	}
	return possibleFactory({ allowRelativePaths: true })
}
