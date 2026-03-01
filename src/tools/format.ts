import { readFileSync } from 'node:fs';
import { SymbolKind } from 'vscode-languageserver-protocol';
import { uriToFilePath } from '../types.ts';

export function symbolKindName(kind: number): string {
  const names: Record<number, string> = {
    [SymbolKind.File]: 'File',
    [SymbolKind.Module]: 'Module',
    [SymbolKind.Namespace]: 'Namespace',
    [SymbolKind.Package]: 'Package',
    [SymbolKind.Class]: 'Class',
    [SymbolKind.Method]: 'Method',
    [SymbolKind.Property]: 'Property',
    [SymbolKind.Field]: 'Field',
    [SymbolKind.Constructor]: 'Constructor',
    [SymbolKind.Enum]: 'Enum',
    [SymbolKind.Interface]: 'Interface',
    [SymbolKind.Function]: 'Function',
    [SymbolKind.Variable]: 'Variable',
    [SymbolKind.Constant]: 'Constant',
    [SymbolKind.String]: 'String',
    [SymbolKind.Number]: 'Number',
    [SymbolKind.Boolean]: 'Boolean',
    [SymbolKind.Array]: 'Array',
    [SymbolKind.Object]: 'Object',
    [SymbolKind.Key]: 'Key',
    [SymbolKind.Null]: 'Null',
    [SymbolKind.EnumMember]: 'EnumMember',
    [SymbolKind.Struct]: 'Struct',
    [SymbolKind.Event]: 'Event',
    [SymbolKind.Operator]: 'Operator',
    [SymbolKind.TypeParameter]: 'TypeParameter',
  };
  return names[kind] ?? `Kind(${kind})`;
}

/**
 * Safely convert a URI to a file path. Returns null for non-file:// URIs
 * (e.g., jar:, zip:, virtual docs) instead of throwing.
 */
export function safeUriToPath(uri: string): string | null {
  try {
    return uriToFilePath(uri);
  } catch {
    return null;
  }
}

export function getLinePreview(filePath: string, zeroBasedLine: number, context = 1): string | null {
  try {
    const safeContext = Math.min(Math.max(0, context), 10);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, zeroBasedLine - safeContext);
    const end = Math.min(lines.length, zeroBasedLine + safeContext + 1);
    return lines.slice(start, end).join('\n');
  } catch {
    return null;
  }
}

export function getLineTrimmed(filePath: string, zeroBasedLine: number): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const line = content.split('\n')[zeroBasedLine];
    return line?.trim() ?? null;
  } catch {
    return null;
  }
}

export function getLineContent(filePath: string, zeroBasedLine: number): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n')[zeroBasedLine] ?? null;
  } catch {
    return null;
  }
}
