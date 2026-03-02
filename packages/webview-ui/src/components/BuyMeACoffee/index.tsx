import React, { useCallback } from 'react';
import { postMessage } from '../../vscode-api';

const BMC_URL = 'https://buymeacoffee.com/addios4u';

interface BuyMeACoffeeProps {
  style?: React.CSSProperties;
}

export function BuyMeACoffee({ style }: BuyMeACoffeeProps) {
  const handleClick = useCallback(() => {
    postMessage({ type: 'openExternal', url: BMC_URL });
  }, []);

  return (
    <button
      onClick={handleClick}
      title="Buy me a coffee"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: '16px',
        background: '#FFDD00',
        color: '#000',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <path
          d="M4 19h14a1 1 0 0 0 1-1V9H3v9a1 1 0 0 0 1 1zM18 9V6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2"
          stroke="#000"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M7 5s0-2 2.5-2S12 5 12 5" stroke="#000" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
      <span>Buy me a coffee</span>
    </button>
  );
}
