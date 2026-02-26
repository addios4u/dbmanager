import * as vscode from 'vscode';
import type { DatabaseType, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo } from '@dbmanager/shared';
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
  | 'redisKey';

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
    default:
      return undefined;
  }
}

export class DatabaseTreeProvider implements vscode.TreeDataProvider<DbTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DbTreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri,
  ) {
    // Re-render tree when connection state changes
    this.connectionManager.onDidChangeConnections(() => this._onDidChangeTreeData.fire(null));
    this.connectionManager.onDidChangeConnectionState(() => this._onDidChangeTreeData.fire(null));
  }

  refresh(node?: DbTreeNode): void {
    this._onDidChangeTreeData.fire(node ?? null);
  }

  getTreeItem(node: DbTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, getCollapsibleState(node.nodeType));
    item.contextValue = getContextValue(node, this.connectionManager);
    item.iconPath = getIconId(node, this.connectionManager, this.extensionUri);

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

    if (!this.connectionManager.isConnected(node.connectionId)) {
      return [];
    }

    if (config.type === 'redis') {
      // Redis: show DB 0-15
      return Array.from({ length: 16 }, (_, i): DbTreeNode => ({
        nodeType: 'redisDb',
        label: `DB ${i}`,
        connectionId: node.connectionId,
        redisDb: i,
      }));
    }

    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    try {
      if (config.type === 'postgresql') {
        // PostgreSQL: databases → schemas
        const databases = await adapter.getDatabases();
        return databases.map((db): DbTreeNode => ({
          nodeType: 'database',
          label: db,
          connectionId: node.connectionId,
          database: db,
        }));
      } else {
        // MySQL/MariaDB/SQLite: databases are schemas
        const databases = await adapter.getDatabases();
        return databases.map((db): DbTreeNode => ({
          nodeType: 'database',
          label: db,
          connectionId: node.connectionId,
          database: db,
        }));
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load databases: ${String(err)}`);
      return [];
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
