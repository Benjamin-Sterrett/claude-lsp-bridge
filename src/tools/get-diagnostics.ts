import { DiagnosticSeverity } from 'vscode-languageserver-protocol';
import type { LspManager } from '../lsp/manager.ts';
import {
  filePathToUri,
  toExternalPosition,
  toolSuccess,
  type ToolResult,
  type DiagnosticStatus,
} from '../types.ts';

export interface GetDiagnosticsParams {
  file: string;
  waitMs?: number;
}

const DEFAULT_WAIT_MS = 500;
const MAX_WAIT_MS = 10_000;

export async function getDiagnostics(
  manager: LspManager,
  params: GetDiagnosticsParams,
): Promise<ToolResult> {
  const client = await manager.getClientForFile(params.file);
  await client.syncFile(params.file);
  const uri = filePathToUri(params.file);

  // Wait for diagnostics to arrive (they're push-based, not request-based)
  const waitMs = Math.max(0, Math.min(params.waitMs ?? DEFAULT_WAIT_MS, MAX_WAIT_MS));
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const entry = client.getDiagnostics(uri);
  const docVersion = client.getDocumentVersion(uri);
  let status: DiagnosticStatus;

  // No diagnostics received at all, or diagnostics are from an older document version
  if (!entry || (docVersion !== undefined && entry.version !== undefined && entry.version < docVersion)) {
    status = 'indexing';
    return toolSuccess(
      `## Diagnostics\n\n**Status:** ${status}\n\nNo diagnostics received yet. ` +
      `The language server may still be indexing. Try again in a few seconds.`,
    );
  }

  const diags = entry.diagnostics;
  if (diags.length === 0) {
    status = 'ready';
    return toolSuccess(`## Diagnostics\n\n**Status:** ${status}\n\nNo errors or warnings.`);
  }

  status = 'ready';
  const lines: string[] = [`## Diagnostics (${diags.length})`, `\n**Status:** ${status}`];

  for (const d of diags) {
    const pos = toExternalPosition(d.range.start);
    const severity = severityLabel(d.severity);
    lines.push(`\n- **${severity}** line ${pos.line}: ${d.message}`);
    if (d.source) lines.push(`  Source: ${d.source}`);
    if (d.code !== undefined) lines.push(`  Code: ${d.code}`);
  }

  return toolSuccess(lines.join('\n'));
}

function severityLabel(severity: number | undefined): string {
  switch (severity) {
    case DiagnosticSeverity.Error: return 'Error';
    case DiagnosticSeverity.Warning: return 'Warning';
    case DiagnosticSeverity.Information: return 'Info';
    case DiagnosticSeverity.Hint: return 'Hint';
    default: return 'Unknown';
  }
}
