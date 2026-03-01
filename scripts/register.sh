#!/usr/bin/env bash
set -euo pipefail

# Register claude-lsp-bridge as an MCP server for Claude Code.
#
# Usage:
#   ./scripts/register.sh              # register globally (user scope)
#   ./scripts/register.sh --scope local # register for current project only

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_ENTRY="$PROJECT_DIR/dist/src/index.js"

# Verify the build exists
if [ ! -f "$SERVER_ENTRY" ]; then
  echo "Error: dist/src/index.js not found. Run 'pnpm build' first." >&2
  exit 1
fi

# Parse scope argument (default: user)
SCOPE="user"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      if [ $# -lt 2 ]; then
        echo "Error: --scope requires a value (local, user, or project)" >&2
        exit 1
      fi
      SCOPE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--scope local|user|project]" >&2
      exit 1
      ;;
  esac
done

echo "Registering claude-lsp-bridge (scope: $SCOPE)..."
claude mcp add --scope "$SCOPE" claude-lsp-bridge -- node "$SERVER_ENTRY"
echo "Done. Restart Claude Code to pick up the new MCP server."
echo ""
echo "Per-project config: set LSP_CONFIG env var to your lsp-config.json path,"
echo "or place lsp-config.json in your project root for auto-detection."
