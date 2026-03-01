# Codex Review Instructions

Review code changes for this MCP server project (claude-lsp-bridge).

## Output Format
Per finding: SEVERITY|FILE:LINE|ISSUE|RECOMMENDATION
End with: VERDICT: APPROVE or REQUEST_CHANGES

## Focus Areas
- LSP protocol correctness (position encoding, URI format, lifecycle)
- MCP tool interface quality (clear descriptions, proper error handling)
- Type safety (strict TypeScript, zod validation)
- Edge cases (Unicode/surrogate pairs, missing files, server crashes)
