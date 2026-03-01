import type { DocumentSymbol, SymbolInformation } from 'vscode-languageserver-protocol';
import type { LspManager } from '../lsp/manager.ts';
import {
  toExternalPosition,
  toolSuccess,
  type ToolResult,
} from '../types.ts';
import { symbolKindName } from './format.ts';

export interface ListFileSymbolsParams {
  file: string;
}

export async function listFileSymbols(
  manager: LspManager,
  params: ListFileSymbolsParams,
): Promise<ToolResult> {
  const client = await manager.getClientForFile(params.file);
  const uri = await client.syncFile(params.file);

  const result = await client.sendRequest<DocumentSymbol[] | SymbolInformation[] | null>(
    'textDocument/documentSymbol',
    { textDocument: { uri } },
  );

  if (!result || result.length === 0) {
    return toolSuccess('No symbols found in this file.');
  }

  const lines: string[] = [`## Symbols in ${params.file}`];

  if (isDocumentSymbolArray(result)) {
    formatDocumentSymbols(result, lines, 0);
  } else {
    for (const sym of result as SymbolInformation[]) {
      const pos = toExternalPosition(sym.location.range.start);
      const kind = symbolKindName(sym.kind);
      const container = sym.containerName ? ` (in ${sym.containerName})` : '';
      lines.push(`- **${sym.name}** [${kind}] line ${pos.line}${container}`);
    }
  }

  return toolSuccess(lines.join('\n'));
}

function isDocumentSymbolArray(
  result: (DocumentSymbol | SymbolInformation)[],
): result is DocumentSymbol[] {
  return result.length > 0 && 'range' in result[0] && !('location' in result[0]);
}

function formatDocumentSymbols(symbols: DocumentSymbol[], lines: string[], depth: number): void {
  const indent = '  '.repeat(depth);
  for (const sym of symbols) {
    const pos = toExternalPosition(sym.range.start);
    const kind = symbolKindName(sym.kind);
    lines.push(`${indent}- **${sym.name}** [${kind}] line ${pos.line}`);
    if (sym.children && sym.children.length > 0) {
      formatDocumentSymbols(sym.children, lines, depth + 1);
    }
  }
}
