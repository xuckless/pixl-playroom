// A staged rollout: how much of a channel is offered the release its feeds
// name. electron-updater gives each install a stable random id, so an
// install outside the percentage hears "no update" until it's raised.
//
//   node scripts/rollout.mjs <latest|beta> <0-100> [--prefix staging/playroom]
//     Sets stagingPercentage in the channel's feeds (Windows and macOS).
//     100 offers the release to everyone; 0 stops it reaching anyone else.
//   node scripts/rollout.mjs <latest|beta>
//     Shows each feed's version and percentage.
//
// A release can't be taken back from installs that already have it
// (downgrades are never offered): stop a bad one with 0, then release a fix.
// Needs the R2 variables (scripts/r2.mjs).
import { pathToFileURL } from 'node:url'
import { flags, getText, putText } from './r2.mjs'

/** The feed with its stagingPercentage set (none at 100). */
export function setStaging(text, percent) {
  const lines = text.split('\n').filter((l) => !l.startsWith('stagingPercentage:'))
  if (percent < 100) {
    const end = lines.at(-1) === '' ? lines.length - 1 : lines.length
    lines.splice(end, 0, `stagingPercentage: ${percent}`)
  }
  return lines.join('\n')
}

export function readStaging(text) {
  const m = /^stagingPercentage: (\d+)$/m.exec(text)
  return m ? Number(m[1]) : 100
}

async function main() {
  const f = flags(process.argv.slice(2))
  const [channel, pct] = f._
  if (channel !== 'latest' && channel !== 'beta')
    throw new Error('usage: rollout.mjs <latest|beta> [0-100] [--prefix staging/playroom]')
  const prefix = typeof f.prefix === 'string' ? f.prefix.replace(/\/+$/, '') : 'playroom'
  const percent = pct === undefined ? null : Number(pct)
  if (percent !== null && !(Number.isInteger(percent) && percent >= 0 && percent <= 100))
    throw new Error(`not a whole percentage: ${pct}`)
  for (const name of [`${channel}.yml`, `${channel}-mac.yml`]) {
    const key = `${prefix}/${name}`
    const text = await getText(key)
    if (text === null) {
      console.log(`${key}: none`)
      continue
    }
    const version = /^version: (.+)$/m.exec(text)?.[1] ?? '?'
    if (percent === null) {
      console.log(`${key}: ${version} to ${readStaging(text)}%`)
      continue
    }
    await putText(key, setStaging(text, percent), 'text/yaml')
    console.log(`${key}: ${version} now to ${percent}% (was ${readStaging(text)}%)`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
