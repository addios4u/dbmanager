import React from 'react';

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

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 28,
        padding: '0 12px',
        borderTop: '1px solid var(--vscode-panel-border, #333)',
        flexShrink: 0,
        gap: 8,
        fontSize: 11,
        opacity: isLoading ? 0.5 : 1,
        pointerEvents: isLoading ? 'none' : undefined,
        background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        color: 'var(--vscode-foreground)',
      }}
    >
      <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>
        Rows {start}-{end} of {totalRows}
      </span>

      <span style={{ opacity: 0.4 }}>|</span>

      <span style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>
        Page {currentPage} of {totalPages}
      </span>

      <span style={{ flex: 1 }} />

      <button
        className="secondary"
        style={{ fontSize: 11, padding: '1px 8px', height: 20 }}
        onClick={goToFirst}
        disabled={isFirst || isLoading}
        title="First page"
      >
        {'«'}
      </button>

      <button
        className="secondary"
        style={{ fontSize: 11, padding: '1px 8px', height: 20 }}
        onClick={goToPrev}
        disabled={isFirst || isLoading}
        title="Previous page"
      >
        {'‹'}
      </button>

      <button
        className="secondary"
        style={{ fontSize: 11, padding: '1px 8px', height: 20 }}
        onClick={goToNext}
        disabled={isLast || isLoading}
        title="Next page"
      >
        {'›'}
      </button>

      <button
        className="secondary"
        style={{ fontSize: 11, padding: '1px 8px', height: 20 }}
        onClick={goToLast}
        disabled={isLast || isLoading}
        title="Last page"
      >
        {'»'}
      </button>
    </div>
  );
}
