/* eslint-disable no-console */

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
}

export class Logger {
	private static globalLevel: LogLevel = "info"
	private levelOverride: LogLevel | null

	constructor(private namespace: string, level?: LogLevel) {
		this.levelOverride = level ?? null
	}

	static setGlobalLevel(level: LogLevel) {
		Logger.globalLevel = level
	}

	static getGlobalLevel(): LogLevel {
		return Logger.globalLevel
	}

	setLevel(level: LogLevel) {
		this.levelOverride = level
	}

	private effectiveLevel(): LogLevel {
		return this.levelOverride ?? Logger.globalLevel
	}

	private shouldLog(level: LogLevel): boolean {
		return LEVEL_ORDER[level] >= LEVEL_ORDER[this.effectiveLevel()]
	}

	private formatMessage(message: string): string {
		const timestamp = new Date().toISOString()
		return `${timestamp} [${this.namespace}] ${message}`
	}

	debug(message: string, ...args: unknown[]) {
		if (this.shouldLog("debug")) {
			console.debug(this.formatMessage(message), ...args)
		}
	}

	info(message: string, ...args: unknown[]) {
		if (this.shouldLog("info")) {
			console.info(this.formatMessage(message), ...args)
		}
	}

	warn(message: string, ...args: unknown[]) {
		if (this.shouldLog("warn")) {
			console.warn(this.formatMessage(message), ...args)
		}
	}

	error(message: string, ...args: unknown[]) {
		if (this.shouldLog("error")) {
			console.error(this.formatMessage(message), ...args)
		}
	}
}

export function parseLogLevel(value: string): LogLevel {
	const normalized = value.toLowerCase()
	if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
		return normalized
	}
	throw new Error(`Invalid log level "${value}". Expected one of: debug, info, warn, error`)
}

export const rootLogger = new Logger("codebase-index-cli")
