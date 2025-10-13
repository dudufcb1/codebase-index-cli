import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"

import { Logger } from "./logger.js"

const logger = new Logger("env")

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLI_ROOT_DIR = path.resolve(MODULE_DIR, "..")

interface EnvFileDescriptor {
	name: string
	override: boolean
}

const ENV_FILES: EnvFileDescriptor[] = [
	{ name: ".env", override: false },
	{ name: ".env.local", override: true },
]

function uniquePaths(paths: Array<string | undefined | null>): string[] {
	const seen = new Set<string>()
	const result: string[] = []
	for (const entry of paths) {
		if (!entry) continue
		const normalized = path.resolve(entry)
		if (seen.has(normalized)) continue
		seen.add(normalized)
		result.push(normalized)
	}
	return result
}

const DEFAULT_GLOBAL_ENV_DIRS = uniquePaths([
	CLI_ROOT_DIR,
	process.env.ROO_GLOBAL_ENV_DIR,
])

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

export async function loadEnvFiles(
	directories: string[],
	alreadyLoaded: Set<string> = new Set(),
): Promise<string[]> {
	const newlyLoaded: string[] = []

	for (const directory of directories) {
		if (!directory) continue
		const resolvedDirectory = path.resolve(directory)

		for (const descriptor of ENV_FILES) {
			const envPath = path.join(resolvedDirectory, descriptor.name)

			if (alreadyLoaded.has(envPath)) {
				continue
			}

			if (!(await fileExists(envPath))) {
				continue
			}

			const result = dotenv.config({ path: envPath, override: descriptor.override })
			if (result.error) {
				logger.warn(`Failed to load environment file ${envPath}`, result.error)
				continue
			}

			alreadyLoaded.add(envPath)
			newlyLoaded.push(envPath)
			logger.debug(`Loaded environment variables from ${envPath}`)
		}
	}

	return newlyLoaded
}

export function getGlobalEnvDirectories(): string[] {
	return [...DEFAULT_GLOBAL_ENV_DIRS]
}
