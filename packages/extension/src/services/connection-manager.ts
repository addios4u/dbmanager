import * as vscode from 'vscode';
import type { ConnectionConfig, ConnectionInfo } from '@dbmanager/shared';
import type { DatabaseAdapter, RedisAdapter } from '../adapters/base.js';
import { MysqlAdapter } from '../adapters/mysql.js';
import { MariadbAdapter } from '../adapters/mariadb.js';
import { PostgresqlAdapter } from '../adapters/postgresql.js';
import { SqliteAdapter } from '../adapters/sqlite.js';
import { RedisAdapterImpl } from '../adapters/redis.js';
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

    let adapter = this.adapters.get(id);
    if (!adapter) {
      adapter = await this.createAdapter(id, config);
      this.adapters.set(id, adapter);
    }

    await adapter.connect();

    this.connectedIds.add(id);
    this._onDidChangeConnectionState.fire({ connectionId: id, connected: true });
  }

  private async createAdapter(
    id: string,
    config: ConnectionConfig,
  ): Promise<DatabaseAdapter | RedisAdapter> {
    const password = await this.getPassword(id);
    let connectHost = config.host;
    let connectPort = config.port;

    // SSH 터널이 활성화된 경우 터널 생성 후 로컬 포트로 연결
    if (config.ssh?.enabled) {
      const sshPassword = await this.getSshPassword(id);
      const sshPassphrase = await this.getSshPassphrase(id);
      const localPort = await this.sshTunnels.createTunnel(config, sshPassword, sshPassphrase);
      connectHost = '127.0.0.1';
      connectPort = localPort;
    }

    switch (config.type) {
      case 'mysql':
        return new MysqlAdapter(config, password, connectHost, connectPort);
      case 'mariadb':
        return new MariadbAdapter(config, password, connectHost, connectPort);
      case 'postgresql':
        return new PostgresqlAdapter(config, password, connectHost, connectPort);
      case 'sqlite':
        return new SqliteAdapter(config);
      case 'redis':
        return new RedisAdapterImpl(config, password, connectHost, connectPort);
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }
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
