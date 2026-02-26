import * as vscode from 'vscode';
import type { ConnectionConfig, ConnectionInfo } from '@dbmanager/shared';
import type { DatabaseAdapter, RedisAdapter } from '../adapters/base.js';
import { SshTunnelManager } from './ssh-tunnel.js';

const CONNECTIONS_KEY = 'dbmanager.connections';
const PASSWORD_KEY_PREFIX = 'dbmanager.password.';
const SSH_PASSWORD_KEY_PREFIX = 'dbmanager.ssh-password.';
const SSH_PASSPHRASE_KEY_PREFIX = 'dbmanager.ssh-passphrase.';

export class ConnectionManager {
  private readonly context: vscode.ExtensionContext;
  private readonly adapters = new Map<string, DatabaseAdapter | RedisAdapter>();
  private readonly connectedIds = new Set<string>();
  readonly sshTunnels = new SshTunnelManager();

  private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this._onDidChangeConnections.event;

  private readonly _onDidChangeConnectionState = new vscode.EventEmitter<{
    connectionId: string;
    connected: boolean;
  }>();
  readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  getConnections(): ConnectionConfig[] {
    return this.context.globalState.get<ConnectionConfig[]>(CONNECTIONS_KEY, []);
  }

  getConnectionInfos(): ConnectionInfo[] {
    return this.getConnections().map((cfg) => ({
      ...cfg,
      isConnected: this.connectedIds.has(cfg.id),
    }));
  }

  getConnection(id: string): ConnectionConfig | undefined {
    return this.getConnections().find((c) => c.id === id);
  }

  isConnected(id: string): boolean {
    return this.connectedIds.has(id);
  }

  async saveConnection(
    config: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string,
  ): Promise<void> {
    const connections = this.getConnections();
    const idx = connections.findIndex((c) => c.id === config.id);
    if (idx >= 0) {
      connections[idx] = config;
    } else {
      connections.push(config);
    }
    await this.context.globalState.update(CONNECTIONS_KEY, connections);

    if (password !== undefined) {
      await this.context.secrets.store(PASSWORD_KEY_PREFIX + config.id, password);
    }
    if (sshPassword !== undefined) {
      await this.context.secrets.store(SSH_PASSWORD_KEY_PREFIX + config.id, sshPassword);
    }
    if (sshPassphrase !== undefined) {
      await this.context.secrets.store(SSH_PASSPHRASE_KEY_PREFIX + config.id, sshPassphrase);
    }

    this._onDidChangeConnections.fire();
  }

  async deleteConnection(id: string): Promise<void> {
    // Disconnect if active
    if (this.connectedIds.has(id)) {
      await this.disconnect(id);
    }

    const connections = this.getConnections().filter((c) => c.id !== id);
    await this.context.globalState.update(CONNECTIONS_KEY, connections);
    await this.context.secrets.delete(PASSWORD_KEY_PREFIX + id);
    await this.context.secrets.delete(SSH_PASSWORD_KEY_PREFIX + id);
    await this.context.secrets.delete(SSH_PASSPHRASE_KEY_PREFIX + id);

    this._onDidChangeConnections.fire();
  }

  async getPassword(id: string): Promise<string | undefined> {
    return this.context.secrets.get(PASSWORD_KEY_PREFIX + id);
  }

  async getSshPassword(id: string): Promise<string | undefined> {
    return this.context.secrets.get(SSH_PASSWORD_KEY_PREFIX + id);
  }

  async getSshPassphrase(id: string): Promise<string | undefined> {
    return this.context.secrets.get(SSH_PASSPHRASE_KEY_PREFIX + id);
  }

  async connect(id: string): Promise<void> {
    const config = this.getConnection(id);
    if (!config) {
      throw new Error(`Connection not found: ${id}`);
    }

    // If already connected, no-op
    if (this.connectedIds.has(id)) {
      return;
    }

    // Adapter creation is lazy — concrete adapters (mysql, pg, sqlite, redis)
    // will be implemented separately. For now, we mark as connected once the
    // adapter resolves successfully.
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.connect();
    } else {
      // Adapter not yet instantiated — will be wired up when concrete adapters land.
      // Optimistically mark connected so the tree reflects state.
      vscode.window.showInformationMessage(
        `Adapter for "${config.type}" is not implemented yet. Connection marked as pending.`,
      );
    }

    this.connectedIds.add(id);
    this._onDidChangeConnectionState.fire({ connectionId: id, connected: true });
  }

  async disconnect(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.disconnect();
      adapter.dispose();
      this.adapters.delete(id);
    }

    await this.sshTunnels.closeTunnel(id);

    this.connectedIds.delete(id);
    this._onDidChangeConnectionState.fire({ connectionId: id, connected: false });
  }

  getAdapter(id: string): DatabaseAdapter | RedisAdapter | undefined {
    return this.adapters.get(id);
  }

  registerAdapter(id: string, adapter: DatabaseAdapter | RedisAdapter): void {
    const existing = this.adapters.get(id);
    if (existing) {
      existing.dispose();
    }
    this.adapters.set(id, adapter);
  }

  dispose(): void {
    for (const [, adapter] of this.adapters) {
      adapter.dispose();
    }
    this.adapters.clear();
    this.connectedIds.clear();
    this.sshTunnels.dispose();
    this._onDidChangeConnections.dispose();
    this._onDidChangeConnectionState.dispose();
  }
}
