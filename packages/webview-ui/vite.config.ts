import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-l10n-bundles',
      closeBundle() {
        const src = resolve(__dirname, 'l10n');
        const dest = resolve(__dirname, '../extension/dist/webview/l10n');
        mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
      },
    },
  ],
  build: {
    outDir: '../extension/dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
        // 단일 번들로 출력 (VS Code webview는 여러 chunk를 로드할 수 없음)
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
    // CSS 코드 분리 비활성화 (단일 파일)
    cssCodeSplit: false,
    sourcemap: true,
  },
});
