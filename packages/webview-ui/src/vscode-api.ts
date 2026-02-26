// acquireVsCodeApi는 정확히 1회만 호출해야 함
import type { WebviewMessage } from '@dbmanager/shared';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// VS Code webview 환경이 아닐 때 (Vite dev server) mock 제공
const vscode: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : {
        postMessage: (msg) => console.log('[mock] postMessage:', msg),
        getState: () => undefined,
        setState: (state) => console.log('[mock] setState:', state),
      };

export function postMessage(message: WebviewMessage): void {
  vscode.postMessage(message);
}

export function getState<T>(): T | undefined {
  return vscode.getState() as T | undefined;
}

export function setState<T>(state: T): void {
  vscode.setState(state);
}
