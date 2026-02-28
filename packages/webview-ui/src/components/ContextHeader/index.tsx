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
}

const DB_TYPE_COLORS: Record<DatabaseType, string> = {
  mysql: 'var(--vscode-charts-blue, #2196f3)',
  mariadb: 'var(--vscode-charts-purple, #9c27b0)',
  postgresql: 'var(--vscode-charts-green, #009688)',
  sqlite: 'var(--vscode-charts-yellow, #ff9800)',
  redis: 'var(--vscode-charts-red, #f44336)',
};

const DB_TYPE_LABELS: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'PG',
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
        height: 32,
        padding: '0 12px',
        borderBottom: '1px solid var(--vscode-panel-border, #333)',
        flexShrink: 0,
        gap: 6,
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
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
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
              <span style={{ opacity: 0.5, flexShrink: 0 }}>{'>'}</span>
            )}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                opacity: i === breadcrumbs.length - 1 ? 1 : 0.7,
                fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
              }}
            >
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </span>

      {extraInfo && (
        <span
          style={{
            opacity: 0.6,
            fontSize: 11,
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
