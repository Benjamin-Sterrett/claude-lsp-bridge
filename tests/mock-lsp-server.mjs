/**
 * Minimal mock LSP server for testing.
 * Responds to initialize, shutdown, exit.
 * Accepts didOpen/didChange/didClose notifications.
 * Communicates via JSON-RPC over stdio.
 */

import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);

connection.onRequest('initialize', (_params) => {
  return {
    capabilities: {
      textDocumentSync: 1, // Full
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
    },
  };
});

connection.onNotification('initialized', () => {
  // Ready
});

connection.onNotification('textDocument/didOpen', () => {});
connection.onNotification('textDocument/didChange', () => {});
connection.onNotification('textDocument/didClose', () => {});

// Tool request handlers for testing
connection.onRequest('textDocument/definition', (params) => {
  return {
    uri: params.textDocument.uri,
    range: { start: { line: 9, character: 0 }, end: { line: 9, character: 10 } },
  };
});

connection.onRequest('textDocument/references', (params) => {
  return [
    {
      uri: params.textDocument.uri,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    },
    {
      uri: params.textDocument.uri,
      range: { start: { line: 5, character: 2 }, end: { line: 5, character: 7 } },
    },
  ];
});

connection.onRequest('textDocument/hover', (_params) => {
  return {
    contents: { kind: 'markdown', value: '```typescript\nfunction hello(): void\n```' },
  };
});

connection.onRequest('shutdown', () => {
  return null;
});

connection.onNotification('exit', () => {
  process.exit(0);
});

connection.listen();
