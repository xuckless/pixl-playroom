// Build Playroom's own native addons for the Electron it ships: on macOS
// the display reader (src/native/display, a screen's EDR headroom), into
// build/native/display.node. Elsewhere nothing: Playroom falls back to the
// display values stated in Preferences (src/main/display.ts).
//
//   node scripts/build-native.mjs        (part of `pnpm build`)
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'darwin') {
  console.log('build-native: nothing to build here (the display reader is macOS only)')
  process.exit(0)
}
const electron = JSON.parse(readFileSync(join(ROOT, 'node_modules/electron/package.json'), 'utf8'))
const arch = process.env.npm_config_arch || process.arch
const dir = join(ROOT, 'src/native/display')
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    '--yes',
    'node-gyp',
    'rebuild',
    `--target=${electron.version}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers',
    `--directory=${dir}`
  ],
  { stdio: 'inherit', cwd: ROOT }
)
const out = join(ROOT, 'build/native')
mkdirSync(out, { recursive: true })
copyFileSync(join(dir, 'build/Release/display.node'), join(out, 'display.node'))
console.log(`build-native: build/native/display.node (Electron ${electron.version}, ${arch})`)
