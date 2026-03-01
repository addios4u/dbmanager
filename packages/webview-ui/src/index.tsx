import React from 'react';
import ReactDOM from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import * as l10n from '@vscode/l10n';
import App from './App';
import './styles/global.css';

// Initialize l10n with the bundle from the extension host (before React renders)
const __state = (window as unknown as { __INITIAL_STATE__?: { l10nContents?: Record<string, string> } }).__INITIAL_STATE__;
if (__state?.l10nContents) {
  l10n.config({ contents: __state.l10nContents });
}

// Use bundled monaco-editor instead of CDN (CSP blocks CDN scripts in webview)
loader.config({ monaco });

// Disable web workers — VS Code webview cannot load worker scripts
(globalThis as unknown as Record<string, unknown>).MonacoEnvironment = {
  getWorker: () => new (class extends EventTarget {
    onmessage: unknown = null;
    postMessage() { /* no-op */ }
    terminate() { /* no-op */ }
  } as unknown as { new(): Worker }),
};

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
