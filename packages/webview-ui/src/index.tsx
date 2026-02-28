import React from 'react';
import ReactDOM from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import App from './App';
import './styles/global.css';

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
