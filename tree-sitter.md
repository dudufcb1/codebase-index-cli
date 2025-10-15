# Tree-Sitter Implementation - Complete End-to-End Documentation

## Overview

This project uses **tree-sitter** for parsing source code files across multiple programming languages. The implementation leverages WASM binaries for cross-platform compatibility and integrates with the codebase indexing system.

## Architecture Components

### 1. Core Libraries

#### Dependencies (from `src/package.json`)
```json
{
  "tree-sitter-wasms": "^0.1.12",
  "web-tree-sitter": "^0.25.6"
}
```

- **web-tree-sitter**: JavaScript bindings for tree-sitter (WASM-based)
- **tree-sitter-wasms**: Pre-built WASM binaries for language grammars

### 2. Directory Structure

```
src/services/tree-sitter/
├── index.ts                    # Main API entry point
├── languageParser.ts           # Language parser loader
├── markdownParser.ts           # Custom markdown parser
├── queries/                    # Tree-sitter query definitions
│   ├── index.ts               # Query exports
│   ├── tsx.ts                 # React/TSX queries
│   ├── python.ts              # Python queries
│   ├── javascript.ts          # JavaScript queries
│   ├── typescript.ts          # TypeScript queries
│   ├── rust.ts                # Rust queries
│   ├── go.ts                  # Go queries
│   ├── c.ts                   # C queries
│   ├── c-sharp.ts             # C# queries
│   ├── cpp.ts                 # C++ queries
│   ├── php.ts                 # PHP queries
│   ├── swift.ts               # Swift queries
│   ├── css.ts                 # CSS queries
│   └── ... (30+ languages)
└── __tests__/                 # Comprehensive test suite
```

## Core Implementation

### 3. Main API (`src/services/tree-sitter/index.ts`)

#### Supported Languages (Extensions)
```typescript
const extensions = [
  "tla", "js", "jsx", "ts", "tsx", "vue", "py", "rs", "go",
  "c", "h", "cpp", "hpp", "cs", "rb", "java", "php", "swift",
  "sol", "kt", "kts", "ex", "exs", "el", "html", "htm",
  "md", "markdown", "json", "css", "rdl", "ml", "mli",
  "lua", "scala", "toml", "zig", "elm", "ejs", "erb", "vb"
].map(e => `.${e}`)
```

#### Key Functions

##### `parseSourceCodeDefinitionsForFile(filePath, rooIgnoreController?)`
**Purpose**: Parse a single file and extract code definitions.

**Returns**: Formatted string with definition names and line ranges:
```
# filename.py
10--25 | class MyClass:
40--60 | def my_function():
```

**Process**:
1. Check file existence
2. Validate extension is supported
3. Special handling for markdown (custom parser)
4. For code files: load parser → parse → extract definitions
5. Format output with file-relative line ranges

##### `parseSourceCodeForDefinitionsTopLevel(dirPath, rooIgnoreController?)`
**Purpose**: Parse all supported files in a directory (top-level, max 50 files).

**Process**:
1. List files using `listFiles()` (respects .gitignore)
2. Separate markdown vs other files
3. Load parsers for non-markdown files in batch
4. Process each file and accumulate results
5. Return concatenated definitions

**Respects**: `.rooignore` patterns via `RooIgnoreController`

### 4. Language Parser Loader (`src/services/tree-sitter/languageParser.ts`)

#### Key Function: `loadRequiredLanguageParsers(filesToParse, sourceDirectory?)`

**Purpose**: Dynamically load WASM parsers only for required languages.

**Process**:
```typescript
1. Initialize Parser (one-time setup)
   await Parser.init()

2. Extract unique file extensions
   const extensions = filesToParse.map(file => path.extname(file))

3. For each extension:
   - Map extension to language name (e.g., .py → python)
   - Load WASM grammar: await Language.load('tree-sitter-{lang}.wasm')
   - Create Query object with language-specific query string
   - Create Parser instance and set language
   - Store in parsers object: { [ext]: { parser, query } }

4. Return LanguageParser map
```

