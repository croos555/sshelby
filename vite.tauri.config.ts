import { resolve } from 'path'
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The Tauri build serves the same renderer with its own entry (window.api over Tauri IPC).
// Tauri sets the CSP itself (src-tauri/tauri.conf.json), so the Electron meta tag is dropped.
const tauriEntry: Plugin = {
  name: 'sshelby-tauri-entry',
  transformIndexHtml: {
    // Before Vite resolves the entry script
    order: 'pre',
    handler: (html) =>
      html.replace('/src/main.tsx', '/src/main-tauri.tsx').replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/s, '')
  }
}

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), tauriEntry],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: { outDir: resolve('out/tauri'), emptyOutDir: true, target: 'es2022' }
})
