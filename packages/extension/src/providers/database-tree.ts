import * as vscode from 'vscode';
import type { DatabaseType, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo, ServerInfo } from '@dbmanager/shared';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { DatabaseAdapter, RedisAdapter } from '../adapters/base.js';

export type NodeType =
  | 'group'
  | 'connection'
  | 'database'
  | 'schema'
  | 'tableGroup'
  | 'viewGroup'
  | 'table'
  | 'view'
  | 'column'
  | 'index'
  | 'foreignKey'
  | 'redisDb'
  | 'redisKey'
  | 'serverInfo';

export interface DbTreeNode {
  nodeType: NodeType;
  label: string;
  connectionId: string;
  // Optional contextual fields depending on nodeType
  database?: string;
  schema?: string;
  tableName?: string;
  columnName?: string;
  redisDb?: number;
  redisKey?: string;
  dbType?: DatabaseType;
  columnInfo?: ColumnInfo;
  indexInfo?: IndexInfo;
  foreignKeyInfo?: ForeignKeyInfo;
}

function getContextValue(node: DbTreeNode, connectionManager: ConnectionManager): string {
  if (node.nodeType === 'connection') {
    return connectionManager.isConnected(node.connectionId)
      ? 'connection-connected'
      : 'connection-disconnected';
  }
  return node.nodeType;
}

function getCollapsibleState(nodeType: NodeType): vscode.TreeItemCollapsibleState {
  switch (nodeType) {
    case 'group':
    case 'connection':
    case 'database':
    case 'schema':
    case 'tableGroup':
    case 'viewGroup':
    case 'redisDb':
      return vscode.TreeItemCollapsibleState.Collapsed;
    case 'table':
    case 'view':
      return vscode.TreeItemCollapsibleState.Collapsed;
    default:
      return vscode.TreeItemCollapsibleState.None;
  }
}

function getConnectionIcon(
  node: DbTreeNode,
  connectionManager: ConnectionManager,
  extensionUri: vscode.Uri,
): { light: vscode.Uri; dark: vscode.Uri } | vscode.ThemeIcon {
  const dbType = node.dbType ?? 'mysql';
  const iconFile = `${dbType}.svg`;
  const iconUri = vscode.Uri.joinPath(extensionUri, 'resources', 'icons', iconFile);
  return { light: iconUri, dark: iconUri };
}

