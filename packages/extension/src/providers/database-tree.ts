import * as vscode from 'vscode';
import type { ConnectionConfig, DatabaseType, TableInfo, ColumnInfo, IndexInfo, ForeignKeyInfo, ServerInfo } from '@dbmanager/shared';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { DatabaseAdapter, RedisAdapter } from '../adapters/base.js';
import type { PostgresqlAdapter } from '../adapters/postgresql.js';

export type NodeType =
  | 'group'
  | 'connection'
  | 'database'
  | 'schema'
  | 'schemaGroup'
  | 'tableGroup'
  | 'viewGroup'
  | 'table'
  | 'view'
  | 'column'
  | 'index'
  | 'foreignKey'
  | 'redisDb'
  | 'redisKey'
  | 'serverInfo'
  | 'triggerGroup'
  | 'trigger'
  | 'extensionGroup'
  | 'extension'
  | 'roleGroup'
  | 'role';

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
  // database/schema 노드에 DB 타입 정보 포함 (e.g. "database-mysql", "schema-postgresql")
  if (node.nodeType === 'database' || node.nodeType === 'schema') {
    const config = connectionManager.getConnection(node.connectionId);
    if (config) {
      return `${node.nodeType}-${config.type}`;
    }
  }
  return node.nodeType;
}

