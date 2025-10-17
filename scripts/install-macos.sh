#!/usr/bin/env bash
# macOS installation script
# Run with: ./scripts/install-macos.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${CODEBASE_INDEX_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${CODEBASE_INDEX_CONFIG_DIR:-$HOME/Library/Application Support/codebase-index-cli}"

if ! command -v pnpm >/dev/null 2>&1; then
	echo "pnpm is not installed. Install it from https://pnpm.io/installation and try again." >&2
	exit 1
fi

mkdir -p "$BIN_DIR"
mkdir -p "$CONFIG_DIR"

echo "Installing CLI dependencies..."
cd "$REPO_DIR"
pnpm install

echo "Building CLI..."
pnpm run build

create_wrapper() {
	local name="$1"
	local target="$BIN_DIR/$name"
	cat >"$target" <<EOF
#!/usr/bin/env bash
NODE_BIN="\$(command -v node)"
if [ -z "\$NODE_BIN" ]; then
	echo "Node.js not found in PATH." >&2
	exit 1
fi
exec "\$NODE_BIN" "$REPO_DIR/dist/index.js" "\$@"
EOF
	chmod +x "$target"
	echo "Created: $target"
}

create_wrapper_with_env() {
	local name="$1"
	local env_var="$2"
	local env_value="$3"
	local target="$BIN_DIR/$name"
	cat >"$target" <<EOF
#!/usr/bin/env bash
NODE_BIN="\$(command -v node)"
if [ -z "\$NODE_BIN" ]; then
	echo "Node.js not found in PATH." >&2
	exit 1
fi
export $env_var="$env_value"
exec "\$NODE_BIN" "$REPO_DIR/dist/index.js" "\$@"
EOF
	chmod +x "$target"
	echo "Created: $target"
}

# Backward compatibility wrapper
create_wrapper "codebase-index"

# codebase always uses Qdrant
create_wrapper_with_env "codebase" "VECTOR_STORE" "qdrant"

# codesql always uses SQLite-vec
create_wrapper_with_env "codesql" "VECTOR_STORE" "sqlite"

if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
	echo
	echo "IMPORTANT: Add $BIN_DIR to your PATH."
	echo
	echo "For zsh (default on macOS):"
	echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc"
	echo "  source ~/.zshrc"
	echo
	echo "For bash:"
	echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bash_profile"
	echo "  source ~/.bash_profile"
fi

echo
echo "Installation completed! You can now run:"
echo "  codebase -start .    # Uses Qdrant vector store"
echo "  codesql -start .     # Uses SQLite-vec (local database)"
echo "(The 'codebase-index' command is also available for compatibility)."
