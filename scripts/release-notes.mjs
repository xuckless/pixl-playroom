#!/usr/bin/env node
/**
 * This version's What's new as Markdown, at build/release-notes.md: the
 * release feed's `releaseNotes` (electron-builder.yml `releaseInfo`), which
 * an installed Playroom shows in its "Update available" dialog before the
 * update is installed, and the GitHub release's body. From
 * src/shared/releasenotes.ts, the notes this build shows after updating.
 *
 *   node scripts/release-notes.mjs        (run by `pnpm build`)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
// The notes are TypeScript: read them through the tests' loader, as the tests do.
const r = spawnSync(
  process.execPath,
  [
    '--import',
    './tests/register.mjs',
    '--experimental-strip-types',
    '--no-warnings',
    '--input-type=module',
    '-e',
    `const m = await import('./src/shared/releasenotes.ts')
     const n = m.latestNotes(${JSON.stringify(version)})
     process.stdout.write(n ? m.releaseNotesMarkdown(n) : '')`
  ],
  { cwd: ROOT, encoding: 'utf8' }
)
if (r.status !== 0) {
  console.error(r.stderr)
  process.exit(1)
}
const out = join(ROOT, 'build', 'release-notes.md')
writeFileSync(out, r.stdout || `Pixl Playroom ${version}.\n`)
console.log(`release-notes: ${version} → build/release-notes.md`)
