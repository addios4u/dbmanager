import React, { useCallback, useEffect, useState } from 'react';
import { postMessage } from '../../vscode-api';
import { ContextHeader } from '../ContextHeader';
import type { ExportOptions } from '@dbmanager/shared';

interface ExportDialogProps {
  connectionId: string;
  table: string;
  schema?: string;
}

type ExportFormat = 'csv' | 'json' | 'sql';

export function ExportDialog({ connectionId, table, schema }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [includeHeaders, setIncludeHeaders] = useState<boolean>(true);
  const [delimiter, setDelimiter] = useState<string>(',');
  const [prettyPrint, setPrettyPrint] = useState<boolean>(true);
  const [includeDropStatement, setIncludeDropStatement] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [resultMessage, setResultMessage] = useState<{ type: 'success' | 'error'; text: string } | undefined>(undefined);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'exportProgress') {
        setProgress(msg.percent as number);
        setProgressMessage(msg.message as string);
      } else if (msg?.type === 'exportComplete') {
        setIsExporting(false);
        setProgress(100);
        setResultMessage({ type: 'success', text: `Export complete: ${msg.filePath as string}` });
      } else if (msg?.type === 'exportError') {
        setIsExporting(false);
        setProgress(0);
        setResultMessage({ type: 'error', text: msg.error as string });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleExport = useCallback(() => {
    setIsExporting(true);
    setProgress(0);
    setProgressMessage('');
    setResultMessage(undefined);

    const options: ExportOptions = { format };
    if (format === 'csv') {
      options.includeHeaders = includeHeaders;
      options.delimiter = delimiter;
    } else if (format === 'json') {
      options.prettyPrint = prettyPrint;
    } else if (format === 'sql') {
      options.includeDropStatement = includeDropStatement;
    }

    postMessage({ type: 'exportData', connectionId, table, schema, format, options });
  }, [connectionId, table, schema, format, includeHeaders, delimiter, prettyPrint, includeDropStatement]);

  const handleCancel = useCallback(() => {
    setIsExporting(false);
    setProgress(0);
    setProgressMessage('');
    setResultMessage(undefined);
  }, []);

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--vscode-foreground)',
    cursor: 'pointer',
    marginBottom: 8,
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: 16,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    opacity: 0.7,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: 'var(--vscode-foreground)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ContextHeader
        connectionId={connectionId}
        schema={schema}
        table={table}
        extraInfo="Export"
      />
      <div
        style={{
          padding: 20,
          maxWidth: 500,
          overflowY: 'auto',
          flex: 1,
          color: 'var(--vscode-foreground)',
          fontSize: 13,
        }}
      >
        {/* Format selection */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Format</div>
          {(['csv', 'json', 'sql'] as ExportFormat[]).map((f) => (
            <label key={f} style={labelStyle}>
              <input
                type="radio"
                name="format"
                value={f}
                checked={format === f}
                onChange={() => {
                  setFormat(f);
                  setResultMessage(undefined);
                }}
                style={{
                  accentColor: 'var(--vscode-focusBorder)',
                  cursor: 'pointer',
                }}
              />
              {f.toUpperCase()}
            </label>
          ))}
        </div>

        {/* Format-specific options */}
        {format === 'csv' && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>CSV Options</div>
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={includeHeaders}
                onChange={(e) => setIncludeHeaders(e.target.checked)}
                style={{ accentColor: 'var(--vscode-focusBorder)', cursor: 'pointer' }}
              />
              Include headers
            </label>
            <label style={{ ...labelStyle, marginTop: 8 }}>
              <span style={{ minWidth: 80 }}>Delimiter</span>
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
                style={{ width: 100 }}
              >
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value="\t">Tab</option>
                <option value="|">Pipe (|)</option>
              </select>
            </label>
          </div>
        )}

        {format === 'json' && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>JSON Options</div>
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={prettyPrint}
                onChange={(e) => setPrettyPrint(e.target.checked)}
                style={{ accentColor: 'var(--vscode-focusBorder)', cursor: 'pointer' }}
              />
              Pretty print
            </label>
          </div>
        )}

        {format === 'sql' && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>SQL Options</div>
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={includeDropStatement}
                onChange={(e) => setIncludeDropStatement(e.target.checked)}
                style={{ accentColor: 'var(--vscode-focusBorder)', cursor: 'pointer' }}
              />
              Include DROP TABLE statement
            </label>
          </div>
        )}

        {/* Progress bar */}
        {isExporting && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                height: 4,
                background: 'var(--vscode-panel-border, #333)',
                borderRadius: 2,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'var(--vscode-progressBar-background, var(--vscode-focusBorder))',
                  transition: 'width 0.2s ease',
                  borderRadius: 2,
                }}
              />
            </div>
            {progressMessage && (
              <div style={{ fontSize: 11, opacity: 0.7 }}>{progressMessage}</div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={handleExport}
            disabled={isExporting}
            style={{ opacity: isExporting ? 0.5 : 1 }}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
          <button className="secondary" onClick={handleCancel}>
            Cancel
          </button>
        </div>

        {/* Result message */}
        {resultMessage && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 2,
              fontSize: 12,
              color:
                resultMessage.type === 'success'
                  ? 'var(--vscode-testing-iconPassed, #73c991)'
                  : 'var(--vscode-errorForeground, #f44)',
              background:
                resultMessage.type === 'success'
                  ? 'var(--vscode-diffEditor-insertedTextBackground, rgba(155,185,85,0.1))'
                  : 'var(--vscode-inputValidation-errorBackground, rgba(244,67,54,0.1))',
              border:
                resultMessage.type === 'success'
                  ? '1px solid var(--vscode-testing-iconPassed, #73c991)'
                  : '1px solid var(--vscode-errorForeground, #f44)',
            }}
          >
            {resultMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}
