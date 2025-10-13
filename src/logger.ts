/* eslint-disable no-console */

type LogLevel = "debug" | "info" | "warn" | "error"

export class Logger {
	constructor(private namespace: string, private level: LogLevel = "info") {}

	setLevel(level: LogLevel) {
		this.level = level
	}

	private shouldLog(level: LogLevel): boolean {
		const order: Record<LogLevel, number> = {
			debug: 10,
			info: 20,
			warn: 30,
			error: 40,
		}
		return order[level] >= order[this.level]
	}

	debug(message: string, ...args: unknown[]) {
		if (this.shouldLog("debug")) {
			console.debug(`[${this.namespace}] ${message}`, ...args)
		}
	}

	info(message: string, ...args: unknown[]) {
		if (this.shouldLog("info")) {
			console.info(`[${this.namespace}] ${message}`, ...args)
		}
	}

	warn(message: string, ...args: unknown[]) {
		if (this.shouldLog("warn")) {
			console.warn(`[${this.namespace}] ${message}`, ...args)
		}
	}

	error(message: string, ...args: unknown[]) {
		if (this.shouldLog("error")) {
			console.error(`[${this.namespace}] ${message}`, ...args)
		}
	}
}

export const rootLogger = new Logger("roo-index-cli", "info")
