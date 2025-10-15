import * as fs from "fs/promises"
import * as path from "path"

/**
 * List files in a directory recursively
 * Simple implementation without .gitignore support for now
 */
export async function listFiles(
	dirPath: string,
	options?: { maxFiles?: number }
): Promise<string[]> {
	const maxFiles = options?.maxFiles ?? 50
	const files: string[] = []

	async function scan(dir: string): Promise<void> {
		if (files.length >= maxFiles) return

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				if (files.length >= maxFiles) break

				const fullPath = path.join(dir, entry.name)

				// Skip common ignore patterns
				if (
					entry.name.startsWith(".") ||
					entry.name === "node_modules" ||
					entry.name === "dist" ||
					entry.name === "build"
				) {
					continue
				}

				if (entry.isDirectory()) {
					await scan(fullPath)
				} else if (entry.isFile()) {
					files.push(fullPath)
				}
			}
		} catch (error) {
			// Ignore permission errors
		}
	}

	await scan(dirPath)
	return files
}

