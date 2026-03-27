import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const dir = import.meta.dirname;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['better-sqlite3'],
        input: { index: resolve(dir, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(dir, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(dir, '../frontend'),
    build: {
      outDir: resolve(dir, 'out/renderer'),
      rollupOptions: {
        input: { index: resolve(dir, '../frontend/index.html') },
      },
    },
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true },
      },
    },
  },
});
