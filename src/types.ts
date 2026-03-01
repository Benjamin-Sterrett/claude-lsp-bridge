/**
 * Shared types and conversion utilities for claude-lsp-bridge.
 *
 * External positions (MCP tool inputs/outputs) are 1-based.
 * Internal positions (LSP protocol) are 0-based.
 */

import { posix } from 'node:path';

// ── Position Types ──

export interface ExternalPosition {
  line: number;      // 1-based
  character: number; // 1-based
}

export interface LspPosition {
  line: number;      // 0-based
  character: number; // 0-based
}

export interface ExternalRange {
  start: ExternalPosition;
  end: ExternalPosition;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

// ── Position Conversion ──

export function toExternalPosition(pos: LspPosition): ExternalPosition {
  return { line: pos.line + 1, character: pos.character + 1 };
}

export function toLspPosition(pos: ExternalPosition): LspPosition {
  if (pos.line < 1 || pos.character < 1) {
    throw new Error(`External positions must be >= 1, got line=${pos.line}, character=${pos.character}`);
  }
  return { line: pos.line - 1, character: pos.character - 1 };
}

export function toExternalRange(range: LspRange): ExternalRange {
  return {
    start: toExternalPosition(range.start),
    end: toExternalPosition(range.end),
  };
}

export function toLspRange(range: ExternalRange): LspRange {
  return {
    start: toLspPosition(range.start),
    end: toLspPosition(range.end),
  };
}

// ── URI Normalization ──

export function filePathToUri(filePath: string): string {
  if (!filePath.startsWith('/')) {
    throw new Error(`filePathToUri requires absolute path, got: ${filePath}`);
  }
  // Canonicalize . and .. segments
  const normalized = posix.normalize(filePath);
  // Percent-encode special characters but preserve /
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `file://${encoded}`;
}

export function uriToFilePath(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`uriToFilePath requires valid file:// URI, got: ${uri}`);
  }
  if (parsed.protocol !== 'file:') {
    throw new Error(`uriToFilePath requires file:// URI, got: ${uri}`);
  }
  if (parsed.hostname && parsed.hostname !== 'localhost') {
    throw new Error(`uriToFilePath does not support remote hosts, got: ${uri}`);
  }
  return decodeURIComponent(parsed.pathname);
}

// ── UTF-16 Offset Conversion ──

/**
 * Convert a UTF-8 character offset to a UTF-16 code unit offset.
 * LSP may use UTF-16 offsets; our tools use character (codepoint) offsets.
 */
export function charOffsetToUtf16(text: string, charOffset: number): number {
  let utf16Offset = 0;
  let codePointCount = 0;
  for (let i = 0; i < text.length && codePointCount < charOffset; i++) {
    const codePoint = text.codePointAt(i)!;
    if (codePoint > 0xFFFF) {
      // Surrogate pair — takes 2 UTF-16 code units
      utf16Offset += 2;
      i++; // Skip the second half of the surrogate pair in JS string
    } else {
      utf16Offset += 1;
    }
    codePointCount++;
  }
  return utf16Offset;
}

/**
 * Convert a UTF-16 code unit offset to a character (codepoint) offset.
 */
export function utf16ToCharOffset(text: string, utf16Offset: number): number {
  let currentUtf16 = 0;
  let charOffset = 0;
  for (let i = 0; i < text.length && currentUtf16 < utf16Offset; i++) {
    const codePoint = text.codePointAt(i)!;
    if (codePoint > 0xFFFF) {
      currentUtf16 += 2;
      i++; // Skip surrogate pair second half
    } else {
      currentUtf16 += 1;
    }
    charOffset++;
  }
  return charOffset;
}

/**
 * Convert a codepoint offset to a UTF-8 byte offset within a line.
 */
export function charOffsetToUtf8(text: string, charOffset: number): number {
  let bytes = 0;
  let count = 0;
  for (const char of text) {
    if (count >= charOffset) break;
    const cp = char.codePointAt(0)!;
    if (cp <= 0x7F) bytes += 1;
    else if (cp <= 0x7FF) bytes += 2;
    else if (cp <= 0xFFFF) bytes += 3;
    else bytes += 4;
    count++;
  }
  return bytes;
}

/**
 * Convert a 0-based codepoint character offset to the offset expected
 * by the given position encoding.
 */
export function encodeCharacterOffset(
  lineText: string,
  charOffset: number,
  encoding: PositionEncoding,
): number {
  switch (encoding) {
    case 'utf-16': return charOffsetToUtf16(lineText, charOffset);
    case 'utf-8': return charOffsetToUtf8(lineText, charOffset);
    case 'utf-32': return charOffset; // UTF-32 = codepoint offset
  }
}

// ── Tool Result Types ──

export interface ToolSuccess {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
}

export interface ToolError {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

export type ToolResult = ToolSuccess | ToolError;

export function toolSuccess(text: string): ToolSuccess {
  return { content: [{ type: 'text', text }] };
}

export function toolError(message: string): ToolError {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ── Diagnostic Status ──

export type DiagnosticStatus = 'ready' | 'indexing' | 'error';

// ── Position Encoding ──

export type PositionEncoding = 'utf-8' | 'utf-16' | 'utf-32';