function getIconId(
  node: DbTreeNode,
  connectionManager: ConnectionManager,
  extensionUri: vscode.Uri,
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } | undefined {
  switch (node.nodeType) {
    case 'connection':
      return getConnectionIcon(node, connectionManager, extensionUri);
    case 'database':
      return new vscode.ThemeIcon('server');
    case 'schema':
      return new vscode.ThemeIcon('folder');
    case 'tableGroup':
      return new vscode.ThemeIcon('list-flat');
    case 'viewGroup':
      return new vscode.ThemeIcon('eye');
    case 'table':
      return new vscode.ThemeIcon('table');
    case 'view':
      return new vscode.ThemeIcon('eye');
    case 'column':
      return new vscode.ThemeIcon('symbol-field');
    case 'index':
      return new vscode.ThemeIcon('symbol-key');
    case 'foreignKey':
      return new vscode.ThemeIcon('link');
    case 'redisDb':
      return new vscode.ThemeIcon('server-environment');
    case 'redisKey':
      return new vscode.ThemeIcon('symbol-string');
    case 'serverInfo':
      return new vscode.ThemeIcon('info');
    default:
      return undefined;
  }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DbTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DbTreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly connectingIds = new Set<string>();
  private readonly disconnectGen = new Map<string, number>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri,
  ) {
    // Re-render tree when connection state changes
    this.connectionManager.onDidChangeConnections(() => this._onDidChangeTreeData.fire(null));
    this.connectionManager.onDidChangeConnectionState(({ connectionId, connected }) => {
      if (!connected) {
        // disconnect 시 세대를 올려서 VS Code가 새 노드로 인식 → 접힘 상태 리셋
        this.disconnectGen.set(connectionId, (this.disconnectGen.get(connectionId) ?? 0) + 1);
      }
      this._onDidChangeTreeData.fire(null);
    });
  }

  refresh(node?: DbTreeNode): void {
    this._onDidChangeTreeData.fire(node ?? null);
  }

  getTreeItem(node: DbTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, getCollapsibleState(node.nodeType));
    item.contextValue = getContextValue(node, this.connectionManager);
    item.iconPath = getIconId(node, this.connectionManager, this.extensionUri);

    // Disconnect 시 세대(generation)가 올라가서 id가 바뀌면
    // VS Code가 새 노드로 인식하고 collapsibleState를 Collapsed로 리셋함.
    // Connect 시에는 세대가 변하지 않아 펼침 상태가 유지됨.
    if (node.nodeType === 'connection') {
      const gen = this.disconnectGen.get(node.connectionId) ?? 0;
      item.id = `${node.connectionId}-${gen}`;
      const connected = this.connectionManager.isConnected(node.connectionId);
      item.description = connected ? 'Connected' : '';
    }

    // Tooltip
    if (node.nodeType === 'column' && node.columnInfo) {
      const col = node.columnInfo;
      item.tooltip = new vscode.MarkdownString(
        `**${col.name}** \`${col.type}\`\n\n` +
          `Nullable: ${col.nullable}\n\n` +
          `Primary Key: ${col.isPrimaryKey}\n\n` +
          `Auto Increment: ${col.isAutoIncrement}` +
          (col.defaultValue !== null ? `\n\nDefault: \`${col.defaultValue}\`` : '') +
          (col.comment ? `\n\n${col.comment}` : ''),
      );
    }

    return item;
  }

  async getChildren(node?: DbTreeNode): Promise<DbTreeNode[]> {
    if (!node) {
      return this.getRootNodes();
    }

    switch (node.nodeType) {
      case 'connection':
        return this.getConnectionChildren(node);
      case 'database':
        return this.getDatabaseChildren(node);
      case 'schema':
        return this.getSchemaChildren(node);
      case 'tableGroup':
        return this.getTablesForGroup(node, 'table');
      case 'viewGroup':
        return this.getTablesForGroup(node, 'view');
      case 'table':
      case 'view':
        return this.getTableChildren(node);
      case 'redisDb':
        return this.getRedisDbChildren(node);
      default:
        return [];
    }
  }

  private getRootNodes(): DbTreeNode[] {
    const connections = this.connectionManager.getConnections();
    return connections.map((cfg): DbTreeNode => ({
      nodeType: 'connection',
      label: cfg.name,
      connectionId: cfg.id,
      dbType: cfg.type,
    }));
  }

  private async getConnectionChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const config = this.connectionManager.getConnection(node.connectionId);
    if (!config) return [];

    // Auto-connect if not connected
    if (!this.connectionManager.isConnected(node.connectionId)) {
      if (this.connectingIds.has(node.connectionId)) {
        return [];
      }
      this.connectingIds.add(node.connectionId);
      try {
        await this.connectionManager.connect(node.connectionId);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to connect "${config.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      } finally {
        this.connectingIds.delete(node.connectionId);
      }
    }

    // Build server info nodes (non-fatal if adapter missing or fails)
    const serverInfoNodes: DbTreeNode[] = [];
    const adapter = this.connectionManager.getAdapter(node.connectionId);
    if (adapter && 'getServerInfo' in adapter) {
      try {
        const info = await (adapter as DatabaseAdapter | RedisAdapter).getServerInfo();
        serverInfoNodes.push(...this.buildServerInfoNodes(node.connectionId, info));
      } catch {
        // Server info is optional — skip on failure
      }
    }

    if (config.type === 'redis') {
      // Redis: show DB 0-15
      const redisNodes = Array.from({ length: 16 }, (_, i): DbTreeNode => ({
        nodeType: 'redisDb',
        label: `DB ${i}`,
        connectionId: node.connectionId,
        redisDb: i,
      }));
      return [...redisNodes, ...serverInfoNodes];
    }

    const sqlAdapter = adapter as DatabaseAdapter | undefined;
    if (!sqlAdapter) return serverInfoNodes;

    try {
      const databases = await sqlAdapter.getDatabases();
      const dbNodes = databases.map((db): DbTreeNode => ({
        nodeType: 'database',
        label: db,
        connectionId: node.connectionId,
        database: db,
      }));
      return [...dbNodes, ...serverInfoNodes];
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load databases: ${String(err)}`);
      return serverInfoNodes;
    }
  }

  private async getDatabaseChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const config = this.connectionManager.getConnection(node.connectionId);
    if (!config) return [];

    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    try {
      if (config.type === 'postgresql') {
        // PostgreSQL has schemas inside databases
        const schemas = await adapter.getSchemas();
        return schemas.map((schema): DbTreeNode => ({
          nodeType: 'schema',
          label: schema,
          connectionId: node.connectionId,
          database: node.database,
          schema,
        }));
      } else {
        // MySQL/MariaDB/SQLite: database → tables + views directly
        return this.buildTableViewGroups(node, node.database);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load database children: ${String(err)}`);
      return [];
    }
  }

  private async getSchemaChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    return this.buildTableViewGroups(node, node.schema);
  }

  private buildTableViewGroups(node: DbTreeNode, schema: string | undefined): DbTreeNode[] {
    return [
      {
        nodeType: 'tableGroup',
        label: 'Tables',
        connectionId: node.connectionId,
        database: node.database,
        schema,
      },
      {
        nodeType: 'viewGroup',
        label: 'Views',
        connectionId: node.connectionId,
        database: node.database,
        schema,
      },
    ];
  }

  private async getTablesForGroup(node: DbTreeNode, filterType: 'table' | 'view'): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    try {
      const tables: TableInfo[] = await adapter.getTables(node.schema);
      return tables
        .filter((t) => t.type === filterType)
        .map((t): DbTreeNode => ({
          nodeType: filterType,
          label: t.name + (t.rowCount !== undefined ? ` (${t.rowCount.toLocaleString()})` : ''),
          connectionId: node.connectionId,
          database: node.database,
          schema: node.schema,
          tableName: t.name,
        }));
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load ${filterType}s: ${String(err)}`);
      return [];
    }
  }

  private async getTableChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter || !node.tableName) return [];

    try {
      const [columns, indexes, foreignKeys] = await Promise.all([
        adapter.getColumns(node.tableName, node.schema),
        node.nodeType === 'table' ? adapter.getIndexes(node.tableName, node.schema) : Promise.resolve([]),
        node.nodeType === 'table' ? adapter.getForeignKeys(node.tableName, node.schema) : Promise.resolve([]),
      ]);

      const columnNodes: DbTreeNode[] = columns.map((col): DbTreeNode => ({
        nodeType: 'column',
        label: `${col.name} : ${col.type}${col.isPrimaryKey ? ' PK' : ''}`,
        connectionId: node.connectionId,
        database: node.database,
        schema: node.schema,
        tableName: node.tableName,
        columnName: col.name,
        columnInfo: col,
      }));

      const indexNodes: DbTreeNode[] = indexes.map((idx): DbTreeNode => ({
        nodeType: 'index',
        label: `${idx.name} (${idx.columns.join(', ')})`,
        connectionId: node.connectionId,
        database: node.database,
        schema: node.schema,
        tableName: node.tableName,
        indexInfo: idx,
      }));

      const fkNodes: DbTreeNode[] = foreignKeys.map((fk): DbTreeNode => ({
        nodeType: 'foreignKey',
        label: `${fk.column} → ${fk.referencedTable}.${fk.referencedColumn}`,
        connectionId: node.connectionId,
        database: node.database,
        schema: node.schema,
        tableName: node.tableName,
        foreignKeyInfo: fk,
      }));

      return [...columnNodes, ...indexNodes, ...fkNodes];
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load table details: ${String(err)}`);
      return [];
    }
  }

  private buildServerInfoNodes(connectionId: string, info: ServerInfo): DbTreeNode[] {
    const nodes: DbTreeNode[] = [];

    const versionLabel = info.productName
      ? `${info.productName} ${info.version}`
      : `Version: ${info.version}`;
    nodes.push({ nodeType: 'serverInfo', label: versionLabel, connectionId });

    if (info.charset) {
      nodes.push({ nodeType: 'serverInfo', label: `Charset: ${info.charset}`, connectionId });
    }

    if (info.uptime !== undefined) {
      nodes.push({
        nodeType: 'serverInfo',
        label: `Uptime: ${this.formatUptime(info.uptime)}`,
        connectionId,
      });
    }

    if (info.extras) {
      for (const [key, value] of Object.entries(info.extras)) {
        nodes.push({ nodeType: 'serverInfo', label: `${key}: ${value}`, connectionId });
      }
    }

    return nodes;
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  private async getRedisDbChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as RedisAdapter | undefined;
    if (!adapter) return [];

    try {
      const result = await adapter.scan('*', '0', 100);
      return result.keys.map((key): DbTreeNode => ({
        nodeType: 'redisKey',
        label: key,
        connectionId: node.connectionId,
        redisDb: node.redisDb,
        redisKey: key,
      }));
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to scan Redis keys: ${String(err)}`);
      return [];
    }
  }
}
