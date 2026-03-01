import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import {
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
  type PublishDiagnosticsParams,
  type Diagnostic,
} from 'vscode-languageserver-protocol';
import { filePathToUri, type PositionEncoding } from '../types.ts';
import type { LspServerConfig } from '../config.ts';

const INIT_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const RESTART_BACKOFF_MS = 2_000;

export interface DiagnosticsEntry {
  uri: string;
  version: number | undefined;
  diagnostics: Diagnostic[];
  receivedAt: number;
}

export class LspClient {
  readonly language: string;
  private config: LspServerConfig;
  private workspaceDir: string;
  private process: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  private restartCount = 0;
  private syncKind: TextDocumentSyncKind = TextDocumentSyncKind.None;
  private openCloseSupported = false;
  private positionEncoding: PositionEncoding = 'utf-16';

  // Track open documents: uri → { version, content }
  private openDocuments = new Map<string, { version: number; content: string }>();

  // Diagnostics cache: uri → DiagnosticsEntry
  private diagnosticsCache = new Map<string, DiagnosticsEntry>();

  constructor(config: LspServerConfig, workspaceDir: string) {
    this.language = config.language;
    this.config = config;
    this.workspaceDir = workspaceDir;
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.disposed) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.spawnAndInit();
      await this.rehydrateDocuments();
    })().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async spawnAndInit(): Promise<void> {
    const env = { ...process.env, ...this.config.env };
    this.process = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.workspaceDir,
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    // Wait for successful spawn before creating connection —
    // prevents ERR_STREAM_DESTROYED if command doesn't exist
    await new Promise<void>((resolve, reject) => {
      this.process!.once('spawn', resolve);
      this.process!.once('error', (err) => {
        reject(new Error(
          `[${this.language}] Failed to spawn '${this.config.command}': ${err.message}. ` +
          `Ensure the command is installed and in PATH.`
        ));
      });
    });

    this.process.on('exit', (code, signal) => {
      if (this.disposed) return;
      console.error(`[${this.language}] LSP process exited: code=${code}, signal=${signal}`);
      this.initialized = false;
      this.connection = null;
      this.process = null;
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error(
        `[${this.language}] Failed to create stdio pipes for '${this.config.command}'. ` +
        `Ensure the command exists and is executable.`
      );
    }

    this.connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout),
      new StreamMessageWriter(this.process.stdin),
    );

    // Listen for diagnostics
    this.connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: PublishDiagnosticsParams) => {
        this.diagnosticsCache.set(params.uri, {
          uri: params.uri,
          version: params.version,
          diagnostics: params.diagnostics,
          receivedAt: Date.now(),
        });
      },
    );

    this.connection.listen();

    // LSP initialize handshake
    const initParams: InitializeParams = {
      processId: process.pid,
      clientInfo: { name: 'claude-lsp-bridge', version: '1.0.0' },
      rootUri: filePathToUri(this.workspaceDir),
      capabilities: {
        general: {
          positionEncodings: ['utf-8', 'utf-16'],
        },
        textDocument: {
          synchronization: {
            didSave: false,
            willSave: false,
            willSaveWaitUntil: false,
          },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: {
            dynamicRegistration: false,
            contentFormat: ['markdown', 'plaintext'],
          },
          documentSymbol: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: {
          symbol: { dynamicRegistration: false },
          workspaceFolders: true,
        },
      },
      workspaceFolders: [
        { uri: filePathToUri(this.workspaceDir), name: 'workspace' },
      ],
      initializationOptions: this.config.initializationOptions,
    };

    let initTimer: ReturnType<typeof setTimeout> | undefined;
    let result: InitializeResult;
    try {
      result = await Promise.race([
        this.connection.sendRequest<InitializeResult>('initialize', initParams),
        new Promise<never>((_, reject) => {
          initTimer = setTimeout(
            () => reject(new Error(`LSP initialize timed out after ${INIT_TIMEOUT_MS}ms`)),
            INIT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      clearTimeout(initTimer);
      // Clean up spawned process on init failure
      this.connection.dispose();
      this.connection = null;
      if (this.process) {
        const proc = this.process;
        proc.kill('SIGTERM');
        // Escalate to SIGKILL if process hasn't exited within 1s
        // Note: proc.killed only means signal was sent, not that process exited
        const killTimer = setTimeout(() => {
          if (proc.exitCode === null) proc.kill('SIGKILL');
        }, 1000);
        killTimer.unref();
      }
      this.process = null;
      throw err;
    }
    clearTimeout(initTimer);

    // Parse server capabilities
    const caps = result.capabilities;

    // Determine sync kind and openClose support
    if (typeof caps.textDocumentSync === 'number') {
      this.syncKind = caps.textDocumentSync;
      // Numeric sync kind implies openClose support
      this.openCloseSupported = caps.textDocumentSync !== TextDocumentSyncKind.None;
    } else if (caps.textDocumentSync && typeof caps.textDocumentSync === 'object') {
      const syncOpts = caps.textDocumentSync as { change?: number; openClose?: boolean };
      this.syncKind = (syncOpts.change ?? TextDocumentSyncKind.None) as TextDocumentSyncKind;
      this.openCloseSupported = syncOpts.openClose ?? false;
    }
    if (this.syncKind === TextDocumentSyncKind.None && !this.openCloseSupported) {
      console.warn(`[${this.language}] Server does not support document sync`);
    }

    // Determine position encoding — default to UTF-16 per LSP 3.17 spec
    const serverEncoding = (caps as { positionEncoding?: string }).positionEncoding;
    if (serverEncoding === 'utf-8' || serverEncoding === 'utf-16' || serverEncoding === 'utf-32') {
      this.positionEncoding = serverEncoding;
    } else {
      this.positionEncoding = 'utf-16';
    }

    await this.connection.sendNotification('initialized', {});
    this.initialized = true;
    this.restartCount = 0;
  }

  getPositionEncoding(): PositionEncoding {
    return this.positionEncoding;
  }

  getDiagnostics(uri: string): DiagnosticsEntry | undefined {
    return this.diagnosticsCache.get(uri);
  }

  async syncFile(filePath: string): Promise<string> {
    await this.ensureReady();
    const uri = filePathToUri(filePath);
    const content = readFileSync(filePath, 'utf-8');
    const existing = this.openDocuments.get(uri);

    if (!existing) {
      // First time — didOpen (or didChange for change-only servers)
      this.openDocuments.set(uri, { version: 1, content });
      if (this.openCloseSupported) {
        await this.connection!.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: this.language,
            version: 1,
            text: content,
          },
        });
      } else if (this.syncKind !== TextDocumentSyncKind.None) {
        // Server supports change notifications but not openClose —
        // send didChange with initial text so server has the document content
        await this.connection!.sendNotification('textDocument/didChange', {
          textDocument: { uri, version: 1 },
          contentChanges: [{ text: content }],
        });
      }
    } else if (existing.content !== content) {
      // Content changed — didChange (full text)
      const newVersion = existing.version + 1;
      this.openDocuments.set(uri, { version: newVersion, content });
      if (this.syncKind !== TextDocumentSyncKind.None) {
        await this.connection!.sendNotification('textDocument/didChange', {
          textDocument: { uri, version: newVersion },
          contentChanges: [{ text: content }],
        });
      }
    }

    return uri;
  }

  async sendRequest<R>(method: string, params: unknown): Promise<R> {
    await this.ensureReady();
    return this.connection!.sendRequest(method, params) as Promise<R>;
  }

  private async ensureReady(): Promise<void> {
    if (this.disposed) throw new Error(`LspClient(${this.language}) is disposed`);
    if (this.initialized && this.connection) return;

    // Serialize restart — if already restarting, wait for that attempt
    if (this.initPromise) return this.initPromise;

    // Attempt restart if process died
    if (this.restartCount >= 1) {
      throw new Error(
        `LspClient(${this.language}) crashed and restart failed. ` +
        `Ensure '${this.config.command}' is installed and in PATH.`
      );
    }

    this.restartCount++;
    console.error(`[${this.language}] Attempting restart (attempt ${this.restartCount})...`);

    this.initPromise = (async () => {
      await new Promise((resolve) => setTimeout(resolve, RESTART_BACKOFF_MS));

      // Abort restart if shutdown was called during backoff
      if (this.disposed) {
        throw new Error(`LspClient(${this.language}) was disposed during restart`);
      }

      // Re-init from scratch + rehydrate open documents
      await this.spawnAndInit();
      await this.rehydrateDocuments();
    })().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  private async rehydrateDocuments(): Promise<void> {
    for (const [uri, doc] of this.openDocuments) {
      if (this.openCloseSupported) {
        await this.connection!.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: this.language,
            version: doc.version,
            text: doc.content,
          },
        });
      } else if (this.syncKind !== TextDocumentSyncKind.None) {
        await this.connection!.sendNotification('textDocument/didChange', {
          textDocument: { uri, version: doc.version },
          contentChanges: [{ text: doc.content }],
        });
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // Wait for any pending restart to abort before proceeding
    if (this.initPromise) {
      try { await this.initPromise; } catch { /* restart will abort via disposed check */ }
    }

    if (this.connection && this.initialized) {
      try {
        // Close all open documents
        if (this.openCloseSupported) {
          for (const uri of this.openDocuments.keys()) {
            await this.connection.sendNotification('textDocument/didClose', {
              textDocument: { uri },
            });
          }
        }
        this.openDocuments.clear();

        // LSP shutdown + exit with timeout
        let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            this.connection.sendRequest('shutdown'),
            new Promise<void>((resolve) => {
              shutdownTimer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
            }),
          ]);
        } finally {
          clearTimeout(shutdownTimer);
        }
        await this.connection.sendNotification('exit');
      } catch {
        // Ignore errors during shutdown
      }

      this.connection.dispose();
      this.connection = null;
    }

    // Force kill if still running
    if (this.process && this.process.exitCode === null) {
      const proc = this.process;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill('SIGKILL');
        }
      }, 1000);
    }

    this.initialized = false;
    this.diagnosticsCache.clear();
  }
}
