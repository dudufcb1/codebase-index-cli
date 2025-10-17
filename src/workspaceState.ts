import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"

export type IndexingState = 'idle' | 'initializing' | 'scanning' | 'indexing' | 'watching' | 'error'
export type ActivityAction = 'indexed' | 'deleted' | 'skipped' | 'scan-completed' | 'initialized'

export interface IndexingStatus {
	state: IndexingState
	startedAt?: string
	progress?: {
		filesProcessed: number
		totalFiles?: number
		currentFile?: string
	}
	error?: string
}

export interface LastActivity {
	timestamp: string
	action: ActivityAction
	filePath?: string
	details?: {
		blockCount?: number
		reason?: string
		filesProcessed?: number
		totalBlocks?: number
		gitCommit?: string
		gitBranch?: string
	}
	vectorStore?: 'sqlite' | 'qdrant'
}

export interface QdrantStats {
	totalVectors: number
	uniqueFiles: number
	vectorDimension: number
	lastUpdated: string
}

export interface WorkspaceState {
	workspacePath: string
	createdAt: string
	updatedAt: string
	qdrantCollection: string
	indexingStatus?: IndexingStatus
	lastActivity?: LastActivity
	qdrantStats?: QdrantStats
}

const LEGACY_STATE_DIRNAME = ".roo-index-cli"
const NEW_STATE_DIRNAME = ".codebase"
const STATE_FILENAME = "state.json"

async function writeStateFile(statePath: string, state: WorkspaceState): Promise<void> {
	// Atomic write: write to temp file first, then rename
	// This prevents corruption if another process reads while writing
	const tmpPath = `${statePath}.tmp.${randomUUID()}`
	try {
		await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8")
		await fs.rename(tmpPath, statePath)
	} catch (error) {
		// Clean up temp file if something went wrong
		try {
			await fs.unlink(tmpPath)
		} catch {
			// Ignore cleanup errors
		}
		throw error
	}
}

export async function ensureWorkspaceState(workspacePath: string): Promise<WorkspaceState> {
	const stateDir = path.join(workspacePath, NEW_STATE_DIRNAME)
	const statePath = path.join(stateDir, STATE_FILENAME)
	const legacyStatePath = path.join(workspacePath, LEGACY_STATE_DIRNAME, STATE_FILENAME)

	await fs.mkdir(stateDir, { recursive: true })

	let state: WorkspaceState | null = null

	try {
		const raw = await fs.readFile(statePath, "utf8")
		const parsed = JSON.parse(raw) as Partial<WorkspaceState>
		if (parsed?.qdrantCollection && typeof parsed.qdrantCollection === "string") {
			const hydrated: WorkspaceState = {
				workspacePath,
				qdrantCollection: parsed.qdrantCollection,
				createdAt: parsed.createdAt && typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				indexingStatus: parsed.indexingStatus,
				lastActivity: parsed.lastActivity,
				qdrantStats: parsed.qdrantStats,
			}
			state = hydrated
		}
	} catch (error: any) {
		if (error?.code === "ENOENT") {
			try {
				const legacyRaw = await fs.readFile(legacyStatePath, "utf8")
				const parsed = JSON.parse(legacyRaw) as Partial<WorkspaceState>
				if (parsed?.qdrantCollection && typeof parsed.qdrantCollection === "string") {
					const hydrated: WorkspaceState = {
						workspacePath,
						qdrantCollection: parsed.qdrantCollection,
						createdAt: parsed.createdAt && typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						indexingStatus: parsed.indexingStatus,
						lastActivity: parsed.lastActivity,
						qdrantStats: parsed.qdrantStats,
					}
					state = hydrated
					console.warn(
						`[workspace-state] Migrated legacy state from ${legacyStatePath} to ${statePath}.`,
					)
				}
			} catch (legacyError: any) {
				if (legacyError?.code !== "ENOENT") {
					console.warn("[workspace-state] Failed to read legacy state file:", legacyError)
				}
			}
		} else {
			console.warn("[workspace-state] Failed to read state file:", error)
		}
	}

	if (!state) {
		const collectionId = randomUUID().replace(/-/g, "").slice(0, 18)
		const collectionName = `codebase-${collectionId}`
		state = {
			workspacePath,
			qdrantCollection: collectionName,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}
	}

	await writeStateFile(statePath, state)
	return state
}

export async function saveWorkspaceState(
	workspacePath: string,
	state: WorkspaceState,
): Promise<WorkspaceState> {
	const stateDir = path.join(workspacePath, NEW_STATE_DIRNAME)
	const statePath = path.join(stateDir, STATE_FILENAME)
	await fs.mkdir(stateDir, { recursive: true })

	const normalized: WorkspaceState = {
		workspacePath,
		qdrantCollection: state.qdrantCollection,
		createdAt: state.createdAt ?? new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		indexingStatus: state.indexingStatus,
		lastActivity: state.lastActivity,
		qdrantStats: state.qdrantStats,
	}

	await writeStateFile(statePath, normalized)
	return normalized
}

async function readState(workspacePath: string): Promise<WorkspaceState | null> {
	const stateDir = path.join(workspacePath, NEW_STATE_DIRNAME)
	const statePath = path.join(stateDir, STATE_FILENAME)

	try {
		const raw = await fs.readFile(statePath, "utf8")
		return JSON.parse(raw) as WorkspaceState
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			console.warn("[workspace-state] Failed to read state file:", error)
		}
		return null
	}
}

async function updateState(
	workspacePath: string,
	updater: (state: WorkspaceState) => Partial<WorkspaceState>
): Promise<void> {
	const stateDir = path.join(workspacePath, NEW_STATE_DIRNAME)
	const statePath = path.join(stateDir, STATE_FILENAME)

	try {
		const current = await readState(workspacePath)
		if (!current) {
			console.warn("[workspace-state] Cannot update non-existent state file")
			return
		}

		const updated: WorkspaceState = {
			...current,
			...updater(current),
			updatedAt: new Date().toISOString(),
		}

		await writeStateFile(statePath, updated)
	} catch (error) {
		console.warn("[workspace-state] Failed to update state:", error)
	}
}

export async function updateIndexingStatus(
	workspacePath: string,
	status: IndexingStatus
): Promise<void> {
	await updateState(workspacePath, () => ({ indexingStatus: status }))
}

export async function updateLastActivity(
	workspacePath: string,
	activity: LastActivity
): Promise<void> {
	await updateState(workspacePath, () => ({ lastActivity: activity }))
}

export async function updateQdrantStats(
	workspacePath: string,
	stats: Omit<QdrantStats, 'lastUpdated'>
): Promise<void> {
	await updateState(workspacePath, () => ({
		qdrantStats: {
			...stats,
			lastUpdated: new Date().toISOString(),
		}
	}))
}
