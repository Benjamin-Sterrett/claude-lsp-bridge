import { z } from 'zod';
import { readFileSync, existsSync, accessSync, constants } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

// ── Zod Schemas (strict — unknown keys rejected) ──

const LspServerConfigSchema = z.object({
  language: z.string().min(1, 'language must not be empty'),
  command: z.string().min(1, 'command must not be empty'),
  args: z.array(z.string()).default([]),
  extensions: z.array(z.string().startsWith('.', 'extensions must start with .')).min(1, 'at least one extension required'),
  env: z.record(z.string()).optional(),
  initializationOptions: z.record(z.unknown()).optional(),
  rootMarkers: z.array(z.string()).optional(),
}).strict();

const LspConfigSchema = z.object({
  workspaceDir: z.string().min(1, 'workspaceDir must not be empty'),
  languageServers: z.array(LspServerConfigSchema).min(1, 'at least one language server required'),
}).strict();

export type LspConfig = z.infer<typeof LspConfigSchema>;
export type LspServerConfig = z.infer<typeof LspServerConfigSchema>;

// ── Config Loading ──

export interface LoadConfigOptions {
  envVar?: string;
  cwd?: string;
}

/**
 * Load config with deterministic precedence:
 * 1. LSP_CONFIG env var (absolute or relative to CWD)
 * 2. lsp-config.local.json in CWD
 * 3. lsp-config.json in CWD
 * 4. Auto-detect workspace from CWD marker files
 */
export function loadConfig(options: LoadConfigOptions = {}): LspConfig {
  const cwd = options.cwd ?? process.cwd();
  const envPath = options.envVar !== undefined
    ? options.envVar
    : process.env['LSP_CONFIG'];

  // Priority 1: Env var
  if (envPath) {
    const resolved = resolve(cwd, envPath);
    return loadConfigFromFile(resolved);
  }

  // Priority 2: lsp-config.local.json
  const localPath = join(cwd, 'lsp-config.local.json');
  if (existsSync(localPath)) {
    return loadConfigFromFile(localPath);
  }

  // Priority 3: lsp-config.json
  const defaultPath = join(cwd, 'lsp-config.json');
  if (existsSync(defaultPath)) {
    return loadConfigFromFile(defaultPath);
  }

  // Priority 4: Auto-detect
  const detected = autoDetectConfig(cwd);
  if (detected) {
    return detected;
  }

  throw new Error(
    `No LSP config found. Searched:\n` +
    `  1. LSP_CONFIG env var: ${envPath ?? '(not set)'}\n` +
    `  2. ${localPath}\n` +
    `  3. ${defaultPath}\n` +
    `  4. Auto-detection from CWD markers\n\n` +
    `Create lsp-config.json or set LSP_CONFIG env var.`
  );
}

function loadConfigFromFile(filePath: string): LspConfig {
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  try {
    accessSync(filePath, constants.R_OK);
  } catch {
    throw new Error(`Config file not readable: ${filePath}`);
  }

  let raw: unknown;
  try {
    const content = readFileSync(filePath, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config file ${filePath}: ${message}`);
  }

  // Resolve relative workspaceDir against config file directory
  if (typeof raw === 'object' && raw !== null && 'workspaceDir' in raw) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj['workspaceDir'] === 'string' && !obj['workspaceDir'].startsWith('/')) {
      obj['workspaceDir'] = resolve(dirname(filePath), obj['workspaceDir']);
    }
  }

  return validateConfig(raw, filePath);
}

function validateConfig(raw: unknown, source: string): LspConfig {
  const result = LspConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return `  - ${path || '(root)'}: ${issue.message}`;
    }).join('\n');
    throw new Error(`Invalid config (${source}):\n${issues}`);
  }
  return result.data;
}

// ── Auto-Detection ──

interface MarkerConfig {
  marker: string;
  language: string;
  command: string;
  args: string[];
  extensions: string[];
}

const MARKERS: MarkerConfig[] = [
  {
    marker: 'tsconfig.json',
    language: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  {
    marker: 'package.json',
    language: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  {
    marker: 'pyproject.toml',
    language: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py', '.pyi'],
  },
  {
    marker: 'requirements.txt',
    language: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py', '.pyi'],
  },
  {
    marker: 'setup.py',
    language: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py', '.pyi'],
  },
];

/**
 * Walk up from cwd looking for marker files. First match wins per language.
 * Returns null if no markers found.
 */
export function autoDetectConfig(cwd: string): LspConfig | null {
  const workspaceDir = findWorkspaceRoot(cwd);
  if (!workspaceDir) return null;

  const seen = new Set<string>();
  const servers: LspConfig['languageServers'] = [];

  for (const m of MARKERS) {
    if (seen.has(m.language)) continue;
    if (existsSync(join(workspaceDir, m.marker))) {
      seen.add(m.language);
      servers.push({
        language: m.language,
        command: m.command,
        args: m.args,
        extensions: m.extensions,
      });
    }
  }

  if (servers.length === 0) return null;

  return { workspaceDir, languageServers: servers };
}

function findWorkspaceRoot(startDir: string): string | null {
  const allMarkers = [...new Set(MARKERS.map((m) => m.marker))];
  let dir = resolve(startDir);
  const root = '/';

  while (true) {
    for (const marker of allMarkers) {
      if (existsSync(join(dir, marker))) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }

  return null;
}
