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
        gap: 16,
        opacity: 0.85,
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        <ellipse cx={24} cy={14} rx={18} ry={6} stroke="currentColor" strokeWidth={2} />
        <path d="M6 14v20c0 3.314 8.059 6 18 6s18-2.686 18-6V14" stroke="currentColor" strokeWidth={2} />
        <path d="M6 24c0 3.314 8.059 6 18 6s18-2.686 18-6" stroke="currentColor" strokeWidth={2} />
      </svg>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>DB Manager</h1>
      <p style={{ fontSize: 13, opacity: 0.7, textAlign: 'center', maxWidth: 320 }}>
        Connect to MySQL, MariaDB, PostgreSQL, SQLite, or Redis databases to get started.
      </p>
      <button onClick={onAddConnection} style={{ fontSize: 13, padding: '8px 20px' }}>
        Add Connection
      </button>
    </div>
  );
}
