#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${ROO_INDEX_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${ROO_INDEX_CONFIG_DIR:-$HOME/.config/roo-index-cli}"

if ! command -v pnpm >/dev/null 2>&1; then
	echo "pnpm no está instalado. Instálalo (https://pnpm.io/installation) y vuelve a intentarlo." >&2
	exit 1
fi

mkdir -p "$BIN_DIR"
mkdir -p "$CONFIG_DIR"

echo "Instalando dependencias de la CLI..."
pnpm install --filter roo-index-cli... --prod

echo "Compilando CLI..."
pnpm run build

create_wrapper() {
	local name="$1"
	local target="$BIN_DIR/$name"
	cat >"$target" <<EOF
#!/usr/bin/env bash
NODE_BIN="\$(command -v node)"
if [ -z "\$NODE_BIN" ]; then
	echo "No se encontró 'node' en el PATH." >&2
	exit 1
fi
exec "\$NODE_BIN" "$REPO_DIR/dist/index.js" "\$@"
EOF
	chmod +x "$target"
}

create_wrapper "codebase"
# Compatibilidad con instalaciones previas
create_wrapper "roo-index"

if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
	echo
	echo "Agrega $BIN_DIR a tu PATH (por ejemplo añadiendo 'export PATH=\"$BIN_DIR:\$PATH\"' a tu ~/.bashrc)."
fi

echo
echo "Instalación completada. Ya puedes ejecutar:"
echo "  codebase -start ."
echo "(El binario 'roo-index' sigue disponible por compatibilidad)."
