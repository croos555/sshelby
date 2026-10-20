import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

// Shown by the splash window (%VITE_APP_VERSION% in splash.html)
process.env.VITE_APP_VERSION = pkg.version

// Frontend of the Tauri app (src-tauri/tauri.conf.json points here). The CSP is set by Tauri.
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { main: resolve('src/renderer/index.html'), splash: resolve('src/renderer/splash.html') } }
  }
})
