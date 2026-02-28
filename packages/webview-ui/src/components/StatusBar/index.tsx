import React from 'react';

interface StatusBarProps {
  children?: React.ReactNode;
  executionTime?: number;
  rowCount?: number;
  error?: string;
}

export function StatusBar({ children, executionTime, rowCount, error }: StatusBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 24,
        padding: '0 12px',
        borderTop: '1px solid var(--vscode-panel-border, #333)',
        flexShrink: 0,
        fontSize: 11,
        gap: 12,
        background: 'var(--vscode-statusBar-background, var(--vscode-editorGroupHeader-tabsBackground))',
        color: error
          ? 'var(--vscode-errorForeground, var(--vscode-editorError-foreground, #f44747))'
          : 'var(--vscode-statusBar-foreground, var(--vscode-foreground))',
        overflow: 'hidden',
      }}
    >
      {error ? (
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={error}
        >
          {error}
        </span>
      ) : (
        <>
          <span style={{ color: 'var(--vscode-descriptionForeground, #808080)', whiteSpace: 'nowrap' }}>
            {rowCount !== undefined && (
              <>
                {rowCount.toLocaleString()} {rowCount === 1 ? 'row' : 'rows'}
              </>
            )}
            {rowCount !== undefined && executionTime !== undefined && ' \u00b7 '}
            {executionTime !== undefined && (
              <>
                {executionTime < 1000
                  ? `${executionTime}ms`
                  : `${(executionTime / 1000).toFixed(2)}s`}
              </>
            )}
          </span>
          {children}
        </>
      )}
    </div>
  );
}
