import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LspClient } from '../src/lsp/client.ts';
import { LspManager } from '../src/lsp/manager.ts';
import type { LspServerConfig, LspConfig } from '../src/config.ts';

// Path to the mock LSP server script
const MOCK_SERVER = join(fileURLToPath(import.meta.url), '..', 'mock-lsp-server.mjs');

let tempDir: string;
let client: LspClient | null = null;
let manager: LspManager | null = null;

afterEach(async () => {
  if (client) {
    await client.shutdown();
    client = null;
  }
  if (manager) {
    await manager.shutdownAll();
    manager = null;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'lsp-bridge-test-'));
  return tempDir;
}

function makeServerConfig(overrides?: Partial<LspServerConfig>): LspServerConfig {
  return {
    language: 'typescript',
    command: 'node',
    args: [MOCK_SERVER],
    extensions: ['.ts'],
    ...overrides,
  };
}

describe('LspClient', () => {
  it('initializes and performs LSP handshake', async () => {
    const dir = makeTempDir();
    const config = makeServerConfig();
    client = new LspClient(config, dir);

    await client.initialize();
    assert.equal(client.language, 'typescript');
  });

  it('negotiates position encoding (defaults to utf-16)', async () => {
    const dir = makeTempDir();
    const config = makeServerConfig();
    client = new LspClient(config, dir);

    await client.initialize();
    // Mock server doesn't specify positionEncoding, so should default to utf-16
    assert.equal(client.getPositionEncoding(), 'utf-16');
  });

  it('syncs file via didOpen on first access', async () => {
    const dir = makeTempDir();
    const testFile = join(dir, 'test.ts');
    writeFileSync(testFile, 'const x = 1;');

    client = new LspClient(makeServerConfig(), dir);
    await client.initialize();

    const uri = await client.syncFile(testFile);
    assert.ok(uri.startsWith('file://'));
    assert.ok(uri.includes('test.ts'));
  });

  it('syncs file via didChange when content changes', async () => {
    const dir = makeTempDir();
    const testFile = join(dir, 'test.ts');
    writeFileSync(testFile, 'const x = 1;');

    client = new LspClient(makeServerConfig(), dir);
    await client.initialize();

    await client.syncFile(testFile);

    // Modify file and re-sync
    writeFileSync(testFile, 'const x = 2;');
    const uri = await client.syncFile(testFile);
    assert.ok(uri.includes('test.ts'));
  });

  it('does not re-sync when content is unchanged', async () => {
    const dir = makeTempDir();
    const testFile = join(dir, 'test.ts');
    writeFileSync(testFile, 'const x = 1;');

    client = new LspClient(makeServerConfig(), dir);
    await client.initialize();

    const uri1 = await client.syncFile(testFile);
    const uri2 = await client.syncFile(testFile);
    assert.equal(uri1, uri2);
  });

  it('shuts down gracefully', async () => {
    const dir = makeTempDir();
    client = new LspClient(makeServerConfig(), dir);
    await client.initialize();

    await client.shutdown();
    // After shutdown, should throw on new requests
    await assert.rejects(
      () => client!.syncFile(join(dir, 'test.ts')),
      /disposed/,
    );
    client = null; // Prevent double shutdown in afterEach
  });

  it('returns undefined diagnostics for unseen files', async () => {
    const dir = makeTempDir();
    client = new LspClient(makeServerConfig(), dir);
    await client.initialize();

    const entry = client.getDiagnostics('file:///nonexistent.ts');
    assert.equal(entry, undefined);
  });

  it('handles concurrent initialize() calls safely', async () => {
    const dir = makeTempDir();
    client = new LspClient(makeServerConfig(), dir);

    // Fire two initializations concurrently — should not spawn duplicate processes
    const [r1, r2] = await Promise.allSettled([
      client.initialize(),
      client.initialize(),
    ]);
    assert.equal(r1.status, 'fulfilled');
    assert.equal(r2.status, 'fulfilled');
    assert.equal(client.language, 'typescript');
  });

  it('throws on invalid command (spawn failure)', async () => {
    const dir = makeTempDir();
    client = new LspClient(
      makeServerConfig({ command: 'nonexistent-binary-xyz' }),
      dir,
    );

    await assert.rejects(
      () => client!.initialize(),
    );
    // Give async stream errors time to settle before cleanup
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe('LspManager', () => {
  it('routes by file extension', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'test.ts'), 'export const x = 1;');

    const config: LspConfig = {
      workspaceDir: dir,
      languageServers: [makeServerConfig()],
    };
    manager = new LspManager(config);

    const c = await manager.getClientForFile(join(dir, 'test.ts'));
    assert.equal(c.language, 'typescript');
  });

  it('throws for unconfigured extension', async () => {
    const dir = makeTempDir();
    const config: LspConfig = {
      workspaceDir: dir,
      languageServers: [makeServerConfig()],
    };
    manager = new LspManager(config);

    await assert.rejects(
      () => manager!.getClientForFile(join(dir, 'test.py')),
      /No language server configured/,
    );
  });

  it('throws for files with no extension', async () => {
    const dir = makeTempDir();
    const config: LspConfig = {
      workspaceDir: dir,
      languageServers: [makeServerConfig()],
    };
    manager = new LspManager(config);

    await assert.rejects(
      () => manager!.getClientForFile(join(dir, 'Makefile')),
      /no file extension/,
    );
  });

  it('reuses client for same language', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.ts'), 'const a = 1;');
    writeFileSync(join(dir, 'b.ts'), 'const b = 2;');

    const config: LspConfig = {
      workspaceDir: dir,
      languageServers: [makeServerConfig()],
    };
    manager = new LspManager(config);

    const c1 = await manager.getClientForFile(join(dir, 'a.ts'));
    const c2 = await manager.getClientForFile(join(dir, 'b.ts'));
    assert.equal(c1, c2); // Same client instance
  });

  it('routes to different clients for different languages', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'test.ts'), 'const x = 1;');
    writeFileSync(join(dir, 'test.py'), 'x = 1');

    const config: LspConfig = {
      workspaceDir: dir,
      languageServers: [
        makeServerConfig(),
        makeServerConfig({
          language: 'python',
          command: 'node',
          args: [MOCK_SERVER],
          extensions: ['.py'],
        }),
      ],
    };
    manager = new LspManager(config);

    const tsClient = await manager.getClientForFile(join(dir, 'test.ts'));
    const pyClient = await manager.getClientForFile(join(dir, 'test.py'));
    assert.notEqual(tsClient, pyClient);
    assert.equal(tsClient.language, 'typescript');
    assert.equal(pyClient.language, 'python');
  });

  it('shuts down all clients', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'test.ts'), 'const x = 1;');

    const config: LspConfig = {
      workspaceDir: dir,
      languageServers: [makeServerConfig()],
    };
    manager = new LspManager(config);

    await manager.getClientForFile(join(dir, 'test.ts'));
    await manager.shutdownAll();
    manager = null; // Prevent double shutdown
  });

  it('throws on duplicate extension registration', () => {
    const dir = makeTempDir();
    assert.throws(
      () => new LspManager({
        workspaceDir: dir,
        languageServers: [
          makeServerConfig(),
          makeServerConfig({ language: 'javascript', extensions: ['.ts'] }),
        ],
      }),
      /Extension '\.ts' is registered for both/,
    );
  });

  it('throws on duplicate language in config', () => {
    const dir = makeTempDir();
    assert.throws(
      () => new LspManager({
        workspaceDir: dir,
        languageServers: [
          makeServerConfig(),
          makeServerConfig({ extensions: ['.tsx'] }),
        ],
      }),
      /Duplicate language 'typescript'/,
    );
  });

  it('handles case-insensitive extension matching', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'test.TS'), 'const x = 1;');

    const config: LspConfig = {
      workspaceDir: dir,
      languageServers: [makeServerConfig()],
    };
    manager = new LspManager(config);

    const c = await manager.getClientForFile(join(dir, 'test.TS'));
    assert.equal(c.language, 'typescript');
  });

  it('starts with null config and auto-detects from file path', async () => {
    const dir = makeTempDir();
    // Create a tsconfig.json marker so auto-detection works
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'test.ts'), 'export const x = 1;');

    manager = new LspManager(null);
    const c = await manager.getClientForFile(join(dir, 'test.ts'));
    assert.equal(c.language, 'typescript');
  });

  it('returns empty array from getAllClients with null config', async () => {
    manager = new LspManager(null);
    const clients = await manager.getAllClients();
    assert.equal(clients.length, 0);
  });

  it('throws helpful error from getClientForLanguage with null config', async () => {
    manager = new LspManager(null);
    await assert.rejects(
      () => manager!.getClientForLanguage('typescript'),
      /No LSP config available/,
    );
  });

  it('throws when auto-detection fails for file outside any project', async () => {
    const dir = makeTempDir();
    // No marker files — auto-detection will fail
    writeFileSync(join(dir, 'orphan.ts'), 'const x = 1;');

    manager = new LspManager(null);
    await assert.rejects(
      () => manager!.getClientForFile(join(dir, 'orphan.ts')),
      /could not auto-detect workspace/,
    );
  });
});
