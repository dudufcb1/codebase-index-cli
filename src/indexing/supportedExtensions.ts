export const SUPPORTED_EXTENSIONS = new Set<string>([
	".tla",
	".js",
	".jsx",
	".ts",
	".vue",
	".tsx",
	".py",
	".rs",
	".go",
	".c",
	".h",
	".cpp",
	".hpp",
	".cs",
	".rb",
	".java",
	".php",
	".swift",
	".sol",
	".kt",
	".kts",
	".ex",
  ".exs",
	".el",
	".html",
	".htm",
	".md",
	".markdown",
	".json",
	".css",
	".rdl",
	".ml",
	".mli",
	".lua",
	".scala",
	".toml",
	".zig",
	".elm",
	".ejs",
	".erb",
	".vb",
])

const FALLBACK_EXTENSIONS = new Set<string>([".vb", ".scala", ".swift"])

export function isSupportedExtension(ext: string): boolean {
	return SUPPORTED_EXTENSIONS.has(ext.toLowerCase())
}

export function shouldUseFallbackChunking(ext: string): boolean {
	return FALLBACK_EXTENSIONS.has(ext.toLowerCase())
}
