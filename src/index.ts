#!/usr/bin/env node

import process from "process"

import { rootLogger } from "./logger.js"
import { loadConfig, parseCliArgs, serializeConfig } from "./config.js"
import { WorkspaceIndexer } from "./indexer.js"

async function main() {
	try {
		const options = parseCliArgs(process.argv)
		const config = await loadConfig(options)

		if (options.printConfig) {
			console.log(serializeConfig(config))
		}

		const indexer = new WorkspaceIndexer(config)
		await indexer.initialize()
		await indexer.runInitialScan()

		if (options.once) {
			rootLogger.info("Completed initial scan in --once mode. Exiting.")
			await indexer.shutdown()
			process.exit(0)
		}

		await indexer.startWatcher()

		const shutdown = async () => {
			rootLogger.info("Received shutdown signal. Cleaning up...")
			await indexer.shutdown()
			process.exit(0)
		}

		process.on("SIGINT", shutdown)
		process.on("SIGTERM", shutdown)
	} catch (error) {
		rootLogger.error("Indexer failed", error)
		process.exit(1)
	}
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main()
