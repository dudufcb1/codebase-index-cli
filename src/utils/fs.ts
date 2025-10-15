import * as fs from "fs/promises"

/**
 * Check if a file exists at the given path
 */
export async function fileExistsAtPath(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

