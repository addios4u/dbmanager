import React, { useRef, useState, useCallback, useEffect } from 'react';

interface SplitPaneProps {
  initialRatio?: number;
  minTopHeight?: number;
  minBottomHeight?: number;
  children: [React.ReactNode, React.ReactNode];
}

export function SplitPane({
  initialRatio = 0.4,
  minTopHeight = 120,
  minBottomHeight = 100,
  children,
}: SplitPaneProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalHeight = rect.height;
      const offsetY = e.clientY - rect.top;

      const minRatio = minTopHeight / totalHeight;
      const maxRatio = (totalHeight - minBottomHeight) / totalHeight;
      const newRatio = Math.min(maxRatio, Math.max(minRatio, offsetY / totalHeight));

      setRatio(newRatio);
    },
    [isDragging, minTopHeight, minBottomHeight],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
  }, []);

  // Release drag if pointer leaves window
  useEffect(() => {
    if (!isDragging) return;
    const cancel = () => setIsDragging(false);
    window.addEventListener('pointerup', cancel);
    return () => window.removeEventListener('pointerup', cancel);
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Top panel */}
      <div
        style={{
          flex: `0 0 ${ratio * 100}%`,
          minHeight: minTopHeight,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children[0]}
        {/* Overlay to prevent Monaco/AG Grid capturing pointer events during drag */}
        {isDragging && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 100,
              cursor: 'row-resize',
            }}
          />
        )}
      </div>

      {/* Drag handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          height: 4,
          background: isDragging
            ? 'var(--vscode-focusBorder, #007fd4)'
            : 'var(--vscode-panel-border, #333)',
          cursor: 'row-resize',
          flexShrink: 0,
          transition: isDragging ? 'none' : 'background 0.15s',
          zIndex: 10,
        }}
      />

      {/* Bottom panel */}
      <div
        style={{
          flex: 1,
          minHeight: minBottomHeight,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children[1]}
        {/* Overlay to prevent Monaco/AG Grid capturing pointer events during drag */}
        {isDragging && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 100,
              cursor: 'row-resize',
            }}
          />
        )}
      </div>
    </div>
  );
}
