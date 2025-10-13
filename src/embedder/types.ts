export interface EmbeddingResponse {
	embeddings: number[][]
}

export interface Embedder {
	createEmbeddings(texts: string[]): Promise<EmbeddingResponse>
	validateConfiguration(): Promise<void>
	dimension(): number
}
