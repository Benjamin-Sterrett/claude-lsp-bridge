import { extname } from 'node:path';
import { LspClient } from './client.ts';
import type { LspConfig } from '../config.ts';

export class LspManager {
  private config: LspConfig;
  private clients = new Map<string, LspClient>();
  // extension → language mapping (built from config)
  private extensionMap = new Map<string, string>();

  constructor(config: LspConfig) {
    this.config = config;
    for (const server of config.languageServers) {
      for (const ext of server.extensions) {
        const normalized = ext.toLowerCase();
        const existing = this.extensionMap.get(normalized);
        if (existing) {
          throw new Error(
            `Extension '${normalized}' is registered for both '${existing}' and '${server.language}'. ` +
            `Each extension must map to exactly one language server.`
          );
        }
        this.extensionMap.set(normalized, server.language);
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

    const language = this.extensionMap.get(ext);
    if (!language) {
      throw new Error(
        `No language server configured for extension '${ext}'. ` +
        `Configured extensions: ${[...this.extensionMap.keys()].join(', ')}`
      );
    }

    let client = this.clients.get(language);
    if (!client) {
      const serverConfig = this.config.languageServers.find((s) => s.language === language);
      if (!serverConfig) {
        throw new Error(`No server config found for language '${language}'`);
      }
      client = new LspClient(serverConfig, this.config.workspaceDir);
      this.clients.set(language, client);
    }

    // Lazy init — initialize on first use
    await client.initialize();
    return client;
  }

  getClient(language: string): LspClient | undefined {
    return this.clients.get(language);
  }

  async shutdownAll(): Promise<void> {
    const promises = [...this.clients.values()].map((c) => c.shutdown());
    await Promise.allSettled(promises);
    this.clients.clear();
  }
}
