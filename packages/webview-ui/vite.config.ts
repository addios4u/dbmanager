import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../extension/dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: 'webview.[ext]',
        // 단일 번들로 출력 (VS Code webview는 여러 chunk를 로드할 수 없음)
        manualChunks: undefined,
      },
    },
    // CSS 코드 분리 비활성화 (단일 파일)
    cssCodeSplit: false,
    sourcemap: true,
  },
});
