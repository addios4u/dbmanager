import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as l10n from '@vscode/l10n';
import { postMessage } from '../../vscode-api';
import { ContextHeader } from '../ContextHeader';

// SQL keywords for syntax highlighting
const SQL_KEYWORDS = new Set([
  'CREATE', 'TABLE', 'VIEW', 'INDEX', 'TRIGGER', 'FUNCTION', 'PROCEDURE',
  'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'SELECT', 'FROM', 'WHERE',
  'AND', 'OR', 'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'KEY', 'FOREIGN',
  'REFERENCES', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'CASCADE', 'SET',
  'ON', 'IF', 'EXISTS', 'AS', 'BEGIN', 'END', 'RETURN', 'RETURNS',
  'DECLARE', 'INTO', 'VALUES', 'IN', 'IS', 'LIKE', 'BETWEEN',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'USING',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'WITH', 'RECURSIVE', 'REPLACE', 'TEMPORARY', 'TEMP',
  'AUTO_INCREMENT', 'AUTOINCREMENT', 'SERIAL', 'BIGSERIAL',
  'COMMENT', 'ENGINE', 'CHARSET', 'COLLATE', 'CHARACTER',
  'GRANT', 'REVOKE', 'SCHEMA', 'DATABASE', 'OWNER', 'TO',
  'EXECUTE', 'LANGUAGE', 'VOLATILE', 'STABLE', 'IMMUTABLE',
  'SECURITY', 'DEFINER', 'INVOKER', 'COST', 'ROWS',
]);

const SQL_TYPES = new Set([
  'INT', 'INTEGER', 'SMALLINT', 'BIGINT', 'TINYINT', 'MEDIUMINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'REAL',
  'CHAR', 'VARCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BYTEA',
  'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'YEAR', 'INTERVAL',
  'BOOLEAN', 'BOOL', 'BIT', 'ENUM',
  'JSON', 'JSONB', 'XML', 'UUID', 'ARRAY',
  'MONEY', 'INET', 'CIDR', 'MACADDR',
  'POINT', 'LINE', 'POLYGON', 'CIRCLE', 'BOX', 'PATH',
  'REGCLASS', 'OID', 'NAME', 'VOID',
  'UNSIGNED', 'SIGNED', 'VARYING', 'PRECISION', 'ZONE', 'WITHOUT', 'DOUBLE PRECISION',
]);

const SQL_CONSTANTS = new Set(['TRUE', 'FALSE', 'NULL', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'NOW']);

/** Tokenize a SQL string into colored spans */
function highlightSQL(sql: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Regex: single-line comment | multi-line comment | single-quoted string | double-quoted identifier | backtick identifier | numbers | words | other
  const tokenRegex = /(--.*)|(\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*')|("(?:[^"\\]|\\.)*")|(`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)|([^A-Za-z_\d\s'"`-]+|\s+|-)/g;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(sql)) !== null) {
    const [full, lineComment, blockComment, singleStr, doubleStr, backtickStr, num, word] = match;
    key++;

    if (lineComment || blockComment) {
      nodes.push(<span key={key} style={{ color: 'var(--vscode-editorLineNumber-foreground, #6a9955)' }}>{full}</span>);
    } else if (singleStr) {
      nodes.push(<span key={key} style={{ color: 'var(--vscode-debugTokenExpression-string, #ce9178)' }}>{full}</span>);
    } else if (doubleStr || backtickStr) {
      nodes.push(<span key={key} style={{ color: 'var(--vscode-symbolIcon-fieldForeground, #9cdcfe)' }}>{full}</span>);
    } else if (num) {
      nodes.push(<span key={key} style={{ color: 'var(--vscode-debugTokenExpression-number, #b5cea8)' }}>{full}</span>);
    } else if (word) {
      const upper = word.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        nodes.push(<span key={key} style={{ color: 'var(--vscode-symbolIcon-keywordForeground, #569cd6)', fontWeight: 600 }}>{full}</span>);
      } else if (SQL_TYPES.has(upper)) {
        nodes.push(<span key={key} style={{ color: 'var(--vscode-symbolIcon-typeParameterForeground, #4ec9b0)' }}>{full}</span>);
      } else if (SQL_CONSTANTS.has(upper)) {
        nodes.push(<span key={key} style={{ color: 'var(--vscode-debugTokenExpression-number, #b5cea8)' }}>{full}</span>);
      } else {
        nodes.push(<span key={key}>{full}</span>);
      }
    } else {
      nodes.push(<span key={key}>{full}</span>);
    }
  }

  return nodes;
}

interface DDLViewProps {
  connectionId: string;
  table: string;
  schema?: string;
}

function DDLCodeBlock({ ddl }: { ddl: string }) {
  const lines = useMemo(() => ddl.split('\n'), [ddl]);
  const gutterWidth = useMemo(() => Math.max(String(lines.length).length * 9 + 16, 40), [lines.length]);
  const highlightedLines = useMemo(
    () => lines.map((line) => ({ nodes: highlightSQL(line) })),
    [lines],
  );

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--vscode-editor-background)',
        fontFamily: 'var(--vscode-editor-font-family, monospace)',
        fontSize: 13,
        lineHeight: '20px',
        tabSize: 2,
        userSelect: 'text',
      }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {highlightedLines.map((line, i) => (
            <tr key={i}>
              <td
                style={{
                  width: gutterWidth,
                  minWidth: gutterWidth,
                  padding: '0 12px 0 0',
                  textAlign: 'right',
                  color: 'var(--vscode-editorLineNumber-foreground, #858585)',
                  userSelect: 'none',
                  verticalAlign: 'top',
                  whiteSpace: 'nowrap',
                  borderRight: '1px solid var(--vscode-editorIndentGuide-background, #404040)',
                }}
              >
                {i + 1}
              </td>
              <td
                style={{
                  padding: '0 0 0 12px',
                  color: 'var(--vscode-editor-foreground)',
                  whiteSpace: 'pre',
                }}
              >
                {line.nodes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DDLView({ connectionId, table, schema }: DDLViewProps) {
  const [ddl, setDdl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setIsLoading(true);
    setDdl('');
    setError(undefined);
    postMessage({ type: 'getTableDDL', connectionId, table, schema });
  }, [connectionId, table, schema]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'tableDDL' && msg.table === table && msg.connectionId === connectionId) {
        setDdl(msg.ddl as string);
        setIsLoading(false);
        setError(undefined);
      } else if (msg?.type === 'error' && isLoading) {
        setError(msg.message as string);
        setIsLoading(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [connectionId, table, isLoading]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(ddl);
  }, [ddl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ContextHeader
        connectionId={connectionId}
        schema={schema}
        table={table}
        badge="DDL"
        actions={
          ddl ? (
            <button
              onClick={handleCopy}
              style={{ fontSize: 11, padding: '1px 8px' }}
              title={l10n.t('Copy DDL to clipboard')}
            >
              {l10n.t('Copy')}
            </button>
          ) : undefined
        }
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
          {l10n.t('Loading DDL...')}
        </div>
      ) : error ? (
        <div
          style={{
            padding: 16,
            color: 'var(--vscode-errorForeground, #f44)',
            fontFamily: 'var(--vscode-editor-font-family, monospace)',
            fontSize: 13,
            whiteSpace: 'pre-wrap',
          }}
        >
          <strong>{l10n.t('Error:')}</strong> {error}
        </div>
      ) : (
        <DDLCodeBlock ddl={ddl} />
      )}
    </div>
  );
}
