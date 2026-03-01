#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.ts';
import { LspManager } from './lsp/manager.ts';
import { findDefinition } from './tools/find-definition.ts';
import { findReferences } from './tools/find-references.ts';
import { getHover } from './tools/get-hover.ts';
import { getDiagnostics } from './tools/get-diagnostics.ts';
import { findSymbol } from './tools/find-symbol.ts';
import { listFileSymbols } from './tools/list-file-symbols.ts';
import { toolError } from './types.ts';

// ── Tool Registration ──

function registerTools(server: McpServer, manager: LspManager): void {
  server.registerTool(
    'find_definition',
    {
      title: 'Find Definition',
      description: 'Go to the definition of a symbol at a given file position. Returns the file path, line number, and source code preview of the definition.',
      inputSchema: {
        file: z.string().describe('Absolute path to the source file'),
        line: z.number().int().min(1).describe('Line number (1-based)'),
        character: z.number().int().min(1).describe('Character position (1-based)'),
      },
    },
    async ({ file, line, character }) => {
      try {
        return await findDefinition(manager, { file, line, character });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'find_references',
    {
      title: 'Find References',
      description: 'Find all references to a symbol at a given file position. Returns a list of file:line locations with source previews.',
      inputSchema: {
        file: z.string().describe('Absolute path to the source file'),
        line: z.number().int().min(1).describe('Line number (1-based)'),
        character: z.number().int().min(1).describe('Character position (1-based)'),
        includeDeclaration: z.boolean().optional().describe('Include the declaration in results (default: true)'),
      },
    },
    async ({ file, line, character, includeDeclaration }) => {
      try {
        return await findReferences(manager, { file, line, character, includeDeclaration });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'get_hover',
    {
      title: 'Get Hover Info',
      description: 'Get type information and documentation for a symbol at a given file position. Returns type signatures and documentation in markdown.',
      inputSchema: {
        file: z.string().describe('Absolute path to the source file'),
        line: z.number().int().min(1).describe('Line number (1-based)'),
        character: z.number().int().min(1).describe('Character position (1-based)'),
      },
    },
    async ({ file, line, character }) => {
      try {
        return await getHover(manager, { file, line, character });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'get_diagnostics',
    {
      title: 'Get Diagnostics',
      description: 'Get errors and warnings for a file from the language server. Returns diagnostic messages with severity, line numbers, and status (ready/indexing).',
      inputSchema: {
        file: z.string().describe('Absolute path to the source file'),
        waitMs: z.number().int().min(0).max(10000).optional().describe('Milliseconds to wait for diagnostics (default: 500, max: 10000)'),
      },
    },
    async ({ file, waitMs }) => {
      try {
        return await getDiagnostics(manager, { file, waitMs });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'find_symbol',
    {
      title: 'Find Symbol',
      description: 'Search for symbols across the workspace by name. Returns matching symbols with their kind, file location, and container.',
      inputSchema: {
        query: z.string().describe('Symbol name or pattern to search for'),
        language: z.string().optional().describe('Limit search to a specific language server (e.g., "typescript", "python")'),
      },
    },
    async ({ query, language }) => {
      try {
        return await findSymbol(manager, { query, language });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'list_file_symbols',
    {
      title: 'List File Symbols',
      description: 'List all symbols (classes, functions, variables, etc.) in a file with their kind, line number, and hierarchy.',
      inputSchema: {
        file: z.string().describe('Absolute path to the source file'),
      },
    },
    async ({ file }) => {
      try {
        return await listFileSymbols(manager, { file });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

// ── Graceful Shutdown ──

let shuttingDown = false;

async function shutdown(manager: LspManager, server: McpServer): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error('claude-lsp-bridge: shutting down...');
  try {
    await manager.shutdownAll();
  } catch (err) {
    console.error('claude-lsp-bridge: error during LSP shutdown:', err);
  }
  try {
    await server.close();
  } catch {
    // Transport may already be closed
  }
  process.exit(0);
}

// ── Main ──

async function main(): Promise<void> {
  let config: import('./config.ts').LspConfig | null = null;
  try {
    config = loadConfig();
    console.error(`claude-lsp-bridge: loaded config for workspace ${config.workspaceDir}`);
  } catch {
    console.error('claude-lsp-bridge: no config found at startup — will auto-detect from file paths');
  }

  const manager = new LspManager(config);
  const server = new McpServer(
    { name: 'claude-lsp-bridge', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  registerTools(server, manager);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Shutdown on signals
  process.on('SIGINT', () => { void shutdown(manager, server); });
  process.on('SIGTERM', () => { void shutdown(manager, server); });

  // Shutdown on stdin close (parent process disconnect)
  process.stdin.on('close', () => { void shutdown(manager, server); });

  console.error('claude-lsp-bridge: running on stdio');
}

main().catch((err) => {
  console.error('claude-lsp-bridge: fatal error:', err);
  process.exit(1);
});
