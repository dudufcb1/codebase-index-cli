#!/usr/bin/env node
/**
 * Copy WASM files to dist directory for tree-sitter
 */

import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.join(__dirname, "..")
const distDir = path.join(rootDir, "dist")

async function copyFile(src, dest) {
	try {
		await fs.copyFile(src, dest)
		return true
	} catch (error) {
		console.warn(`Failed to copy ${src}:`, error.message)
		return false
	}
}

async function copyWasms() {
	// Ensure dist directory exists
	await fs.mkdir(distDir, { recursive: true })

	let copiedCount = 0

	// Copy main tree-sitter WASM
	const treeSitterWasm = path.join(
		rootDir,
		"node_modules/web-tree-sitter/tree-sitter.wasm",
	)
	const treeSitterDest = path.join(distDir, "tree-sitter.wasm")
	if (await copyFile(treeSitterWasm, treeSitterDest)) {
		console.log("✓ Copied tree-sitter.wasm")
		copiedCount++
	}

	// Copy language WASMs
	const wasmsDir = path.join(rootDir, "node_modules/tree-sitter-wasms/out")
	try {
		const files = await fs.readdir(wasmsDir)
		const wasmFiles = files.filter((f) => f.endsWith(".wasm"))

		for (const file of wasmFiles) {
			const src = path.join(wasmsDir, file)
			const dest = path.join(distDir, file)
			if (await copyFile(src, dest)) {
				copiedCount++
			}
		}

		console.log(`✓ Copied ${wasmFiles.length} language WASMs`)
	} catch (error) {
		console.warn("Failed to copy language WASMs:", error.message)
	}

	console.log(`\nTotal: ${copiedCount} WASM files copied to dist/`)
}

copyWasms().catch((error) => {
	console.error("Error copying WASMs:", error)
	process.exit(1)
})

