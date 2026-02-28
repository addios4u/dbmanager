import React from 'react';
import type { DatabaseType } from '@dbmanager/shared';
import { useConnectionStore } from '../../stores/connection';

interface ContextHeaderProps {
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string;
  extraInfo?: string;
  badge?: string;
  actions?: React.ReactNode;
}

const DB_TYPE_COLORS: Record<DatabaseType, string> = {
  mysql: '#00758F',
  mariadb: '#6B3FA0',
  postgresql: '#336791',
  sqlite: '#ff9800',
  redis: '#DC382D',
};

const DB_TYPE_LABELS: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  redis: 'Redis',
};

export function ContextHeader({
  connectionId,
  database,
  schema,
  table,
  extraInfo,
  badge,
  actions,
}: ContextHeaderProps) {
  const connections = useConnectionStore((s) => s.connections);
  const connection = connections.find((c) => c.id === connectionId);

  const dbType = connection?.type;
  const connectionName = connection?.name ?? connectionId;

  const breadcrumbs: string[] = [connectionName];
  if (database) breadcrumbs.push(database);
  // MySQL/MariaDB: schema === database, so skip duplicate
  if (schema && schema !== database) breadcrumbs.push(schema);
  if (table) breadcrumbs.push(table);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 44,
        padding: '8px 16px',
        borderBottom: '1px solid var(--vscode-panel-border, #333)',
        flexShrink: 0,
        gap: 12,
        fontSize: 12,
        color: 'var(--vscode-breadcrumb-foreground, var(--vscode-foreground))',
        background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        overflow: 'hidden',
      }}
    >
      {dbType && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '3px 8px',
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 500,
            fontFamily: "'JetBrains Mono', var(--vscode-editor-font-family, monospace)",
            lineHeight: '16px',
            background: DB_TYPE_COLORS[dbType],
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {DB_TYPE_LABELS[dbType]}
        </span>
      )}

      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          flex: 1,
          minWidth: 0,
        }}
      >
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <span style={{ color: 'var(--vscode-descriptionForeground, #808080)', flexShrink: 0 }}>{'›'}</span>
            )}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: i === breadcrumbs.length - 1
                  ? 'var(--vscode-foreground)'
                  : 'var(--vscode-descriptionForeground, #808080)',
                fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
                fontSize: i === breadcrumbs.length - 1 ? 13 : 12,
              }}
            >
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </span>

      {actions}

      {extraInfo && (
        <span
          style={{
            color: 'var(--vscode-descriptionForeground, #808080)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', var(--vscode-editor-font-family, monospace)",
            marginLeft: 'auto',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {extraInfo}
        </span>
      )}

      {badge && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 600,
            lineHeight: '16px',
            background: 'var(--vscode-badge-background)',
            color: 'var(--vscode-badge-foreground)',
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
