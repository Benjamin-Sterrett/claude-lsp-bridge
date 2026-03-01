import type { Location, SymbolInformation, WorkspaceSymbol } from 'vscode-languageserver-protocol';
import type { LspManager } from '../lsp/manager.ts';
import {
  toExternalPosition,
  toolSuccess,
  type ToolResult,
} from '../types.ts';
import { symbolKindName, safeUriToPath } from './format.ts';

export interface FindSymbolParams {
  query: string;
  language?: string;
}

export async function findSymbol(
  manager: LspManager,
  params: FindSymbolParams,
): Promise<ToolResult> {
  const clients = params.language
    ? [await getClientByLanguage(manager, params.language)]
    : manager.getInitializedClients();

  if (clients.length === 0) {
    return toolSuccess('No language servers available for symbol search.');
  }

  const allSymbols: Array<{ name: string; kind: string; file: string; line: number; container?: string }> = [];

  for (const client of clients) {
    const result = await client.sendRequest<SymbolInformation[] | WorkspaceSymbol[] | null>(
      'workspace/symbol',
      { query: params.query },
    );

    if (result) {
      for (const sym of result) {
        if (!('location' in sym)) continue;
        const loc = sym.location;
        const filePath = safeUriToPath(loc.uri) ?? loc.uri;
        const hasRange = 'range' in loc;
        const pos = hasRange ? toExternalPosition((loc as Location).range.start) : { line: 1 };
        allSymbols.push({
          name: sym.name,
          kind: symbolKindName(sym.kind),
          file: filePath,
          line: pos.line,
          container: 'containerName' in sym ? sym.containerName ?? undefined : undefined,
        });
      }
    }
  }

  if (allSymbols.length === 0) {
    return toolSuccess(`No symbols found matching "${params.query}".`);
  }

  const lines: string[] = [`## Symbols matching "${params.query}" (${allSymbols.length})`];
  for (const s of allSymbols) {
    const container = s.container ? ` (in ${s.container})` : '';
    lines.push(`- **${s.name}** [${s.kind}] ${s.file}:${s.line}${container}`);
  }

  return toolSuccess(lines.join('\n'));
}

async function getClientByLanguage(manager: LspManager, language: string) {
  const client = manager.getClient(language);
  if (!client) {
    throw new Error(`No language server for '${language}'`);
  }
  await client.initialize();
  return client;
}
