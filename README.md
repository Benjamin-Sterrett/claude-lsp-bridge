# claude-lsp-bridge

MCP server that wraps Language Server Protocol for Claude Code. Gives Claude access to go-to-definition, find-references, hover info, diagnostics, and symbol search — all through LSP.

## Prerequisites

- Node.js >= 22
- pnpm

Language servers for your project (install as needed):

```bash
# TypeScript/JavaScript
npm install -g typescript-language-server typescript

# Python
pip install pyright
```

## Installation

```bash
git clone https://github.com/benshph-blip/claude-lsp-bridge.git
cd claude-lsp-bridge
pnpm install
pnpm build
```

## Register with Claude Code

```bash
./scripts/register.sh              # global (user scope)
./scripts/register.sh --scope local # current project only
```

Or manually:

```bash
claude mcp add --scope user claude-lsp-bridge -- node /path/to/claude-lsp-bridge/dist/src/index.js
```

Restart Claude Code after registration.

## Configuration

The server needs a config file to know which language servers to use. It searches in order:

1. `LSP_CONFIG` environment variable (absolute path)
2. `lsp-config.local.json` in the working directory
3. `lsp-config.json` in the working directory
4. Auto-detection from project markers (`tsconfig.json`, `pyproject.toml`, etc.)

### Config format

```json
{
  "workspaceDir": "/path/to/your/project",
  "languageServers": [
    {
      "language": "typescript",
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"]
    },
    {
      "language": "python",
      "command": "pyright-langserver",
      "args": ["--stdio"],
      "extensions": [".py", ".pyi"]
    }
  ]
}
```

### Per-project setup

Option A — set `LSP_CONFIG` in your project's MCP config:

```bash
claude mcp add -e LSP_CONFIG=/path/to/project/lsp-config.json --scope project claude-lsp-bridge -- node /path/to/claude-lsp-bridge/dist/src/index.js
```

Option B — place `lsp-config.json` in your project root (auto-detected).

Option C — no config needed if your project has `tsconfig.json` or `pyproject.toml` (auto-detection kicks in).

## Tools

| Tool | Description |
|------|-------------|
| `find_definition` | Go to the definition of a symbol at a file position |
| `find_references` | Find all references to a symbol |
| `get_hover` | Get type information and documentation for a symbol |
| `get_diagnostics` | Get errors and warnings for a file |
| `find_symbol` | Search for symbols across the workspace by name |
| `list_file_symbols` | List all symbols in a file |

All positions are 1-based (line and character).

## Adding language servers

Add an entry to `languageServers` in your config:

```json
{
  "language": "go",
  "command": "gopls",
  "args": ["serve"],
  "extensions": [".go"]
}
```

Any LSP-compliant language server that supports stdio transport should work.

## Troubleshooting

**Language server not found**: Verify the command is in your PATH (`which typescript-language-server`). Install globally if needed.

**Initialization timeout (45s)**: Large projects may take time to index. The first query may be slow; subsequent queries use the cached language server.

**Empty diagnostics**: Call `get_diagnostics` with `waitMs: 2000` to give the server time to analyze. The tool returns a status field: `ready` means the server has finished indexing, `indexing` means results may be incomplete.

**Config not found**: Check `LSP_CONFIG` env var, or ensure `lsp-config.json` exists in the working directory. Run with `--experimental-strip-types` for dev mode to see stderr logs.

## Development

```bash
pnpm dev        # run in dev mode (no build needed)
pnpm test       # run tests
pnpm typecheck  # type check
pnpm build      # compile to dist/
```

## License

MIT
