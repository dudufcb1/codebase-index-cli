import fs from "fs/promises"
import path from "path"

export class CacheManager {
	private readonly cachePath: string
	private fileHashes: Record<string, string> = {}

	constructor(workspacePath: string, cachePath?: string) {
		const resolved = cachePath
			? cachePath
			: path.join(workspacePath, ".roo-code", "index-cache.json")
		this.cachePath = path.resolve(resolved)
	}

	async initialize(): Promise<void> {
		try {
			const content = await fs.readFile(this.cachePath, "utf8")
			this.fileHashes = JSON.parse(content)
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				console.warn("[CacheManager] Failed to read cache file:", error)
			}
			this.fileHashes = {}
		}
	}

	getHash(filePath: string): string | undefined {
		return this.fileHashes[filePath]
	}

	getAllHashes(): Record<string, string> {
		return { ...this.fileHashes }
	}

	async updateHash(filePath: string, hash: string): Promise<void> {
		this.fileHashes[filePath] = hash
		await this.persist()
	}

	async deleteHash(filePath: string): Promise<void> {
		delete this.fileHashes[filePath]
		await this.persist()
	}

	async clear(): Promise<void> {
		this.fileHashes = {}
		await this.persist()
	}

	private async persist(): Promise<void> {
		try {
			await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
			await fs.writeFile(this.cachePath, JSON.stringify(this.fileHashes, null, 2), "utf8")
		} catch (error) {
			console.warn("[CacheManager] Failed to persist cache file:", error)
		}
	}
}
