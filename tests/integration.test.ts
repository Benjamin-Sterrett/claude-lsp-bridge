import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MOCK_SERVER = join(fileURLToPath(import.meta.url), '..', 'mock-lsp-server.mjs');
const SERVER_ENTRY = join(fileURLToPath(import.meta.url), '..', '..', 'src', 'index.ts');

let tempDir: string;
let client: Client | null = null;

afterEach(async () => {
  if (client) {
    try { await client.close(); } catch { /* transport may already be closed */ }
    client = null;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function setupServer(): Promise<{ client: Client; testFile: string }> {
  tempDir = mkdtempSync(join(tmpdir(), 'lsp-integration-'));
  const testFile = join(tempDir, 'test.ts');
  writeFileSync(testFile, 'export class MyClass {\n  myMethod() {}\n}\n\nfunction helperFn() {}\n');

  const configPath = join(tempDir, 'lsp-config.json');
  writeFileSync(configPath, JSON.stringify({
    workspaceDir: tempDir,
    languageServers: [{
      language: 'typescript',
      command: 'node',
      args: [MOCK_SERVER],
      extensions: ['.ts', '.tsx'],
    }],
  }));

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--experimental-strip-types', SERVER_ENTRY],
    env: { ...process.env, LSP_CONFIG: configPath },
  });

  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  return { client, testFile };
}

// ── Tool Registration ──

describe('MCP server integration', () => {
  it('lists all 6 tools', async () => {
    const { client } = await setupServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'find_definition',
      'find_references',
      'find_symbol',
      'get_diagnostics',
      'get_hover',
      'list_file_symbols',
    ]);
  });

  it('tools have descriptions', async () => {
    const { client } = await setupServer();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.description, `tool ${tool.name} should have a description`);
    }
  });

  // ── Tool Calls ──

  it('find_definition returns definition location', async () => {
    const { client, testFile } = await setupServer();
    const result = await client.callTool({
      name: 'find_definition',
      arguments: { file: testFile, line: 1, character: 1 },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.ok(text.includes('Definition'), 'should contain Definition header');
    assert.ok(!result.isError, 'should not be an error');
  });

  it('find_references returns reference list', async () => {
    const { client, testFile } = await setupServer();
    const result = await client.callTool({
      name: 'find_references',
      arguments: { file: testFile, line: 1, character: 1 },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.ok(text.includes('References'), 'should contain References header');
    assert.ok(!result.isError, 'should not be an error');
  });

  it('get_hover returns hover info', async () => {
    const { client, testFile } = await setupServer();
    const result = await client.callTool({
      name: 'get_hover',
      arguments: { file: testFile, line: 1, character: 1 },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.ok(text.includes('Hover'), 'should contain Hover header');
    assert.ok(!result.isError, 'should not be an error');
  });

  it('get_diagnostics returns status', async () => {
    const { client, testFile } = await setupServer();
    const result = await client.callTool({
      name: 'get_diagnostics',
      arguments: { file: testFile, waitMs: 100 },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.ok(text.includes('Diagnostics'), 'should contain Diagnostics header');
    assert.ok(!result.isError, 'should not be an error');
  });

  it('find_symbol returns matching symbols', async () => {
    const { client, testFile } = await setupServer();
    // Trigger a file read to initialize the server
    await client.callTool({
      name: 'list_file_symbols',
      arguments: { file: testFile },
    });
    const result = await client.callTool({
      name: 'find_symbol',
      arguments: { query: 'MyClass' },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.ok(text.includes('MyClass'), 'should find MyClass symbol');
    assert.ok(!result.isError, 'should not be an error');
  });

  it('list_file_symbols returns file symbols', async () => {
    const { client, testFile } = await setupServer();
    const result = await client.callTool({
      name: 'list_file_symbols',
      arguments: { file: testFile },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.ok(text.includes('Symbols in'), 'should contain Symbols header');
    assert.ok(text.includes('MyClass'), 'should list MyClass');
    assert.ok(!result.isError, 'should not be an error');
  });

  // ── Error Handling ──

  it('returns isError for invalid file path', async () => {
    const { client } = await setupServer();
    const result = await client.callTool({
      name: 'find_definition',
      arguments: { file: '/nonexistent/path/file.xyz', line: 1, character: 1 },
    });
    assert.ok(result.isError, 'should return isError for invalid file');
  });
});
