/**
 * Common interface for vector stores.
 * Both QdrantVectorStore and SqliteVecClient implement this interface.
 */

export interface VectorStoreSearchResult {
	id: string
	score: number
	vector?: number[]
	payload: {
		filePath: string
		codeChunk: string
		startLine: number
		endLine: number
		segmentHash?: string
	}
}

export interface VectorStoreInitResult {
	created: boolean
	didCleanup: boolean
}

export interface VectorStore {
	/**
	 * Initialize the vector store.
	 * Creates collection/table if it doesn't exist.
	 * Returns initialization result with created and cleanup flags.
	 */
	initialize(): Promise<VectorStoreInitResult>

	/**
	 * Reset the collection by dropping and recreating it.
	 */
	resetCollection(): Promise<void>

	/**
	 * Upsert points into the vector store.
	 */
	upsertPoints(
		points: Array<{
			id: string
			vector: number[]
			payload: Record<string, any>
		}>,
	): Promise<void>

	/**
	 * Search for similar vectors.
	 * 
	 * @param queryVector - The query vector to search for
	 * @param directoryPrefix - Optional directory prefix to filter results
	 * @param minScore - Minimum similarity score (0-1, higher is better)
	 * @param maxResults - Maximum number of results to return
	 */
	search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]>

	/**
	 * Delete points by file path.
	 */
	deletePointsByFilePath(filePath: string): Promise<void>

	/**
	 * Delete points by multiple file paths.
	 */
	deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void>

	/**
	 * Delete the entire collection.
	 */
	deleteCollection(): Promise<void>

	/**
	 * Clear all points from the collection.
	 */
	clearCollection(): Promise<void>

	/**
	 * Check if the collection exists.
	 */
	collectionExists(): Promise<boolean>

	/**
	 * Ensure vector dimension matches.
	 * If not, recreate the collection.
	 */
	ensureVectorDimension(actualDimension: number): Promise<void>

	/**
	 * Get collection statistics.
	 * Returns total vectors, unique files, and vector dimension.
	 */
	getCollectionStats?(): Promise<{
		totalVectors: number
		uniqueFiles: number
		vectorDimension: number
	} | null>
}

/**
 * Generate a point ID from a segment hash.
 * This function is used by both vector stores to ensure consistent IDs.
 */
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

