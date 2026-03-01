import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LspManager } from '../src/lsp/manager.ts';
import type { LspConfig } from '../src/config.ts';
import { findSymbol } from '../src/tools/find-symbol.ts';
import { listFileSymbols } from '../src/tools/list-file-symbols.ts';

const MOCK_SERVER = join(fileURLToPath(import.meta.url), '..', 'mock-lsp-server.mjs');

let tempDir: string;
let manager: LspManager | null = null;

afterEach(async () => {
  if (manager) {
    await manager.shutdownAll();
    manager = null;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function setup(): { dir: string; manager: LspManager; testFile: string } {
  tempDir = mkdtempSync(join(tmpdir(), 'lsp-symbol-test-'));
  const testFile = join(tempDir, 'test.ts');
  writeFileSync(testFile, 'export class MyClass {\n  myMethod() {}\n}\n\nfunction helperFn() {}\n');

  const config: LspConfig = {
    workspaceDir: tempDir,
    languageServers: [
      {
        language: 'typescript',
        command: 'node',
        args: [MOCK_SERVER],
        extensions: ['.ts', '.tsx'],
      },
    ],
  };

  manager = new LspManager(config);
  return { dir: tempDir, manager, testFile };
}

function getText(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

// ── findSymbol ──

describe('findSymbol', () => {
  it('returns matching workspace symbols', async () => {
    const { manager } = setup();
    const testFile = join(tempDir, 'init.ts');
    writeFileSync(testFile, 'export const x = 1;\n');
    await manager.getClientForFile(testFile);

    const result = await findSymbol(manager, { query: 'MyClass' });
    const text = getText(result);

    assert.ok(text.includes('## Symbols matching "MyClass"'), 'should have header');
    assert.ok(text.includes('**MyClass** [Class]'), 'should list class symbol');
    assert.ok(text.includes('**myFunction** [Function]'), 'should list function symbol');
    assert.ok(text.includes('(in module)'), 'should show container name');
    assert.ok(!('isError' in result), 'should not be an error');
  });

  it('returns empty message when no symbols match', async () => {
    const { manager } = setup();
    const testFile = join(tempDir, 'init.ts');
    writeFileSync(testFile, 'export const x = 1;\n');
    await manager.getClientForFile(testFile);

    const result = await findSymbol(manager, { query: 'EMPTY' });
    const text = getText(result);

    assert.ok(text.includes('No symbols found matching "EMPTY"'), 'should report no matches');
  });

  it('returns message when no clients available', async () => {
    const { manager } = setup();
    const result = await findSymbol(manager, { query: 'anything' });
    const text = getText(result);

    assert.ok(text.includes('No language servers available'), 'should report no servers');
  });
});

// ── listFileSymbols ──

describe('listFileSymbols', () => {
  it('returns hierarchical document symbols', async () => {
    const { manager, testFile } = setup();
    const result = await listFileSymbols(manager, { file: testFile });
    const text = getText(result);

    assert.ok(text.includes('## Symbols in'), 'should have header');
    assert.ok(text.includes('**MyClass** [Class]'), 'should list class');
    assert.ok(text.includes('**myMethod** [Method]'), 'should list child method');
    assert.ok(text.includes('**helperFn** [Function]'), 'should list function');
    assert.ok(!('isError' in result), 'should not be an error');
  });

  it('indents child symbols', async () => {
    const { manager, testFile } = setup();
    const result = await listFileSymbols(manager, { file: testFile });
    const text = getText(result);
    const lines = text.split('\n');

    const classLine = lines.find((l: string) => l.includes('MyClass'));
    assert.ok(classLine?.startsWith('- '), 'class should have no indent');

    const methodLine = lines.find((l: string) => l.includes('myMethod'));
    assert.ok(methodLine?.startsWith('  - '), 'method should be indented');
  });
});
