import { QdrantClient, type Schemas } from "@qdrant/js-client-rest"
import { createHash } from "crypto"
import path from "path"
import fs from "fs/promises"
import { randomUUID } from "crypto"
import type { VectorStore, VectorStoreSearchResult } from "./interface.js"

const DEFAULT_MAX_SEARCH_RESULTS = 50
const DEFAULT_SEARCH_MIN_SCORE = 0.4

export class QdrantVectorStore implements VectorStore {
	private vectorSize: number
	private readonly DISTANCE_METRIC = "Cosine"

	private client: QdrantClient
	private collectionName: string
	private readonly qdrantUrl: string = "http://localhost:6333"
	private readonly workspacePath: string

	constructor(
		workspacePath: string,
		url: string,
		vectorSize: number,
		apiKey?: string,
		collectionName?: string,
	) {
		const parsedUrl = this.parseQdrantUrl(url)
		this.qdrantUrl = parsedUrl
		this.workspacePath = workspacePath

		if (!collectionName) {
			throw new Error("Collection name is required for QdrantVectorStore. This should come from the workspace state.json file.")
		}

		try {
			const urlObj = new URL(parsedUrl)
			let port: number
			let useHttps: boolean

			if (urlObj.port) {
				port = Number(urlObj.port)
				useHttps = urlObj.protocol === "https:"
			} else {
				if (urlObj.protocol === "https:") {
					port = 443
					useHttps = true
				} else {
					port = 80
					useHttps = false
				}
			}

			this.client = new QdrantClient({
				host: urlObj.hostname,
				https: useHttps,
				port,
				prefix: urlObj.pathname === "/" ? undefined : urlObj.pathname.replace(/\/+$/, ""),
				apiKey,
				headers: {
					"User-Agent": "Roo-Code-CLI",
				},
			})
		} catch (urlError) {
			this.client = new QdrantClient({
				url: parsedUrl,
				apiKey,
				headers: {
					"User-Agent": "Roo-Code-CLI",
				},
			})
		}

		this.vectorSize = vectorSize
		this.collectionName = collectionName
	}

	private parseQdrantUrl(url: string | undefined): string {
		if (!url || url.trim() === "") {
			return "http://localhost:6333"
		}

		const trimmedUrl = url.trim()

		if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://") && !trimmedUrl.includes("://")) {
			return this.parseHostname(trimmedUrl)
		}

