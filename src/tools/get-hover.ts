import type { Hover, MarkupContent, MarkedString } from 'vscode-languageserver-protocol';
import type { LspManager } from '../lsp/manager.ts';
import {
  toLspPosition,
  toolSuccess,
  type ToolResult,
} from '../types.ts';

export interface GetHoverParams {
  file: string;
  line: number;
  character: number;
}

export async function getHover(
  manager: LspManager,
  params: GetHoverParams,
): Promise<ToolResult> {
  const client = await manager.getClientForFile(params.file);
  const uri = await client.syncFile(params.file);
  const lspPos = toLspPosition({ line: params.line, character: params.character });

  const result = await client.sendRequest<Hover | null>(
    'textDocument/hover',
    { textDocument: { uri }, position: lspPos },
  );

  if (!result || !result.contents) {
    return toolSuccess('No hover information available.');
  }

  const text = formatHoverContents(result.contents);
  if (!text) {
    return toolSuccess('No hover information available.');
  }

  return toolSuccess(`## Hover\n\n${text}`);
}

type HoverContents = MarkupContent | MarkedString | MarkedString[];

function formatHoverContents(contents: HoverContents): string | null {
  // MarkupContent: { kind, value }
  if (typeof contents === 'object' && 'kind' in contents && 'value' in contents) {
    return (contents as MarkupContent).value || null;
  }

  // MarkedString as string
  if (typeof contents === 'string') {
    return contents || null;
  }

  // MarkedString as { language, value }
  if (typeof contents === 'object' && 'language' in contents) {
    const ms = contents as { language: string; value: string };
    return `\`\`\`${ms.language}\n${ms.value}\n\`\`\``;
  }

  // MarkedString[]
  if (Array.isArray(contents)) {
    const parts = contents
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && 'language' in item) {
          const ms = item as { language: string; value: string };
          return `\`\`\`${ms.language}\n${ms.value}\n\`\`\``;
        }
        return null;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  return null;
}
