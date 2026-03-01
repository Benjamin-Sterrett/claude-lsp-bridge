import { dirname, extname } from 'node:path';
import { LspClient } from './client.ts';
import { autoDetectConfig, type LspConfig, type LspServerConfig } from '../config.ts';

export class LspManager {
  private config: LspConfig | null;
  private clients = new Map<string, LspClient>();
  // extension → server config mapping (built from config)
  private extensionMap = new Map<string, LspServerConfig>();

  constructor(config: LspConfig | null) {
    this.config = config;
    if (config) {
      this.buildExtensionMap(config);
    }
  }

  private buildExtensionMap(config: LspConfig): void {
    const seenLanguages = new Set<string>();
    for (const server of config.languageServers) {
      if (seenLanguages.has(server.language)) {
        throw new Error(
          `Duplicate language '${server.language}' in config. ` +
          `Each language must have exactly one server configuration.`
        );
      }
      seenLanguages.add(server.language);
      for (const ext of server.extensions) {
        const normalized = ext.toLowerCase();
        const existing = this.extensionMap.get(normalized);
        if (existing) {
          throw new Error(
            `Extension '${normalized}' is registered for both '${existing.language}' and '${server.language}'. ` +
            `Each extension must map to exactly one language server.`
          );
        }
        this.extensionMap.set(normalized, server);
      }
    }
  }

  /**
   * Attempt to resolve config from a file path using auto-detection.
   * Called lazily when no config was provided at startup.
   */
  private resolveConfigFromFile(filePath: string): void {
    const detected = autoDetectConfig(dirname(filePath));
    if (!detected) {
      throw new Error(
        `No LSP config available and could not auto-detect workspace from '${filePath}'. ` +
        `Ensure the file is inside a project with tsconfig.json, package.json, or pyproject.toml.`
      );
    }
    this.config = detected;
    this.extensionMap.clear();
    this.buildExtensionMap(detected);
    console.error(`claude-lsp-bridge: auto-detected workspace at ${detected.workspaceDir}`);
  }

  async getClientForFile(filePath: string): Promise<LspClient> {
    const ext = extname(filePath).toLowerCase();
    if (!ext) {
      throw new Error(
        `Cannot determine language server for '${filePath}': no file extension. ` +
        `Configured extensions: ${this.config ? [...this.extensionMap.keys()].join(', ') : '(none — no config loaded)'}`
      );
    }

    // Lazy config detection: if no config at startup, detect from file path
    if (!this.config) {
      this.resolveConfigFromFile(filePath);
    }

    const serverConfig = this.extensionMap.get(ext);
    if (!serverConfig) {
      throw new Error(
        `No language server configured for extension '${ext}'. ` +
        `Configured extensions: ${[...this.extensionMap.keys()].join(', ')}`
      );
    }

    let client = this.clients.get(serverConfig.language);
    if (!client) {
      client = new LspClient(serverConfig, this.config!.workspaceDir);
      this.clients.set(serverConfig.language, client);
    }

    // Lazy init — initialize on first use
    await client.initialize();
    return client;
  }

  getClient(language: string): LspClient | undefined {
    return this.clients.get(language);
  }

  async getClientForLanguage(language: string): Promise<LspClient> {
    if (!this.config) {
      throw new Error(
        `No LSP config available. Call a file-based tool first to auto-detect workspace, ` +
        `or set the LSP_CONFIG environment variable.`
      );
    }
    let client = this.clients.get(language);
    if (!client) {
      const serverConfig = this.config.languageServers.find((s) => s.language === language);
      if (!serverConfig) {
        throw new Error(`No language server configured for '${language}'`);
      }
      client = new LspClient(serverConfig, this.config.workspaceDir);
      this.clients.set(language, client);
    }
    await client.initialize();
    return client;
  }

  getInitializedClients(): LspClient[] {
    return [...this.clients.values()];
  }

  async getAllClients(): Promise<LspClient[]> {
    if (!this.config) {
      // No config — return only already-initialized clients (may be empty)
      return this.getInitializedClients();
    }
    const clients: LspClient[] = [];
    for (const server of this.config.languageServers) {
      clients.push(await this.getClientForLanguage(server.language));
    }
    return clients;
  }

  async shutdownAll(): Promise<void> {
    const promises = [...this.clients.values()].map((c) => c.shutdown());
    await Promise.allSettled(promises);
    this.clients.clear();
  }
}
