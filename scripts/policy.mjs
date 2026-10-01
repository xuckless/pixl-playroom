// The release policy every install reads at launch and every four hours
// (playroom/policy.json on updates.pixlfoundation.com; src/shared/policy.ts):
//
//   node scripts/policy.mjs
//     Shows it.
//   node scripts/policy.mjs set [--min 0.2.3 | --no-min] [--beta-open true|false]
//                               [--message "…" | --no-message] [--prefix staging/playroom]
//     Changes what's given and leaves the rest. --min is the update floor:
//     every version below it stops and asks for the update. Use it for a
//     release that must not stay out (a data-losing bug, a security fix),
//     once the fixed version is in the feeds. --beta-open false tells beta
//     builds the beta has ended (Pass 26a).
//
// Needs the R2 variables (scripts/r2.mjs).
import { flags, getText, putText } from './r2.mjs'

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

async function main() {
  const f = flags(process.argv.slice(2))
  const prefix = typeof f.prefix === 'string' ? f.prefix.replace(/\/+$/, '') : 'playroom'
  const key = `${prefix}/policy.json`
  const text = await getText(key)
  const current = text === null ? {} : JSON.parse(text)
  if (f._[0] !== 'set') {
    console.log(
      `${key}: ${text === null ? 'none (no floor, beta open)' : JSON.stringify(current, null, 2)}`
    )
    return
  }
  const next = { ...current }
  if (typeof f.min === 'string') {
    if (!VERSION.test(f.min)) throw new Error(`not a version: ${f.min}`)
    next.minVersion = f.min
  }
  if (f['no-min']) delete next.minVersion
  if (f['beta-open'] !== undefined) {
    if (f['beta-open'] !== 'true' && f['beta-open'] !== 'false')
      throw new Error('--beta-open takes true or false')
    next.betaOpen = f['beta-open'] === 'true'
  }
  if (typeof f.message === 'string') next.message = f.message
  if (f['no-message']) delete next.message
  await putText(key, JSON.stringify(next, null, 2) + '\n', 'application/json')
  console.log(`${key}: ${JSON.stringify(next, null, 2)}`)
}

await main()