#### Language Mapping Examples
```typescript
switch (ext) {
  case "js":
  case "jsx":
  case "json":
    language = await loadLanguage("javascript", sourceDirectory)
    query = new Query(language, javascriptQuery)
    break

  case "py":
    language = await loadLanguage("python", sourceDirectory)
    query = new Query(language, pythonQuery)
    break

  case "tsx":
    language = await loadLanguage("tsx", sourceDirectory)
    query = new Query(language, tsxQuery)
    break

  // ... 30+ languages
}
```

#### Why WASM?
From code comments:
```
Using node bindings for tree-sitter is problematic in vscode extensions
because of incompatibility with electron. Going the .wasm route has the
advantage of not having to build for multiple architectures.
```

### 5. Query Definitions (`src/services/tree-sitter/queries/`)

#### Query Purpose
Tree-sitter queries use S-expression patterns to identify code constructs (functions, classes, interfaces, etc.).

#### Example: Python Query (`queries/python.ts`)
```typescript
export default `
; Class definitions (including decorated)
(class_definition
  name: (identifier) @name.definition.class) @definition.class

; Function definitions
(function_definition
  name: (identifier) @name.definition.function) @definition.function

; Lambda expressions
(expression_statement
  (assignment
    left: (identifier) @name.definition.lambda
    right: (parenthesized_expression
      (lambda)))) @definition.lambda

; Imports
(import_from_statement) @definition.import
(import_statement) @definition.import
`
```

#### Example: TSX Query (`queries/tsx.ts`)
```typescript
export default `${typescriptQuery}

; Function Components
(function_declaration
  name: (identifier) @name) @definition.component

