import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, autoDetectConfig } from '../src/config.ts';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'lsp-bridge-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads config from explicit env var path', () => {
    const configPath = join(tempDir, 'custom.json');
    writeFileSync(configPath, JSON.stringify({
      workspaceDir: tempDir,
      languageServers: [{
        language: 'typescript',
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensions: ['.ts'],
      }],
    }));

    const config = loadConfig({ envVar: configPath, cwd: tempDir });
    assert.equal(config.workspaceDir, tempDir);
    assert.equal(config.languageServers.length, 1);
    assert.equal(config.languageServers[0].language, 'typescript');
  });

  it('loads lsp-config.local.json over lsp-config.json', () => {
    writeFileSync(join(tempDir, 'lsp-config.json'), JSON.stringify({
      workspaceDir: tempDir,
      languageServers: [{ language: 'default', command: 'default-ls', extensions: ['.d'] }],
    }));
    writeFileSync(join(tempDir, 'lsp-config.local.json'), JSON.stringify({
      workspaceDir: tempDir,
      languageServers: [{ language: 'local', command: 'local-ls', extensions: ['.l'] }],
    }));

    const config = loadConfig({ cwd: tempDir });
    assert.equal(config.languageServers[0].language, 'local');
  });

  it('falls back to lsp-config.json when no local config', () => {
    writeFileSync(join(tempDir, 'lsp-config.json'), JSON.stringify({
      workspaceDir: tempDir,
      languageServers: [{ language: 'fallback', command: 'fb-ls', extensions: ['.f'] }],
    }));

    const config = loadConfig({ cwd: tempDir });
    assert.equal(config.languageServers[0].language, 'fallback');
  });

  it('resolves relative workspaceDir against config file directory', () => {
    const configPath = join(tempDir, 'lsp-config.json');
    writeFileSync(configPath, JSON.stringify({
      workspaceDir: '.',
      languageServers: [{ language: 'ts', command: 'ts-ls', extensions: ['.ts'] }],
    }));

    const config = loadConfig({ cwd: tempDir });
    assert.equal(config.workspaceDir, tempDir);
  });

  it('throws on missing config file', () => {
    assert.throws(
      () => loadConfig({ envVar: '/nonexistent/config.json', cwd: tempDir }),
      /not found/
    );
  });

  it('throws on invalid JSON', () => {
    writeFileSync(join(tempDir, 'lsp-config.json'), 'not json {{');
    assert.throws(
      () => loadConfig({ cwd: tempDir }),
      /Failed to parse/
    );
  });

  it('throws on schema validation failure with field paths', () => {
    writeFileSync(join(tempDir, 'lsp-config.json'), JSON.stringify({
      workspaceDir: 123,
      languageServers: [],
    }));

    try {
      loadConfig({ cwd: tempDir });
      assert.fail('Should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      assert.ok(msg.includes('Invalid config'), `Expected 'Invalid config' in error: ${msg}`);
      assert.ok(msg.includes('languageServers'), `Expected languageServers in error: ${msg}`);
    }
  });

  it('rejects unknown keys in strict mode', () => {
    writeFileSync(join(tempDir, 'lsp-config.json'), JSON.stringify({
      workspaceDir: tempDir,
      languageServers: [{ language: 'ts', command: 'ts-ls', extensions: ['.ts'] }],
      unknownField: true,
    }));

    assert.throws(() => loadConfig({ cwd: tempDir }), /unknownField|Unrecognized/i);
  });

  it('rejects extensions not starting with dot', () => {
    writeFileSync(join(tempDir, 'lsp-config.json'), JSON.stringify({
      workspaceDir: tempDir,
      languageServers: [{ language: 'ts', command: 'ts-ls', extensions: ['ts'] }],
    }));

    assert.throws(() => loadConfig({ cwd: tempDir }), /start with/);
  });

  it('applies default args when not provided', () => {
    writeFileSync(join(tempDir, 'lsp-config.json'), JSON.stringify({
      workspaceDir: tempDir,
      languageServers: [{ language: 'ts', command: 'ts-ls', extensions: ['.ts'] }],
    }));

    const config = loadConfig({ cwd: tempDir });
    assert.deepStrictEqual(config.languageServers[0].args, []);
  });

  it('throws when no config found at all', () => {
    // Empty dir, no markers, no config files
    const emptyDir = mkdtempSync(join(tmpdir(), 'lsp-bridge-empty-'));
    try {
      assert.throws(() => loadConfig({ cwd: emptyDir }), /No LSP config found/);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('autoDetectConfig', () => {
  it('detects TypeScript project from tsconfig.json', () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}');
    const config = autoDetectConfig(tempDir);
    assert.ok(config);
    assert.equal(config.workspaceDir, tempDir);
    assert.equal(config.languageServers[0].language, 'typescript');
    assert.equal(config.languageServers[0].command, 'typescript-language-server');
  });

  it('detects Python project from pyproject.toml', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), '');
    const config = autoDetectConfig(tempDir);
    assert.ok(config);
    assert.equal(config.languageServers[0].language, 'python');
    assert.equal(config.languageServers[0].command, 'pyright-langserver');
  });

  it('detects both TypeScript and Python', () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}');
    writeFileSync(join(tempDir, 'pyproject.toml'), '');
    const config = autoDetectConfig(tempDir);
    assert.ok(config);
    assert.equal(config.languageServers.length, 2);
    const languages = config.languageServers.map((s) => s.language).sort();
    assert.deepStrictEqual(languages, ['python', 'typescript']);
  });

  it('deduplicates language (tsconfig + package.json both → 1 typescript)', () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}');
    writeFileSync(join(tempDir, 'package.json'), '{}');
    const config = autoDetectConfig(tempDir);
    assert.ok(config);
    const tsServers = config.languageServers.filter((s) => s.language === 'typescript');
    assert.equal(tsServers.length, 1);
  });

  it('walks up to parent directory for markers', () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}');
    const subDir = join(tempDir, 'src', 'components');
    mkdirSync(subDir, { recursive: true });
    const config = autoDetectConfig(subDir);
    assert.ok(config);
    assert.equal(config.workspaceDir, tempDir);
  });

  it('returns null when no markers found', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'lsp-bridge-nomarker-'));
    try {
      const config = autoDetectConfig(emptyDir);
      assert.equal(config, null);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
