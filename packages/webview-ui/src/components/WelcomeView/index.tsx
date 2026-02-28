import React from 'react';

interface WelcomeViewProps {
  onAddConnection: () => void;
}

export function WelcomeView({ onAddConnection }: WelcomeViewProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 80,
          height: 80,
          background: 'var(--vscode-editorGroupHeader-tabsBackground)',
          border: '1px solid var(--vscode-panel-border, #333)',
          borderRadius: 8,
        }}
      >
        <svg width={40} height={40} viewBox="0 0 48 48" fill="none">
          <ellipse cx={24} cy={14} rx={18} ry={6} stroke="var(--vscode-button-background, #007ACC)" strokeWidth={2} />
          <path d="M6 14v20c0 3.314 8.059 6 18 6s18-2.686 18-6V14" stroke="var(--vscode-button-background, #007ACC)" strokeWidth={2} />
          <path d="M6 24c0 3.314 8.059 6 18 6s18-2.686 18-6" stroke="var(--vscode-button-background, #007ACC)" strokeWidth={2} />
        </svg>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>DB Manager</h1>
      <p style={{ fontSize: 14, color: 'var(--vscode-descriptionForeground, #808080)', textAlign: 'center', maxWidth: 450 }}>
        Connect to MySQL, MariaDB, PostgreSQL, SQLite, or Redis
        <br />
        databases to get started.
      </p>
      <button onClick={onAddConnection} style={{ fontSize: 13, padding: '8px 16px' }}>
        + Add Connection
      </button>
    </div>
  );
}
