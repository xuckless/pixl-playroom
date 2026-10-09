import { resolve, sep } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Records the npm packages a bundle actually contains (bundled-packages.json
 * beside it), so scripts/third-party-notices.mjs credits exactly what ships:
 * dev dependencies bundled into the renderer included, build tooling not.
 */
function bundledPackages(): Plugin {
  return {
    name: 'playroom:bundled-packages',
    apply: 'build',
    generateBundle() {
      const dirs = new Set<string>()
      for (const id of this.getModuleIds()) {
        const path = id.replace(/^\0/, '').split('?')[0]
        const at = path.lastIndexOf(`${sep}node_modules${sep}`)
        if (at < 0) continue
        const rest = path.slice(at + 14).split(sep)
        const n = rest[0].startsWith('@') ? 2 : 1
        dirs.add(path.slice(0, at + 14) + rest.slice(0, n).join(sep))
      }
      this.emitFile({
        type: 'asset',
        fileName: 'bundled-packages.json',
        source: JSON.stringify([...dirs].sort(), null, 2) + '\n'
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), bundledPackages()],
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
    plugins: [externalizeDepsPlugin(), bundledPackages()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), bundledPackages()],
    build: {
      // Less to parse at start: three.js and the app ship minified. A
      // profiling build (scripts/perf.mjs, PLAYROOM_PROFILE_BUILD=1) keeps
      // the names, so its flame graphs read.
      minify: process.env.PLAYROOM_PROFILE_BUILD === '1' ? false : 'esbuild',
      sourcemap: process.env.PLAYROOM_PROFILE_BUILD === '1',
      // Vite inlines assets under 4 kB as data: URLs, which caught one
      // subset of Manrope (cyrillic-ext, 2.5 kB); the CSP in index.html has
      // no font-src, so default-src 'self' blocked it in every build (dev
      // serves it as a file). Fonts always ship as files.
      assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined)
    }
  }
})