; Arrow Function Components
(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.component

; Class Components
(class_declaration
  name: (type_identifier) @name) @definition.class_component

; Interface Declarations
(interface_declaration
  name: (type_identifier) @name) @definition.interface
`
```

**Note**: TSX query extends TypeScript query (composition pattern)

### 6. Markdown Parser (`src/services/tree-sitter/markdownParser.ts`)

**Why Custom Parser?**
Markdown doesn't have tree-sitter grammar, so custom regex-based parser mimics tree-sitter capture structure.

#### Function: `parseMarkdown(content)`

**Returns**: Array of `QueryCapture` compatible objects

**Process**:
```typescript
1. Parse ATX headers (# Header)
   const atxHeaderRegex = /^(#{1,6})\s+(.+)$/

2. Parse Setext headers (underlined)
   const setextH1Regex = /^={3,}\s*$/
   const setextH2Regex = /^-{3,}\s*$/

3. For each header:
   - Create mock node with startPosition/endPosition
   - Create two captures:
     * name.definition.header.hN (for identifier)
     * definition.header.hN (for range)

4. Calculate section ranges:
   - Section ends where next header starts
   - Last section extends to EOF

5. Return captures compatible with tree-sitter format
```

#### Output Format
```typescript
interface MockCapture {
  node: {
    startPosition: { row: number }
    endPosition: { row: number }
    text: string
  }
  name: string  // e.g., "name.definition.header.h2"
  patternIndex: number
}
```

### 7. Processing Captures (`processCaptures()`)

**Location**: `src/services/tree-sitter/index.ts`

**Purpose**: Convert tree-sitter captures to formatted output

**Process**:
```typescript
1. Filter captures to only include definitions
   if (!name.includes("definition") && !name.includes("name")) return

2. For each capture:
   - Get parent node containing full definition
   - Calculate line span (endLine - startLine + 1)
   - Skip if < MIN_COMPONENT_LINES (default: 4)
   - Deduplicate using line ranges

3. Special handling for TSX/JSX:
   - Filter out HTML elements (<div>, <span>, etc.)
   - Only include React components (PascalCase)

4. Format output:
   startLine--endLine | first_line_of_code

5. Return concatenated string
```

#### Configuration
```typescript
const DEFAULT_MIN_COMPONENT_LINES_VALUE = 4

// Testing support
export function setMinComponentLines(value: number)
export function getMinComponentLines(): number
```

## Integration Points

### 8. Code Indexing Integration (`src/services/code-index/processors/parser.ts`)

#### Class: `CodeParser implements ICodeParser`

**Purpose**: Parse files into semantic code blocks for vector indexing

**Key Method**: `parseFile(filePath, options?)`

**Process**:
```typescript
1. Check if extension is supported
   if (!scannerExtensions.includes(ext)) return []

2. Read file content + calculate hash
   const content = await readFile(filePath, "utf8")
   const fileHash = createHash("sha256").update(content).digest("hex")

3. Special cases:
   a) Markdown files → parseMarkdownContent()
   b) Fallback extensions → _performFallbackChunking()

4. For code files:
   - Load parser if not cached
   - Parse content → AST
   - Execute query → captures
   - Process nodes:
     * If node > MAX_CHARS: break down or chunk
     * If node >= MIN_CHARS: create CodeBlock
     * Extract identifier, type, line range

5. Return CodeBlock[]
```

#### CodeBlock Structure
```typescript
interface CodeBlock {
  file_path: string
  identifier: string | null      // Function/class name
  type: string                    // AST node type
  start_line: number             // 1-based
  end_line: number               // 1-based
  content: string                // Full text
  segmentHash: string            // Deduplication hash
  fileHash: string               // File version hash
}
```

#### Constants
```typescript
const MIN_BLOCK_CHARS = 200
const MAX_BLOCK_CHARS = 1500
const MAX_CHARS_TOLERANCE_FACTOR = 1.5
const MIN_CHUNK_REMAINDER_CHARS = 300
```

### 9. Tool Integration (`src/core/tools/listCodeDefinitionNamesTool.ts`)

**Purpose**: Expose tree-sitter parsing to LLM tools

**Usage in AI Context**:
```typescript
// Tool invocation
{
  tool: "list_code_definition_names",
  path: "./src/services"
}

// Response
# service.py
10--30 | class UserService:
50--75 | def create_user():
```

**Process**:
1. Resolve path (relative → absolute)
2. Check if file or directory
3. If file: `parseSourceCodeDefinitionsForFile()`
4. If directory: `parseSourceCodeForDefinitionsTopLevel()`
5. Track file access via `fileContextTracker`
6. Return formatted definitions

### 10. Build System Integration (`packages/build/src/esbuild.ts`)

#### Function: `copyWasms(srcDir, distDir)`

**Purpose**: Copy WASM binaries to distribution folder

**Process**:
```typescript
1. Copy tiktoken WASM
   node_modules/tiktoken/lite/tiktoken_bg.wasm → dist/

2. Copy main tree-sitter WASM
   node_modules/web-tree-sitter/tree-sitter.wasm → dist/

3. Copy language-specific WASMs
   node_modules/tree-sitter-wasms/out/*.wasm → dist/

   Languages include:
   - tree-sitter-javascript.wasm
   - tree-sitter-python.wasm
   - tree-sitter-typescript.wasm
   - tree-sitter-tsx.wasm
   - tree-sitter-rust.wasm
   - ... (35+ total)
```

**Console Output**:
```
[copyWasms] Copied tiktoken WASMs to dist/
[copyWasms] Copied tree-sitter.wasm to dist/
[copyWasms] Copied 35 tree-sitter language wasms to dist/
```

### 11. WASM File Locations

#### Development
```
node_modules/
├── web-tree-sitter/
│   └── tree-sitter.wasm
└── tree-sitter-wasms/
    └── out/
        ├── tree-sitter-javascript.wasm
        ├── tree-sitter-python.wasm
        ├── tree-sitter-tsx.wasm
        └── ... (35+ files)
```

#### Production (after build)
```
src/dist/
├── tree-sitter.wasm
├── tree-sitter-javascript.wasm
├── tree-sitter-python.wasm
├── tree-sitter-tsx.wasm
└── ... (35+ files)
```

## Usage Examples

### Example 1: Parse Single File
```typescript
import { parseSourceCodeDefinitionsForFile } from './services/tree-sitter'

const result = await parseSourceCodeDefinitionsForFile('./src/main.py')
console.log(result)
/*
# main.py
5--15 | class Application:
20--30 | def initialize():
35--50 | async def run():
*/
```

### Example 2: Parse Directory
```typescript
import { parseSourceCodeForDefinitionsTopLevel } from './services/tree-sitter'

const result = await parseSourceCodeForDefinitionsTopLevel('./src')
console.log(result)
/*
# utils.py
10--20 | def helper():

# service.py
5--30 | class DataService:
40--60 | def fetch_data():
*/
```

### Example 3: Custom Language Loading
```typescript
import { loadRequiredLanguageParsers } from './services/tree-sitter/languageParser'

const files = ['app.py', 'config.js', 'main.rs']
const parsers = await loadRequiredLanguageParsers(files)

// parsers = {
//   py: { parser: Parser, query: Query },
//   js: { parser: Parser, query: Query },
//   rs: { parser: Parser, query: Query }
// }

const tree = parsers.py.parser.parse(pythonCode)
const captures = parsers.py.query.captures(tree.rootNode)
```

### Example 4: Code Indexing
```typescript
import { CodeParser } from './services/code-index/processors/parser'

const parser = new CodeParser()
const blocks = await parser.parseFile('./src/app.ts')

blocks.forEach(block => {
  console.log(`${block.identifier} (${block.type})`)
  console.log(`  Lines: ${block.start_line}-${block.end_line}`)
  console.log(`  Hash: ${block.segmentHash}`)
})
```

## Testing

### Test Structure
```
src/services/tree-sitter/__tests__/
├── languageParser.spec.ts           # Parser loading tests
├── markdownIntegration.spec.ts      # Markdown parsing
├── parseSourceCodeDefinitions.*.spec.ts  # Per-language tests
│   ├── parseSourceCodeDefinitions.python.spec.ts
│   ├── parseSourceCodeDefinitions.tsx.spec.ts
│   ├── parseSourceCodeDefinitions.rust.spec.ts
│   └── ... (30+ language tests)
├── inspect*.spec.ts                 # AST inspection tests
└── fixtures/                        # Test data
```

### Example Test
```typescript
// languageParser.spec.ts
describe("loadRequiredLanguageParsers", () => {
  const WASM_DIR = path.join(__dirname, "../../../node_modules/tree-sitter-wasms/out")

  it("should load Python parser for .py files", async () => {
    const files = ["test.py"]
    const parsers = await loadRequiredLanguageParsers(files, WASM_DIR)
    expect(parsers.py).toBeDefined()
  })

  it("should load multiple language parsers", async () => {
    const files = ["test.js", "test.py", "test.rs"]
    const parsers = await loadRequiredLanguageParsers(files, WASM_DIR)
    expect(parsers.js).toBeDefined()
    expect(parsers.py).toBeDefined()
    expect(parsers.rs).toBeDefined()
  })
})
```

## Key Design Patterns

### 1. Lazy Loading
Parsers are loaded on-demand based on file extensions to minimize memory footprint.

### 2. Singleton Pattern
```typescript
export const codeParser = new CodeParser()
```

### 3. Adapter Pattern
`markdownParser.ts` adapts regex-based parsing to tree-sitter's capture interface.

### 4. Strategy Pattern
Different chunking strategies based on file type:
- Tree-sitter parsing for code
- Custom parsing for markdown
- Fallback line-based chunking for unsupported formats

### 5. Caching
- Loaded parsers cached in `CodeParser.loadedParsers`
- Pending loads tracked to avoid duplicate loading
- File hashes for deduplication

## Performance Considerations

### 1. Batch Loading
```typescript
// Good: Load all parsers once
const parsers = await loadRequiredLanguageParsers(allFiles)

// Bad: Load parser per file
for (const file of files) {
  await loadRequiredLanguageParsers([file])  // Redundant loads
}
```

### 2. WASM Initialization
```typescript
// One-time global initialization
let isParserInitialized = false
if (!isParserInitialized) {
  await Parser.init()
  isParserInitialized = true
}
```

### 3. Chunking Strategy
- MIN_BLOCK_CHARS (200): Avoid indexing trivial snippets
- MAX_BLOCK_CHARS (1500): Keep chunks digestible for LLMs
- Tolerance factor (1.5x): Balance strict limits with context preservation

### 4. Deduplication
```typescript
const seenSegmentHashes = new Set<string>()
const segmentHash = createHash("sha256")
  .update(`${filePath}-${start_line}-${end_line}-${length}-${preview}`)
  .digest("hex")

if (!seenSegmentHashes.has(segmentHash)) {
  seenSegmentHashes.add(segmentHash)
  // Process block
}
```

## Migration/Porting Guide

If you're moving this to another project, you need:

### 1. NPM Dependencies
```bash
npm install web-tree-sitter@^0.25.6
npm install tree-sitter-wasms@^0.1.12
```

### 2. Copy Directory Structure
```
src/services/tree-sitter/
├── index.ts
├── languageParser.ts
├── markdownParser.ts
└── queries/
    ├── index.ts
    └── [all query files]
```

### 3. Build Configuration
Add WASM copying to your build process:
```typescript
import { copyWasms } from './build-utils'

copyWasms('./src', './dist')
```

### 4. Update Import Paths
Adjust paths based on your project structure:
```typescript
// From
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"

// To (your structure)
import { parseSourceCodeDefinitionsForFile } from "@/lib/tree-sitter"
```

### 5. Optional: RooIgnore Integration
If you don't need `.rooignore` support, remove the `rooIgnoreController` parameter:
```typescript
// Simplified version
export async function parseSourceCodeDefinitionsForFile(
  filePath: string
): Promise<string | undefined>
```

### 6. Testing
Copy test directory and adjust WASM paths:
```typescript
const WASM_DIR = path.join(__dirname, "../../../node_modules/tree-sitter-wasms/out")
```

## Troubleshooting

### Issue 1: "Cannot find WASM file"
**Solution**: Ensure WASMs are copied during build:
```bash
# Check if WASMs exist
ls dist/*.wasm

# Re-run build
npm run bundle
```

### Issue 2: "Unsupported language"
**Solution**: Add language to `languageParser.ts`:
```typescript
case "your_ext":
  language = await loadLanguage("your_language", sourceDirectory)
  query = new Query(language, yourQuery)
  break
```

### Issue 3: Parser initialization error
**Solution**: Check WASM path resolution:
```typescript
const wasmPath = path.join(__dirname, `tree-sitter-${langName}.wasm`)
console.log('Loading WASM from:', wasmPath)
```

### Issue 4: Empty captures
**Solution**:
1. Check query syntax (test on [AST explorer](https://astexplorer.net/))
2. Verify MIN_COMPONENT_LINES threshold
3. Check if file content is valid syntax

## References

### Documentation
- [Tree-sitter docs](https://tree-sitter.github.io/)
- [Web bindings](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md)
- [Query syntax](https://tree-sitter.github.io/tree-sitter/using-parsers#query-syntax)
- [Code navigation](https://tree-sitter.github.io/tree-sitter/code-navigation-systems)

### Related Issues
- [Node bindings + Electron incompatibility](https://github.com/tree-sitter/node-tree-sitter/issues/169)
- [WASM bindings](https://github.com/tree-sitter/node-tree-sitter/issues/168)

### Package Sources
- [tree-sitter-wasms](https://github.com/Gregoor/tree-sitter-wasms)
- [web-tree-sitter NPM](https://www.npmjs.com/package/web-tree-sitter)

## Summary

This implementation provides:
- **35+ language support** via tree-sitter WASM binaries
- **Custom markdown parsing** with tree-sitter-compatible interface
- **Code indexing integration** for semantic search
- **LLM tool integration** for AI-assisted development
- **Comprehensive test coverage** with language-specific tests
- **Cross-platform compatibility** via WASM (no native compilation)
- **Lazy loading** for performance optimization
- **Flexible chunking** strategies for different file types

The design is modular, testable, and production-ready for VSCode extension environments.
