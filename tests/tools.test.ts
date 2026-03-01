import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LspManager } from '../src/lsp/manager.ts';
import type { LspConfig } from '../src/config.ts';
import { findDefinition } from '../src/tools/find-definition.ts';
import { findReferences } from '../src/tools/find-references.ts';
import { getHover } from '../src/tools/get-hover.ts';
import { getDiagnostics } from '../src/tools/get-diagnostics.ts';
import { symbolKindName } from '../src/tools/format.ts';

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
  tempDir = mkdtempSync(join(tmpdir(), 'lsp-tools-test-'));
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

// ── symbolKindName ──

describe('symbolKindName', () => {
  it('maps known symbol kinds to names', () => {
    assert.equal(symbolKindName(5), 'Class');
    assert.equal(symbolKindName(6), 'Method');
    assert.equal(symbolKindName(12), 'Function');
    assert.equal(symbolKindName(13), 'Variable');
  });

  it('returns fallback for unknown kind', () => {
    assert.equal(symbolKindName(999), 'Kind(999)');
  });
});

// ── findDefinition ──

describe('findDefinition', () => {
  it('returns definition location with file and line', async () => {
    const { manager, testFile } = setup();
    const result = await findDefinition(manager, { file: testFile, line: 1, character: 1 });
    const text = getText(result);

    assert.ok(text.includes('## Definition'), 'should have Definition header');
    assert.ok(text.includes(':10'), 'should convert 0-based line 9 to 1-based line 10');
    assert.ok(!('isError' in result), 'should not be an error');
  });
});

// ── findReferences ──

describe('findReferences', () => {
  it('returns all reference locations', async () => {
    const { manager, testFile } = setup();
    const result = await findReferences(manager, { file: testFile, line: 1, character: 1 });
    const text = getText(result);

    assert.ok(text.includes('## References (2)'), 'should show 2 references');
    assert.ok(text.includes(':1'), 'should have first reference at line 1');
    assert.ok(text.includes(':6'), 'should have second reference at line 6');
    assert.ok(!('isError' in result), 'should not be an error');
  });
});

// ── getHover ──

describe('getHover', () => {
  it('returns hover content as markdown', async () => {
    const { manager, testFile } = setup();
    const result = await getHover(manager, { file: testFile, line: 1, character: 1 });
    const text = getText(result);

    assert.ok(text.includes('## Hover'), 'should have Hover header');
    assert.ok(text.includes('function hello(): void'), 'should include type info');
    assert.ok(!('isError' in result), 'should not be an error');
  });
});

// ── getDiagnostics ──

describe('getDiagnostics', () => {
  it('returns indexing status when no diagnostics received', async () => {
    const { manager, testFile } = setup();
    // Use minimal wait — mock server doesn't push diagnostics
    const result = await getDiagnostics(manager, { file: testFile, waitMs: 50 });
    const text = getText(result);

    assert.ok(text.includes('**Status:** indexing'), 'should report indexing status');
    assert.ok(text.includes('No diagnostics received'), 'should explain no data');
    assert.ok(!('isError' in result), 'should not be an error');
  });
});
