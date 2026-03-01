import { extname } from 'node:path';
import { LspClient } from './client.ts';
import type { LspConfig, LspServerConfig } from '../config.ts';

export class LspManager {
  private config: LspConfig;
  private clients = new Map<string, LspClient>();
  // extension → server config mapping (built from config)
  private extensionMap = new Map<string, LspServerConfig>();

  constructor(config: LspConfig) {
    this.config = config;
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

  async getClientForFile(filePath: string): Promise<LspClient> {
    const ext = extname(filePath).toLowerCase();
    if (!ext) {
      throw new Error(
        `Cannot determine language server for '${filePath}': no file extension. ` +
        `Configured extensions: ${[...this.extensionMap.keys()].join(', ')}`
      );
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
      client = new LspClient(serverConfig, this.config.workspaceDir);
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

  async shutdownAll(): Promise<void> {
    const promises = [...this.clients.values()].map((c) => c.shutdown());
    await Promise.allSettled(promises);
    this.clients.clear();
  }
}