		try {
			// eslint-disable-next-line no-new
			new URL(trimmedUrl)
			return trimmedUrl
		} catch {
			return this.parseHostname(trimmedUrl)
		}
	}

	private parseHostname(hostname: string): string {
		if (hostname.includes(":")) {
			return hostname.startsWith("http") ? hostname : `http://${hostname}`
		}
		return `http://${hostname}`
	}

	private async getCollectionInfo(): Promise<Schemas["CollectionInfo"] | null> {
		try {
			const collectionInfo = await this.client.getCollection(this.collectionName)
			return collectionInfo
		} catch (error: unknown) {
			if (error instanceof Error) {
				console.warn(
					`[QdrantVectorStore] Unable to fetch collection info for "${this.collectionName}":`,
					error.message,
				)
			}
			return null
		}
	}

	private async createCollection(): Promise<void> {
		await this.client.createCollection(this.collectionName, {
			vectors: {
				size: this.vectorSize,
				distance: this.DISTANCE_METRIC,
				on_disk: true,
			},
			hnsw_config: {
				m: 64,
				ef_construct: 512,
				on_disk: true,
			},
		})
	}

	private async cleanStateAndCache(): Promise<string> {
		const codebaseDir = path.join(this.workspacePath, ".codebase")
		const statePath = path.join(codebaseDir, "state.json")
		const cachePath = path.join(codebaseDir, "cache.json")

		// Delete old state.json
		try {
			await fs.unlink(statePath)
			console.warn(`[QdrantVectorStore] Deleted corrupted ${statePath}`)
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				console.warn(`[QdrantVectorStore] Failed to delete ${statePath}:`, error)
			}
		}

		// Delete cache.json
		try {
			await fs.unlink(cachePath)
			console.warn(`[QdrantVectorStore] Deleted ${cachePath}`)
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				console.warn(`[QdrantVectorStore] Failed to delete ${cachePath}:`, error)
			}
		}

		// Generate new collection name
		const collectionId = randomUUID().replace(/-/g, "").slice(0, 18)
		const newCollectionName = `codebase-${collectionId}`

		// Immediately regenerate state.json with new collection
		const newState = {
			workspacePath: this.workspacePath,
			qdrantCollection: newCollectionName,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}

		await fs.mkdir(codebaseDir, { recursive: true })
		await fs.writeFile(statePath, JSON.stringify(newState, null, 2), "utf8")
		console.warn(`[QdrantVectorStore] Regenerated ${statePath} with new collection: ${newCollectionName}`)

		return newCollectionName
	}

	async initialize(): Promise<{ created: boolean; didCleanup: boolean }> {
		let created = false
		let didCleanup = false
		try {
			const collectionInfo = await this.getCollectionInfo()

			if (collectionInfo === null) {
				console.warn(
					`[QdrantVectorStore] Collection "${this.collectionName}" does not exist. This could be from a bug where multiple workspaces share the same collection name.`,
				)

				// Clean and regenerate state.json with NEW collection name
				const newCollectionName = await this.cleanStateAndCache()

				// Update this instance's collection name
				this.collectionName = newCollectionName

				didCleanup = true

				// Create the new collection
				await this.createCollection()
				created = true
			} else {
				const vectorsConfig = collectionInfo.config?.params?.vectors
				let existingVectorSize: number

				if (typeof vectorsConfig === "number") {
					existingVectorSize = vectorsConfig
				} else if (
					vectorsConfig &&
					typeof vectorsConfig === "object" &&
					"size" in vectorsConfig &&
					typeof vectorsConfig.size === "number"
				) {
					existingVectorSize = vectorsConfig.size
				} else {
					existingVectorSize = 0
				}

			if (existingVectorSize !== this.vectorSize) {
				created = await this.recreateCollectionWithNewDimension(existingVectorSize, this.vectorSize)
			}
			}

			await this.createPayloadIndexes()
			return { created, didCleanup }
		} catch (error: any) {
			const errorMessage = error?.message || String(error)
			console.error(`[QdrantVectorStore] Failed to initialize collection "${this.collectionName}":`, errorMessage)
			if (error instanceof Error && error.cause !== undefined) {
				throw error
			}
			throw new Error(`Failed to connect to Qdrant at ${this.qdrantUrl}: ${errorMessage}`)
		}
	}

	private async recreateCollectionWithNewDimension(existingVectorSize: number, desiredVectorSize: number): Promise<boolean> {
		console.warn(
			`[QdrantVectorStore] Collection ${this.collectionName} has dimension ${existingVectorSize}, expected ${desiredVectorSize}. Recreating.`,
		)

		let deletionSucceeded = false
		let recreationAttempted = false

		try {
			await this.client.deleteCollection(this.collectionName)
			deletionSucceeded = true

			await new Promise((resolve) => setTimeout(resolve, 100))

			const verificationInfo = await this.getCollectionInfo()
			if (verificationInfo !== null) {
				throw new Error("Collection still exists after deletion attempt")
			}

			recreationAttempted = true
			this.vectorSize = desiredVectorSize
			await this.createCollection()
			return true
		} catch (recreationError) {
			const errorMessage = recreationError instanceof Error ? recreationError.message : String(recreationError)
			let contextualErrorMessage: string

			if (!deletionSucceeded) {
				contextualErrorMessage = `Failed to delete existing collection with vector size ${existingVectorSize}. ${errorMessage}`
			} else if (!recreationAttempted) {
				contextualErrorMessage = `Deleted existing collection but verification failed. ${errorMessage}`
			} else {
				contextualErrorMessage = `Deleted collection but failed to create new collection with vector size ${desiredVectorSize}. ${errorMessage}`
			}

			console.error(
				`[QdrantVectorStore] Failed to recreate collection ${this.collectionName}: ${contextualErrorMessage}`,
			)

			const dimensionMismatchError = new Error(
				`Qdrant collection dimension mismatch: ${contextualErrorMessage}`,
			)
			dimensionMismatchError.cause = recreationError
			throw dimensionMismatchError
		}
	}

	async resetCollection(): Promise<void> {
		try {
			await this.client.deleteCollection(this.collectionName)
		} catch (error: any) {
			const message = (error?.message || "").toLowerCase()
			if (!message.includes("not found") && !message.includes("does not exist")) {
				console.warn(
					`[QdrantVectorStore] Failed to delete collection ${this.collectionName} during reset:`,
					error?.message ?? error,
				)
			}
		}

		await this.createCollection()
		await this.createPayloadIndexes()
	}

	private async createPayloadIndexes(): Promise<void> {
		for (let i = 0; i <= 4; i++) {
			try {
				await this.client.createPayloadIndex(this.collectionName, {
					field_name: `pathSegments.${i}`,
					field_schema: "keyword",
				})
			} catch (indexError: any) {
				const errorMessage = (indexError?.message || "").toLowerCase()
				if (!errorMessage.includes("already exists")) {
					console.warn(
						`[QdrantVectorStore] Could not create payload index for pathSegments.${i}:`,
						indexError?.message || indexError,
					)
				}
			}
		}
	}

	async upsertPoints(
		points: Array<{
			id: string
			vector: number[]
			payload: Record<string, any>
		}>,
	): Promise<void> {
		try {
			const processedPoints = points.map((point) => {
				if (point.payload?.filePath) {
					const segments = point.payload.filePath.split(path.sep).filter(Boolean)
					const pathSegments = segments.reduce(
						(acc: Record<string, string>, segment: string, index: number) => {
							acc[index.toString()] = segment
							return acc
						},
						{},
					)
					return {
						...point,
						payload: {
							...point.payload,
							pathSegments,
						},
					}
				}
				return point
			})

			await this.client.upsert(this.collectionName, {
				points: processedPoints,
				wait: true,
			})
		} catch (error) {
			console.error("Failed to upsert points:", error)
			throw error
		}
	}

	private isPayloadValid(payload: Record<string, unknown> | null | undefined): payload is {
		filePath: string
		codeChunk: string
		startLine: number
		endLine: number
		segmentHash?: string
	} {
		if (!payload) {
			return false
		}
		const validKeys = ["filePath", "codeChunk", "startLine", "endLine"]
		return validKeys.every((key) => key in payload)
	}

	async search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]> {
		try {
			let filter: any = undefined

			if (directoryPrefix) {
				const normalizedPrefix = path.posix.normalize(directoryPrefix.replace(/\\/g, "/"))
				if (normalizedPrefix !== "." && normalizedPrefix !== "./") {
					const cleanedPrefix = path.posix.normalize(
						normalizedPrefix.startsWith("./") ? normalizedPrefix.slice(2) : normalizedPrefix,
					)
					const segments = cleanedPrefix.split("/").filter(Boolean)
					if (segments.length > 0) {
						filter = {
							must: segments.map((segment, index) => ({
								key: `pathSegments.${index}`,
								match: { value: segment },
							})),
						}
					}
				}
			}

			const searchRequest = {
				query: queryVector,
				filter,
				score_threshold: minScore ?? DEFAULT_SEARCH_MIN_SCORE,
				limit: maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "segmentHash"],
				},
			}

			const operationResult = await this.client.query(this.collectionName, searchRequest)
			const results: VectorStoreSearchResult[] = []

			for (const point of operationResult.points) {
				if (!this.isPayloadValid(point.payload)) {
					continue
				}

				results.push({
					id: String(point.id),
					score: point.score ?? 0,
					payload: {
						filePath: point.payload.filePath,
						codeChunk: point.payload.codeChunk,
						startLine: point.payload.startLine,
						endLine: point.payload.endLine,
						segmentHash: point.payload.segmentHash,
					},
				})
			}

			return results
		} catch (error) {
			console.error("Failed to search points:", error)
			throw error
		}
	}

	async deletePointsByFilePath(filePath: string): Promise<void> {
		await this.deletePointsByMultipleFilePaths([filePath])
	}

	async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) {
			return
		}

		try {
			const collectionExists = await this.collectionExists()
			if (!collectionExists) {
				console.warn(`[QdrantVectorStore] Collection "${this.collectionName}" does not exist, skipping delete`)
				return
			}

			const workspaceRoot = this.workspacePath
			const filters = filePaths.map((filePath) => {
				const relativePath = path.isAbsolute(filePath) ? path.relative(workspaceRoot, filePath) : filePath
				const normalizedRelativePath = path.normalize(relativePath)
				const segments = normalizedRelativePath.split(path.sep).filter(Boolean)
				const mustConditions = segments.map((segment, index) => ({
					key: `pathSegments.${index}`,
					match: { value: segment },
				}))
				return { must: mustConditions }
			})

			const filter = filters.length === 1 ? filters[0] : { should: filters }

			await this.client.delete(this.collectionName, {
				filter: filter as any,
				wait: true,
			})
		} catch (error: any) {
			const errorMessage = error?.message || String(error)
			const errorStatus = error?.status || error?.response?.status || error?.statusCode
			const errorDetails = error?.response?.data || error?.data || ""

			console.error(`[QdrantVectorStore] Failed to delete points:`, {
				error: errorMessage,
				status: errorStatus,
				details: errorDetails,
				collection: this.collectionName,
				fileCount: filePaths.length,
				samplePaths: filePaths.slice(0, 3),
			})
		}
	}

	async deleteCollection(): Promise<void> {
		try {
			if (await this.collectionExists()) {
				await this.client.deleteCollection(this.collectionName)
			}
		} catch (error) {
			console.error(`[QdrantVectorStore] Failed to delete collection ${this.collectionName}:`, error)
			throw error
		}
	}

	async clearCollection(): Promise<void> {
		try {
			await this.client.delete(this.collectionName, {
				filter: {
					must: [],
				},
				wait: true,
			})
		} catch (error) {
			console.error("Failed to clear collection:", error)
			throw error
		}
	}

	async collectionExists(): Promise<boolean> {
		const collectionInfo = await this.getCollectionInfo()
		return collectionInfo !== null
	}

	async ensureVectorDimension(actualDimension: number): Promise<void> {
		if (actualDimension === this.vectorSize) {
			return
		}

		console.warn(
			`[QdrantVectorStore] Adjusting vector dimension from ${this.vectorSize} to ${actualDimension}.`,
		)

		await this.recreateCollectionWithNewDimension(this.vectorSize, actualDimension)
		this.vectorSize = actualDimension
	}

	async getCollectionStats(): Promise<{
		totalVectors: number
		uniqueFiles: number
		vectorDimension: number
	} | null> {
		try {
			const collectionInfo = await this.getCollectionInfo()
			if (!collectionInfo) {
				return null
			}

			const totalVectors = collectionInfo.points_count ?? 0

			const scrollResponse = await this.client.scroll(this.collectionName, {
				limit: 10000,
				with_payload: {
					include: ["filePath"]
				},
				with_vector: false,
			})

			const uniqueFilesSet = new Set<string>()
			for (const point of scrollResponse.points) {
				if (point.payload && typeof point.payload === "object" && "filePath" in point.payload) {
					const filePath = point.payload.filePath
					if (typeof filePath === "string") {
						uniqueFilesSet.add(filePath)
					}
				}
			}

			const vectorsConfig = collectionInfo.config?.params?.vectors
			let vectorDimension: number
			if (typeof vectorsConfig === "number") {
				vectorDimension = vectorsConfig
			} else if (
				vectorsConfig &&
				typeof vectorsConfig === "object" &&
				"size" in vectorsConfig &&
				typeof vectorsConfig.size === "number"
			) {
				vectorDimension = vectorsConfig.size
			} else {
				vectorDimension = this.vectorSize
			}

			return {
				totalVectors,
				uniqueFiles: uniqueFilesSet.size,
				vectorDimension,
			}
		} catch (error) {
			console.error("[QdrantVectorStore] Failed to get collection stats:", error)
			return null
		}
	}
}

export function generatePointId(segmentHash: string): string {
	const hex = segmentHash.replace(/-/g, "").toLowerCase()
	const base = hex.slice(0, 32).padEnd(32, "0")
	const sections = [
		base.slice(0, 8),
		base.slice(8, 12),
		base.slice(12, 16),
		base.slice(16, 20),
		base.slice(20, 32),
	]
	return sections.join("-")
}
