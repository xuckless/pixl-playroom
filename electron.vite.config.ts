import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          // the app
          index: resolve('src/main/index.ts'),
          // the engine host, forked as an Electron utilityProcess
          'engine-host': resolve('src/main/engine/host.ts'),
          // the index (SQLite and sidecars), forked as an Electron utilityProcess
          'index-host': resolve('src/main/indexer/host.ts')
        },
        // The native binding is required by name at runtime inside the
        // utility process; it must never be bundled.
        external: ['@xuckless/pixl-engine', 'node:sqlite']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      // Less to parse at start: three.js and the app ship minified.
      minify: 'esbuild',
      sourcemap: false,
      // Vite inlines assets under 4 kB as data: URLs, which caught one
      // subset of Manrope (cyrillic-ext, 2.5 kB); the CSP in index.html has
      // no font-src, so default-src 'self' blocked it in every build (dev
      // serves it as a file). Fonts always ship as files.
      assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined)
    }
  }
})
