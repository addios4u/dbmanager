import React, { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { postMessage } from '../../vscode-api';
import { ContextHeader } from '../ContextHeader';

interface DDLViewProps {
  connectionId: string;
  table: string;
  schema?: string;
}

export function DDLView({ connectionId, table, schema }: DDLViewProps) {
  const [ddl, setDdl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  useEffect(() => {
    setIsLoading(true);
    setDdl('');
    postMessage({ type: 'getTableDDL', connectionId, table, schema });
  }, [connectionId, table, schema]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'tableDDL' && msg.table === table && msg.connectionId === connectionId) {
        setDdl(msg.ddl as string);
        setIsLoading(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [connectionId, table]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ContextHeader
        connectionId={connectionId}
        schema={schema}
        table={table}
        badge="DDL"
      />
      {isLoading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: 'var(--vscode-foreground)',
            opacity: 0.7,
            fontSize: 13,
          }}
        >
          Loading DDL...
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            language="sql"
            value={ddl}
            theme={isDark ? 'vs-dark' : 'vs'}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        </div>
      )}
    </div>
  );
}
