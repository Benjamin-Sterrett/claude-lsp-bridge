import type { Location, LocationLink } from 'vscode-languageserver-protocol';
import type { LspManager } from '../lsp/manager.ts';
import {
  toLspPosition,
  toExternalPosition,
  toolSuccess,
  type ToolResult,
} from '../types.ts';
import { getLinePreview, safeUriToPath } from './format.ts';

export interface FindDefinitionParams {
  file: string;
  line: number;
  character: number;
}

export async function findDefinition(
  manager: LspManager,
  params: FindDefinitionParams,
): Promise<ToolResult> {
  const client = await manager.getClientForFile(params.file);
  const uri = await client.syncFile(params.file);
  const lspPos = toLspPosition({ line: params.line, character: params.character });

  const result = await client.sendRequest<Location | Location[] | LocationLink[] | null>(
    'textDocument/definition',
    { textDocument: { uri }, position: lspPos },
  );

  if (!result) {
    return toolSuccess('No definition found.');
  }

  const locations = normalizeLocations(result);
  if (locations.length === 0) {
    return toolSuccess('No definition found.');
  }

  const lines: string[] = ['## Definition'];
  for (const loc of locations) {
    const filePath = safeUriToPath(loc.uri);
    const pos = toExternalPosition(loc.range.start);
    const displayPath = filePath ?? loc.uri;
    const preview = filePath ? getLinePreview(filePath, loc.range.start.line) : null;
    lines.push(`\n**${displayPath}:${pos.line}**`);
    if (preview) lines.push('```\n' + preview + '\n```');
  }

  return toolSuccess(lines.join('\n'));
}

function normalizeLocations(result: Location | Location[] | LocationLink[]): Location[] {
  if (Array.isArray(result)) {
    return result.map((item) => {
      if ('targetUri' in item) {
        return { uri: item.targetUri, range: item.targetSelectionRange ?? item.targetRange };
      }
      return item as Location;
    });
  }
  return [result as Location];
}
