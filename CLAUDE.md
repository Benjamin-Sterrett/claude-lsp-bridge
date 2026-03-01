# claude-lsp-bridge

MCP server wrapping Language Server Protocol for Claude Code.

## Session Start
Say: "resume lsp" — read .handoff.md, check Linear PRJ issues, continue.

## Tech Stack
| Component | Technology |
|-----------|-----------|
| Runtime | Node.js (compiled dist/ for production) |
| Package Manager | pnpm |
| MCP SDK | @modelcontextprotocol/sdk |
| LSP Protocol | vscode-jsonrpc + vscode-languageserver-protocol |
| Validation | zod |
| Testing | Node native test runner (node:test) |

## Development Workflow (v5.2)
Standard workflow applies. No database — skip SCHEMA-CHECK.

## Commands
```bash
pnpm test       # run tests
pnpm typecheck  # type check
pnpm build      # compile to dist/
pnpm start      # run production server
pnpm dev        # run dev server (experimental-strip-types)
```

## Prerequisites
```bash
npm install -g typescript-language-server typescript
pip install pyright
```
