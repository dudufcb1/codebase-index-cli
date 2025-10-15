import Database from "better-sqlite3"
import * as sqlite_vec from "sqlite-vec"
import { createHash } from "crypto"
import path from "path"
import fs from "fs"
import type { VectorStore, VectorStoreSearchResult } from "./interface.js"

const DEFAULT_MAX_SEARCH_RESULTS = 50
const DEFAULT_SEARCH_MIN_SCORE = 0.4

/**
 * SQLite-vec based vector store for local vector search.
 * Stores vectors in a local SQLite database using the sqlite-vec extension.
 *
 * Advantages:
 * - No external services required
 * - Portable (single .db file)
 * - Can be committed with the project
 *
 * Best for:
 * - Small to medium projects (<100k chunks)
 * - Local development
 * - Offline usage
 */
export class SqliteVecClient implements VectorStore {
	private db: Database.Database
	private vectorSize: number
	private readonly dbPath: string
	private readonly workspacePath: string
	private readonly tableName = "code_vectors"

	constructor(
		workspacePath: string,
		vectorSize: number,
		dbPath?: string,
	) {
		this.workspacePath = workspacePath
		this.vectorSize = vectorSize

		// Default to .codebase/vectors.db
		if (dbPath) {
			this.dbPath = dbPath
		} else {
			const codebaseDir = path.join(workspacePath, ".codebase")
			if (!fs.existsSync(codebaseDir)) {
				fs.mkdirSync(codebaseDir, { recursive: true })
			}
			this.dbPath = path.join(codebaseDir, "vectors.db")
		}

		// Initialize database
		this.db = new Database(this.dbPath)
		this.db.pragma("journal_mode = WAL")
		
		// Load sqlite-vec extension
		sqlite_vec.load(this.db)
	}

	/**
	 * Initialize the vector store.
	 * Creates the virtual table if it doesn't exist.
	 * Returns true if the table was created, false if it already existed.
	 */
	async initialize(): Promise<boolean> {
		let created = false

		try {
			// Check if table exists
			const tableExists = this.db
				.prepare(
					`SELECT name FROM sqlite_master WHERE type='table' AND name=?`
				)
				.get(this.tableName)

			if (!tableExists) {
				// Create virtual table using vec0
				this.db.exec(`
					CREATE VIRTUAL TABLE ${this.tableName} USING vec0(
						id TEXT PRIMARY KEY,
						embedding float[${this.vectorSize}],
						file_path TEXT NOT NULL,
						code_chunk TEXT NOT NULL,
						start_line INTEGER NOT NULL,
						end_line INTEGER NOT NULL,
						segment_hash TEXT
					)
				`)

				// Create indexes for faster filtering
				this.db.exec(`
					CREATE INDEX IF NOT EXISTS idx_file_path ON ${this.tableName}(file_path);
					CREATE INDEX IF NOT EXISTS idx_segment_hash ON ${this.tableName}(segment_hash);
				`)

				created = true
			} else {
				// Verify vector dimension matches
				const tableInfo = this.db.prepare(`PRAGMA table_info(${this.tableName})`).all() as any[]
				const embeddingColumn = tableInfo.find((col: any) => col.name === "embedding")
				
				if (embeddingColumn) {
					// Extract dimension from type like "float[4096]"
					const match = embeddingColumn.type.match(/float\[(\d+)\]/)
					if (match) {
						const existingDimension = parseInt(match[1], 10)
						if (existingDimension !== this.vectorSize) {
							console.warn(
								`[SqliteVecClient] Table ${this.tableName} has dimension ${existingDimension}, expected ${this.vectorSize}. Recreating.`
							)
							await this.resetCollection()
							created = true
						}
					}
				}
			}

			return created
		} catch (error: any) {
			console.error(`[SqliteVecClient] Failed to initialize database:`, error.message)
			throw new Error(`Failed to initialize SQLite vector store: ${error.message}`)
		}
	}

	/**
	 * Reset the collection by dropping and recreating the table.
	 */
	async resetCollection(): Promise<void> {
		try {
			this.db.exec(`DROP TABLE IF EXISTS ${this.tableName}`)
			await this.initialize()
		} catch (error: any) {
			console.error(`[SqliteVecClient] Failed to reset collection:`, error.message)
			throw error
		}
	}

	/**
	 * Upsert points into the vector store.
	 * Uses INSERT OR REPLACE to handle both inserts and updates.
	 */
	async upsertPoints(
		points: Array<{
			id: string
			vector: number[]
			payload: Record<string, any>
		}>,
	): Promise<void> {
		if (points.length === 0) {
			return
		}

		try {
			const stmt = this.db.prepare(`
				INSERT OR REPLACE INTO ${this.tableName} 
				(id, embedding, file_path, code_chunk, start_line, end_line, segment_hash)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`)

			const insertMany = this.db.transaction((points: any[]) => {
				for (const point of points) {
					// Convert vector to JSON string for storage
					const vectorJson = JSON.stringify(point.vector)
					
					stmt.run(
						point.id,
						vectorJson,
						point.payload.filePath || "",
						point.payload.codeChunk || "",
						point.payload.startLine || 0,
						point.payload.endLine || 0,
						point.payload.segmentHash || null,
					)
				}
			})

			insertMany(points)
		} catch (error: any) {
			console.error("[SqliteVecClient] Failed to upsert points:", error.message)
			throw error
		}
	}

