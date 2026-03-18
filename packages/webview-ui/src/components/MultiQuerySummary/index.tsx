import { useState } from 'react';
import * as l10n from '@vscode/l10n';
import type { MultiQueryStatementResult } from '../../stores/results';

interface MultiQuerySummaryProps {
  results: MultiQueryStatementResult[];
  totalTime: number;
}

export function MultiQuerySummary({ results, totalTime }: MultiQuerySummaryProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const okCount = results.filter((r) => r.status === 'ok').length;
  const errCount = results.filter((r) => r.status === 'error').length;

  return (
    <div
      style={{
        borderBottom: '1px solid var(--vscode-panel-border, #333)',
        background: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
        fontSize: 12,
        userSelect: 'none',
      }}
    >
      {/* 요약 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '5px 12px',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          fontWeight: 600,
        }}
      >
        <span style={{ opacity: 0.8 }}>
          {l10n.t('{0} statements', results.length)}
        </span>
        {okCount > 0 && (
          <span style={{ color: 'var(--vscode-testing-iconPassed, #73c991)' }}>
            ✓ {okCount} {l10n.t('ok')}
          </span>
        )}
        {errCount > 0 && (
          <span style={{ color: 'var(--vscode-testing-iconFailed, #f48771)' }}>
            ✗ {errCount} {l10n.t('failed')}
          </span>
        )}
        <span style={{ opacity: 0.5, marginLeft: 'auto' }}>{totalTime}ms {l10n.t('total')}</span>
      </div>

      {/* 스테이트먼트별 행 */}
      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
        {results.map((r) => {
          const isExpanded = expandedIdx === r.index;
          const isError = r.status === 'error';
          const sqlPreview = r.sql.replace(/\s+/g, ' ').slice(0, 80) + (r.sql.length > 80 ? '…' : '');

          return (
            <div key={r.index}>
              <div
                onClick={() => setExpandedIdx(isExpanded ? null : r.index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 12px',
                  cursor: isError ? 'pointer' : 'default',
                  background: isExpanded ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                  color: isExpanded ? 'var(--vscode-list-activeSelectionForeground)' : 'inherit',
                }}
              >
                <span
                  style={{
                    minWidth: 14,
                    color: isError
                      ? 'var(--vscode-testing-iconFailed, #f48771)'
                      : 'var(--vscode-testing-iconPassed, #73c991)',
                    fontWeight: 700,
                  }}
                >
                  {isError ? '✗' : '✓'}
                </span>
                <span style={{ opacity: 0.5, minWidth: 24 }}>{r.index + 1}.</span>
                <span
                  style={{
                    flex: 1,
                    fontFamily: 'var(--vscode-editor-font-family, monospace)',
                    opacity: 0.85,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sqlPreview}
                </span>
                <span style={{ opacity: 0.5, whiteSpace: 'nowrap' }}>{r.executionTime}ms</span>
                {r.status === 'ok' && r.rows && r.rows.length > 0 && (
                  <span style={{ opacity: 0.5, whiteSpace: 'nowrap' }}>
                    {r.rows.length} {l10n.t('rows')}
                  </span>
                )}
                {r.status === 'ok' && r.affectedRows !== undefined && r.affectedRows > 0 && (r.rows?.length ?? 0) === 0 && (
                  <span style={{ opacity: 0.5, whiteSpace: 'nowrap' }}>
                    {r.affectedRows} {l10n.t('affected')}
                  </span>
                )}
                {isError && (
                  <span style={{ opacity: 0.6, fontSize: 10 }}>{isExpanded ? '▲' : '▼'}</span>
                )}
              </div>

              {/* 에러 메시지 펼침 */}
              {isExpanded && isError && (
                <div
                  style={{
                    padding: '4px 12px 4px 44px',
                    color: 'var(--vscode-testing-iconFailed, #f48771)',
                    fontFamily: 'var(--vscode-editor-font-family, monospace)',
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    background: 'var(--vscode-inputValidation-errorBackground, rgba(244,135,113,0.1))',
                    borderLeft: '2px solid var(--vscode-testing-iconFailed, #f48771)',
                  }}
                >
                  {r.error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
