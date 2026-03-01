import React from 'react';
import * as l10n from '@vscode/l10n';

interface PaginationProps {
  totalRows: number;
  offset: number;
  pageSize: number;
  onPageChange: (offset: number) => void;
  isLoading?: boolean;
}

export function Pagination({
  totalRows,
  offset,
  pageSize,
  onPageChange,
  isLoading = false,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  const start = totalRows === 0 ? 0 : offset + 1;
  const end = Math.min(offset + pageSize, totalRows);

  const isFirst = offset === 0;
  const isLast = offset + pageSize >= totalRows;

  const goToFirst = () => onPageChange(0);
  const goToPrev = () => onPageChange(Math.max(0, offset - pageSize));
  const goToNext = () => onPageChange(Math.min((totalPages - 1) * pageSize, offset + pageSize));
  const goToLast = () => onPageChange((totalPages - 1) * pageSize);

  const navStyle = (disabled: boolean): React.CSSProperties => ({
    cursor: disabled ? 'default' : 'pointer',
    color: disabled
      ? 'var(--vscode-descriptionForeground, #808080)'
      : 'var(--vscode-button-background, #007ACC)',
    fontSize: 13,
    userSelect: 'none',
  });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 28,
        padding: '4px 16px',
        borderTop: '1px solid var(--vscode-panel-border, #333)',
        flexShrink: 0,
        fontSize: 11,
        opacity: isLoading ? 0.5 : 1,
        pointerEvents: isLoading ? 'none' : undefined,
        background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        color: 'var(--vscode-foreground)',
      }}
    >
      <span style={{ color: 'var(--vscode-descriptionForeground, #808080)', whiteSpace: 'nowrap' }}>
        {l10n.t('Rows {0}–{1} of {2}', start.toLocaleString(), end.toLocaleString(), totalRows.toLocaleString())}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={navStyle(isFirst)}
          onClick={isFirst ? undefined : goToFirst}
          title={l10n.t('First page')}
        >
          {'«'}
        </span>
        <span
          style={navStyle(isFirst)}
          onClick={isFirst ? undefined : goToPrev}
          title={l10n.t('Previous page')}
        >
          {'‹'}
        </span>
        <span style={{ whiteSpace: 'nowrap' }}>
          {l10n.t('Page {0} of {1}', currentPage, totalPages)}
        </span>
        <span
          style={navStyle(isLast)}
          onClick={isLast ? undefined : goToNext}
          title={l10n.t('Next page')}
        >
          {'›'}
        </span>
        <span
          style={navStyle(isLast)}
          onClick={isLast ? undefined : goToLast}
          title={l10n.t('Last page')}
        >
          {'»'}
        </span>
      </div>
    </div>
  );
}