function getCollapsibleState(nodeType: NodeType): vscode.TreeItemCollapsibleState {
  switch (nodeType) {
    case 'group':
    case 'connection':
    case 'database':
    case 'schema':
    case 'schemaGroup':
    case 'tableGroup':
    case 'viewGroup':
    case 'redisDb':
    case 'triggerGroup':
    case 'extensionGroup':
    case 'roleGroup':
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
    case 'schemaGroup':
      return new vscode.ThemeIcon('folder-library');
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
    case 'triggerGroup':
      return new vscode.ThemeIcon('zap');
    case 'trigger':
      return new vscode.ThemeIcon('zap');
    case 'extensionGroup':
      return new vscode.ThemeIcon('extensions');
    case 'extension':
      return new vscode.ThemeIcon('extensions');
    case 'roleGroup':
      return new vscode.ThemeIcon('organization');
    case 'role':
      return new vscode.ThemeIcon('person');
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
      item.description = connected ? vscode.l10n.t('Connected') : '';
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

    // 테이블/뷰 클릭 시 데이터 뷰 열기
    if (node.nodeType === 'table' || node.nodeType === 'view') {
      item.command = {
        command: 'dbmanager.viewTableData',
        title: vscode.l10n.t('View Data'),
        arguments: [node],
      };
    }

    // Redis DB 클릭 시 브라우저 열기
    if (node.nodeType === 'redisDb') {
      item.command = {
        command: 'dbmanager.viewRedisData',
        title: vscode.l10n.t('Browse Keys'),
        arguments: [node],
      };
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
      case 'schemaGroup':
        return this.getSchemaGroupChildren(node);
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
      case 'triggerGroup':
        return this.getTriggerGroupChildren(node);
      case 'extensionGroup':
        return this.getExtensionGroupChildren(node);
      case 'roleGroup':
        return this.getRoleGroupChildren(node);
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
          vscode.l10n.t('Failed to connect "{0}": {1}', config.name, err instanceof Error ? err.message : String(err)),
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
        serverInfoNodes.push(...this.buildServerInfoNodes(node.connectionId, config, info));
      } catch {
        // Server info is optional — skip on failure
      }
    }

    if (config.type === 'redis') {
      const redisAdapter = adapter as RedisAdapter;
      try {
        const keycounts = await redisAdapter.getDbKeycounts();
        // 키가 있는 DB만 표시
        const redisNodes: DbTreeNode[] = [];
        for (const [db, count] of keycounts) {
          redisNodes.push({
            nodeType: 'redisDb',
            label: vscode.l10n.t('DB {0} ({1} keys)', db, count.toLocaleString()),
            connectionId: node.connectionId,
            redisDb: db,
          });
        }
        // 키가 하나도 없으면 DB 0만 표시
        if (redisNodes.length === 0) {
          redisNodes.push({
            nodeType: 'redisDb',
            label: vscode.l10n.t('DB {0} (empty)', 0),
            connectionId: node.connectionId,
            redisDb: 0,
          });
        }
        return [...redisNodes, ...serverInfoNodes];
      } catch {
        // fallback: DB 0만 표시
        return [
          { nodeType: 'redisDb', label: vscode.l10n.t('DB {0}', 0), connectionId: node.connectionId, redisDb: 0 },
          ...serverInfoNodes,
        ];
      }
    }

    const sqlAdapter = adapter as DatabaseAdapter | undefined;
    if (!sqlAdapter) return serverInfoNodes;

    try {
      const databases = await sqlAdapter.getDatabases();
      const dbNodes: DbTreeNode[] = databases.map((db): DbTreeNode => ({
        nodeType: 'database',
        label: db,
        connectionId: node.connectionId,
        database: db,
      }));

      // PostgreSQL: 커넥션 레벨에 Roles 추가
      if (config.type === 'postgresql') {
        dbNodes.push({
          nodeType: 'roleGroup',
          label: vscode.l10n.t('Roles'),
          connectionId: node.connectionId,
        });
      }

      return [...dbNodes, ...serverInfoNodes];
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load databases: {0}', String(err)));
      return serverInfoNodes;
    }
  }

  private async getDatabaseChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const config = this.connectionManager.getConnection(node.connectionId);
    if (!config) return [];

    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    if (config.type === 'postgresql') {
      // PostgreSQL: 선택한 데이터베이스로 풀 전환
      const pgAdapter = adapter as unknown as PostgresqlAdapter;
      if (node.database && 'switchDatabase' in pgAdapter) {
        try {
          await pgAdapter.switchDatabase(node.database);
        } catch (err) {
          vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch database: {0}', String(err)));
          return [];
        }
      }
      // PostgreSQL: database → Schemas, Extensions
      return [
        {
          nodeType: 'schemaGroup',
          label: vscode.l10n.t('Schemas'),
          connectionId: node.connectionId,
          database: node.database,
        },
        {
          nodeType: 'extensionGroup',
          label: vscode.l10n.t('Extensions'),
          connectionId: node.connectionId,
          database: node.database,
        },
      ];
    } else {
      // MySQL/MariaDB/SQLite: database → tables + views directly
      return this.buildTableViewGroups(node, node.database);
    }
  }

  private async getSchemaGroupChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    try {
      const schemas = await adapter.getSchemas();
      return schemas.map((schema): DbTreeNode => ({
        nodeType: 'schema',
        label: schema,
        connectionId: node.connectionId,
        database: node.database,
        schema,
      }));
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load schemas: {0}', String(err)));
      return [];
    }
  }

  private async getSchemaChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const groups = this.buildTableViewGroups(node, node.schema);
    // PostgreSQL 스키마에 Triggers 그룹 추가
    const config = this.connectionManager.getConnection(node.connectionId);
    if (config?.type === 'postgresql') {
      groups.push({
        nodeType: 'triggerGroup',
        label: vscode.l10n.t('Triggers'),
        connectionId: node.connectionId,
        database: node.database,
        schema: node.schema,
      });
    }
    return groups;
  }

  private buildTableViewGroups(node: DbTreeNode, schema: string | undefined): DbTreeNode[] {
    return [
      {
        nodeType: 'tableGroup',
        label: vscode.l10n.t('Tables'),
        connectionId: node.connectionId,
        database: node.database,
        schema,
      },
      {
        nodeType: 'viewGroup',
        label: vscode.l10n.t('Views'),
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
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load {0}s: {1}', filterType, String(err)));
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
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load table details: {0}', String(err)));
      return [];
    }
  }

  private buildServerInfoNodes(connectionId: string, config: ConnectionConfig, info: ServerInfo): DbTreeNode[] {
    const nodes: DbTreeNode[] = [];

    // 접속 정보
    if (config.type === 'sqlite') {
      nodes.push({ nodeType: 'serverInfo', label: vscode.l10n.t('File: {0}', config.filepath ?? ''), connectionId });
    } else {
      const host = config.host ?? 'localhost';
      const port = config.port;
      const url = port ? `${host}:${port}` : host;
      nodes.push({ nodeType: 'serverInfo', label: vscode.l10n.t('URL: {0}', url), connectionId });
    }

    if (config.username) {
      nodes.push({ nodeType: 'serverInfo', label: vscode.l10n.t('User: {0}', config.username), connectionId });
    }

    if (config.ssh?.enabled) {
      const ssh = config.ssh;
      const sshUrl = `${ssh.username}@${ssh.host}:${ssh.port}`;
      nodes.push({ nodeType: 'serverInfo', label: vscode.l10n.t('SSH Tunnel: {0}', sshUrl), connectionId });
    }

    // 서버 정보
    const versionLabel = info.productName
      ? vscode.l10n.t('{0} {1}', info.productName, info.version)
      : vscode.l10n.t('Version: {0}', info.version);
    nodes.push({ nodeType: 'serverInfo', label: versionLabel, connectionId });

    if (info.charset) {
      nodes.push({ nodeType: 'serverInfo', label: vscode.l10n.t('Charset: {0}', info.charset), connectionId });
    }

    if (info.uptime !== undefined) {
      nodes.push({
        nodeType: 'serverInfo',
        label: vscode.l10n.t('Uptime: {0}', this.formatUptime(info.uptime)),
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

  private async getTriggerGroupChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    try {
      const result = await adapter.execute(
        `SELECT trigger_name, event_object_table, event_manipulation, action_timing
         FROM information_schema.triggers
         WHERE trigger_schema = $1
         ORDER BY trigger_name`,
        [node.schema ?? 'public'],
      );
      return result.rows.map((r): DbTreeNode => ({
        nodeType: 'trigger',
        label: `${String(r['trigger_name'])} (${String(r['action_timing'])} ${String(r['event_manipulation'])} ON ${String(r['event_object_table'])})`,
        connectionId: node.connectionId,
        database: node.database,
        schema: node.schema,
      }));
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load triggers: {0}', String(err)));
      return [];
    }
  }

  private async getExtensionGroupChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    try {
      const result = await adapter.execute(
        `SELECT extname, extversion FROM pg_extension ORDER BY extname`,
      );
      return result.rows.map((r): DbTreeNode => ({
        nodeType: 'extension',
        label: `${String(r['extname'])} (${String(r['extversion'])})`,
        connectionId: node.connectionId,
        database: node.database,
      }));
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load extensions: {0}', String(err)));
      return [];
    }
  }

  private async getRoleGroupChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as DatabaseAdapter | undefined;
    if (!adapter) return [];

    try {
      const result = await adapter.execute(
        `SELECT rolname, rolsuper, rolcanlogin FROM pg_roles ORDER BY rolname`,
      );
      return result.rows.map((r): DbTreeNode => {
        const flags: string[] = [];
        if (r['rolsuper'] === true) flags.push('superuser');
        if (r['rolcanlogin'] === true) flags.push('login');
        const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
        return {
          nodeType: 'role',
          label: `${String(r['rolname'])}${suffix}`,
          connectionId: node.connectionId,
        };
      });
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load roles: {0}', String(err)));
      return [];
    }
  }

  private async getRedisDbChildren(node: DbTreeNode): Promise<DbTreeNode[]> {
    const adapter = this.connectionManager.getAdapter(node.connectionId) as RedisAdapter | undefined;
    if (!adapter) return [];

    try {
      await adapter.selectDb(node.redisDb ?? 0);
      const result = await adapter.scan('*', '0', 100);
      return result.keys.map((key): DbTreeNode => ({
        nodeType: 'redisKey',
        label: key,
        connectionId: node.connectionId,
        redisDb: node.redisDb,
        redisKey: key,
      }));
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to scan Redis keys: {0}', String(err)));
      return [];
    }
  }
}
