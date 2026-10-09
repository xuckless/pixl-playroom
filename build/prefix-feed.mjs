/**
 * Points an update feed's files into their version's folder on
 * updates.pixlfoundation.com, where release.yml uploads them:
 * `url: pixl-playroom-mac-arm64.zip` becomes
 * `url: 0.3.0/pixl-playroom-mac-arm64.zip` (electron-updater resolves it
 * against the feed's own URL).
 *
 * A folder per version keeps a beta release from overwriting the stable
 * one's installers (the artifact names carry no version), lets a download
 * already under way finish, and lets differential updates find the old
 * version's blockmap: electron-updater looks for it at the new file's path
 * with the new version swapped for the old.
 *
 * Usage: node build/prefix-feed.mjs <manifest> [rollout %] > <manifest for R2>
 *
 * A rollout under 100 adds `stagingPercentage` (a staged rollout:
 * scripts/rollout.mjs raises or stops it later).
 *
 * Takes the version from the feed itself, rewrites only the `url:` and
 * `path:` lines (never a line of the release notes), and throws on anything it doesn't expect, so a format change
 * fails the release instead of publishing a feed nobody can update from.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function prefixFeed(text, source = 'feed', rollout = 100) {
  if (!(Number.isInteger(rollout) && rollout >= 0 && rollout <= 100))
    throw new Error(`${source}: not a whole percentage: ${rollout}`)
  const version = /^version: (\S+)$/m.exec(text)?.[1]
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`${source}: no version, or not one we publish`)
  let urls = 0
  let paths = 0
  /** Inside a block value (`releaseNotes: |`): its indented lines are text, left alone. */
  let inBlock = false
  const out = text.split('\n').map((line, i) => {
    if (inBlock && (line === '' || line.startsWith('  '))) return line
    inBlock = /^\w+: [|>][-+]?$/.test(line)
    const m = /^( {2}- url: |path: )(.+)$/.exec(line)
    if (!m) return line
    const name = m[2]
    if (!/^[A-Za-z0-9._-]+$/.test(name))
      throw new Error(`${source}:${i + 1}: not a bare file name: ${JSON.stringify(name)}`)
    if (m[1] === 'path: ') paths++
    else urls++
    return `${m[1]}${version}/${name}`
  })
  if (urls === 0) throw new Error(`${source}: no files`)
  if (paths !== 1) throw new Error(`${source}: expected one path line, found ${paths}`)
  if (text.includes('\nstagingPercentage:')) throw new Error(`${source}: already staged`)
  if (rollout < 100) {
    const end = out.at(-1) === '' ? out.length - 1 : out.length
    out.splice(end, 0, `stagingPercentage: ${rollout}`)
  }
  return out.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2]
  if (!source) throw new Error('usage: node build/prefix-feed.mjs <manifest> [rollout %]')
  const rollout = process.argv[3] === undefined ? 100 : Number(process.argv[3])
  process.stdout.write(prefixFeed(readFileSync(source, 'utf8'), source, rollout))
}
