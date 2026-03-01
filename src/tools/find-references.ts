import type { Location } from 'vscode-languageserver-protocol';
import type { LspManager } from '../lsp/manager.ts';
import {
  toLspPosition,
  toExternalPosition,
  encodeCharacterOffset,
  toolSuccess,
  type ToolResult,
} from '../types.ts';
import { getLineTrimmed, getLineContent, safeUriToPath } from './format.ts';

export interface FindReferencesParams {
  file: string;
  line: number;
  character: number;
  includeDeclaration?: boolean;
}

export async function findReferences(
  manager: LspManager,
  params: FindReferencesParams,
): Promise<ToolResult> {
  const client = await manager.getClientForFile(params.file);
  const uri = await client.syncFile(params.file);
  const lspPos = toLspPosition({ line: params.line, character: params.character });
  const lineText = getLineContent(params.file, lspPos.line);
  if (lineText !== null) {
    lspPos.character = encodeCharacterOffset(lineText, lspPos.character, client.getPositionEncoding());
  }

  const result = await client.sendRequest<Location[] | null>(
    'textDocument/references',
    {
      textDocument: { uri },
      position: lspPos,
      context: { includeDeclaration: params.includeDeclaration ?? true },
    },
  );

  if (!result || result.length === 0) {
    return toolSuccess('No references found.');
  }

  const lines: string[] = [`## References (${result.length})`];
  for (const loc of result) {
    const filePath = safeUriToPath(loc.uri);
    const pos = toExternalPosition(loc.range.start);
    const displayPath = filePath ?? loc.uri;
    const preview = filePath ? getLineTrimmed(filePath, loc.range.start.line) : null;
    lines.push(`- **${displayPath}:${pos.line}** ${preview ?? ''}`);
  }

  return toolSuccess(lines.join('\n'));
}
