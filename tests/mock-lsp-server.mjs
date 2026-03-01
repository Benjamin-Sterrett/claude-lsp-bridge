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

connection.onRequest('shutdown', () => {
  return null;
});

connection.onNotification('exit', () => {
  process.exit(0);
});

connection.listen();
