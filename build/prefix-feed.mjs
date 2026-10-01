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
 * Usage: node build/prefix-feed.mjs <manifest> > <manifest for R2>
 *
 * Takes the version from the feed itself, rewrites only the `url:` and
 * `path:` lines, and throws on anything it doesn't expect, so a format change
 * fails the release instead of publishing a feed nobody can update from.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function prefixFeed(text, source = 'feed') {
  const version = /^version: (\S+)$/m.exec(text)?.[1]
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`${source}: no version, or not one we publish`)
  let urls = 0
  let paths = 0
  const out = text.split('\n').map((line, i) => {
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
  return out.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2]
  if (!source) throw new Error('usage: node build/prefix-feed.mjs <manifest>')
  process.stdout.write(prefixFeed(readFileSync(source, 'utf8'), source))
}