	/**
	 * Search for similar vectors using KNN.
	 * 
	 * @param queryVector - The query vector to search for
	 * @param directoryPrefix - Optional directory prefix to filter results
	 * @param minScore - Minimum similarity score (0-1, higher is better)
	 * @param maxResults - Maximum number of results to return
	 */
	async search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]> {
		try {
			const limit = maxResults ?? DEFAULT_MAX_SEARCH_RESULTS
			const scoreThreshold = minScore ?? DEFAULT_SEARCH_MIN_SCORE

			// Convert query vector to JSON for sqlite-vec
			const queryVectorJson = JSON.stringify(queryVector)

			let query = `
				SELECT 
					id,
					file_path,
					code_chunk,
					start_line,
					end_line,
					segment_hash,
					distance
				FROM ${this.tableName}
				WHERE embedding MATCH ?
			`

			const params: any[] = [queryVectorJson]

			// Add directory prefix filter if provided
			if (directoryPrefix && directoryPrefix !== "." && directoryPrefix !== "./") {
				const normalizedPrefix = path.posix.normalize(directoryPrefix.replace(/\\/g, "/"))
				const cleanedPrefix = normalizedPrefix.startsWith("./") 
					? normalizedPrefix.slice(2) 
					: normalizedPrefix

				if (cleanedPrefix) {
					query += ` AND file_path LIKE ?`
					params.push(`${cleanedPrefix}%`)
				}
			}

			query += ` ORDER BY distance LIMIT ?`
			params.push(limit)

			const stmt = this.db.prepare(query)
			const rows = stmt.all(...params) as any[]

			// Convert distance to similarity score (1 - distance for cosine)
			// Filter by score threshold
			const results: VectorStoreSearchResult[] = rows
				.map((row) => {
					// sqlite-vec returns distance, convert to similarity score
					// For cosine distance: similarity = 1 - distance
					const score = 1 - row.distance

					return {
						id: row.id,
						score,
						payload: {
							filePath: row.file_path,
							codeChunk: row.code_chunk,
							startLine: row.start_line,
							endLine: row.end_line,
							segmentHash: row.segment_hash,
						},
					}
				})
				.filter((result) => result.score >= scoreThreshold)

			return results
		} catch (error: any) {
			console.error("[SqliteVecClient] Failed to search:", error.message)
			throw error
		}
	}

	/**
	 * Delete points by file path.
	 */
	async deletePointsByFilePath(filePath: string): Promise<void> {
		await this.deletePointsByMultipleFilePaths([filePath])
	}

	/**
	 * Delete points by multiple file paths.
	 */
	async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) {
			return
		}

		try {
			const workspaceRoot = this.workspacePath
			const normalizedPaths = filePaths.map((filePath) => {
				const relativePath = path.isAbsolute(filePath) 
					? path.relative(workspaceRoot, filePath) 
					: filePath
				return path.normalize(relativePath)
			})

			const placeholders = normalizedPaths.map(() => "?").join(",")
			const stmt = this.db.prepare(`
				DELETE FROM ${this.tableName}
				WHERE file_path IN (${placeholders})
			`)

			stmt.run(...normalizedPaths)
		} catch (error: any) {
			console.error("[SqliteVecClient] Failed to delete points:", error.message)
		}
	}

	/**
	 * Delete the entire collection (drop table).
	 */
	async deleteCollection(): Promise<void> {
		try {
			this.db.exec(`DROP TABLE IF EXISTS ${this.tableName}`)
		} catch (error: any) {
			console.error("[SqliteVecClient] Failed to delete collection:", error.message)
			throw error
		}
	}

	/**
	 * Clear all points from the collection.
	 */
	async clearCollection(): Promise<void> {
		try {
			this.db.exec(`DELETE FROM ${this.tableName}`)
		} catch (error: any) {
			console.error("[SqliteVecClient] Failed to clear collection:", error.message)
			throw error
		}
	}

	/**
	 * Check if the collection exists.
	 */
	async collectionExists(): Promise<boolean> {
		const result = this.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name=?`
			)
			.get(this.tableName)
		return result !== undefined
	}

	/**
	 * Ensure vector dimension matches.
	 * If not, recreate the collection.
	 */
	async ensureVectorDimension(actualDimension: number): Promise<void> {
		if (actualDimension === this.vectorSize) {
			return
		}

		console.warn(
			`[SqliteVecClient] Adjusting vector dimension from ${this.vectorSize} to ${actualDimension}.`
		)

		this.vectorSize = actualDimension
		await this.resetCollection()
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		this.db.close()
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

