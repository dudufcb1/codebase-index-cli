import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"

export interface WorkspaceState {
	workspacePath: string
	createdAt: string
	updatedAt: string
	qdrantCollection: string
}

const LEGACY_STATE_DIRNAME = ".roo-index-cli"
const NEW_STATE_DIRNAME = ".codebase"
const STATE_FILENAME = "state.json"

async function writeStateFile(statePath: string, state: WorkspaceState): Promise<void> {
	await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8")
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
	}

	await writeStateFile(statePath, normalized)
	return normalized
}
