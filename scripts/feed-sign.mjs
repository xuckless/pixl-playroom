// The update feed's signature (src/main/feedsig.ts): an Ed25519 JWS over a
// feed's version and every file's url and sha512, carried in the feed as
// `pixlSignature`, which the app checks before it downloads an update. The
// private key stays offline (as the entitlement roots do: entitlement-keys.mjs);
// the app holds the public half in FEED_KEYS.
//
//   node scripts/feed-sign.mjs key <kid>
//       Makes a feed key pair. The private key goes to ~/.pixl-secrets/
//       (never overwritten; back it up offline, and put its text in the
//       release workflow's PIXL_FEED_KEY secret). Prints the line for FEED_KEYS.
//   node scripts/feed-sign.mjs sign <feed.yml> [...]
//       Signs each feed in place, with the key in PIXL_FEED_KEY (the PEM's
//       text) or the file PIXL_FEED_KEY_FILE names; its kid is the one
//       FEED_KEYS holds its public half under. With no key: fails when the
//       app holds feed keys (it would refuse the feed), else leaves the feed
//       unsigned with a notice.
//   node scripts/feed-sign.mjs verify <feed.yml> [...]
//       Checks each feed's signature against FEED_KEYS, as the app does.
//
// Sign after build/prefix-feed.mjs (the urls the app reads) and after
// build/merge-mac-channel.mjs. scripts/rollout.mjs needs no key: the
// percentage is not signed.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SECRETS = join(homedir(), '.pixl-secrets')
const keyFile = (kid) => join(SECRETS, `feed-${kid}.pem`)
export const FEED_TYPE = 'pixl-feed'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const rawOf = (publicKey) => publicKey.export({ format: 'jwk' }).x

/** FEED_KEYS, read out of src/main/feedsig.ts rather than repeated here. */
export function feedKeys(
  src = readFileSync(new URL('../src/main/feedsig.ts', import.meta.url), 'utf8')
) {
  const block = /export const FEED_KEYS[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? ''
  return Object.fromEntries([...block.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
}

const unquote = (v) => v.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')

/**
 * What a feed's signature covers: its version, and each file's url and
 * sha512, read from the shape electron-builder writes (block values, the
 * release notes, skipped). Throws on a feed without them.
 */
export function feedClaims(text, source = 'feed') {
  const version = /^version: (.+)$/m.exec(text)?.[1]
  if (!version) throw new Error(`${source}: no version`)
  const files = []
  let inFiles = false
  let inBlock = false
  for (const line of text.split('\n')) {
    if (inBlock && (line === '' || line.startsWith('  '))) continue
    inBlock = /^\w+: [|>][-+]?$/.test(line)
    if (line === 'files:') {
      inFiles = true
      continue
    }
    const url = /^ {2}- url: (.+)$/.exec(line)
    if (url && inFiles) {
      files.push({ url: unquote(url[1]) })
      continue
    }
    const sha = /^ {4}sha512: (.+)$/.exec(line)
    if (sha && inFiles && files.length > 0) {
      files[files.length - 1].sha512 = unquote(sha[1])
      continue
    }
    if (/^ {4}\w+: /.test(line)) continue
    if (/^\S/.test(line)) inFiles = false
  }
  if (files.length === 0) throw new Error(`${source}: no files`)
  for (const f of files) if (!f.sha512) throw new Error(`${source}: ${f.url} has no sha512`)
  return { version: unquote(version), files }
}

/** The feed with its `pixlSignature` (one only, after `version:`, never inside a block value). */
export function withSignature(text, jws) {
  const lines = text.split('\n').filter((l) => !l.startsWith('pixlSignature:'))
  const at = lines.findIndex((l) => l.startsWith('version: '))
  if (at < 0) throw new Error('no version line')
  lines.splice(at + 1, 0, `pixlSignature: ${jws}`)
  return lines.join('\n')
}

/** The feed signed by `privateKey` (a KeyObject) as `kid`. */
export function signFeed(
  text,
  privateKey,
  kid,
  iat = Math.floor(Date.now() / 1000),
  source = 'feed'
) {
  const { version, files } = feedClaims(text, source)
  const data = `${b64({ alg: 'EdDSA', kid, typ: FEED_TYPE })}.${b64({ version, files, iat })}`
  const jws = `${data}.${sign(null, Buffer.from(data), privateKey).toString('base64url')}`
  return withSignature(text, jws)
}

/** The kid FEED_KEYS holds this private key's public half under, or null. */
export function kidOf(privateKey, keys) {
  const raw = rawOf(createPublicKey(privateKey))
  return Object.entries(keys).find(([, x]) => x === raw)?.[0] ?? null
}

/** Whether a feed's signature is good by one of `keys`, as the app checks it (`checkFeed`). */
export function verifyFeed(text, keys, source = 'feed') {
  const jws = /^pixlSignature: (\S+)$/m.exec(text)?.[1]
  if (!jws) throw new Error(`${source}: unsigned`)
  const [h, p, s] = jws.split('.')
  const header = JSON.parse(Buffer.from(h, 'base64url').toString())
  const raw = Object.hasOwn(keys, header.kid) ? keys[header.kid] : undefined
  if (!raw || header.typ !== FEED_TYPE)
    throw new Error(`${source}: signed by ${header.kid}, which isn't in FEED_KEYS`)
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw }, format: 'jwk' })
  if (!verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url')))
    throw new Error(`${source}: bad signature`)
  const signed = JSON.parse(Buffer.from(p, 'base64url').toString())
  const now = feedClaims(text, source)
  if (JSON.stringify(signed.version) !== JSON.stringify(now.version))
    throw new Error(`${source}: signed ${signed.version}, names ${now.version}`)
  const names = (fs) => fs.map((f) => `${f.url} ${f.sha512}`).sort()
  if (JSON.stringify(names(signed.files)) !== JSON.stringify(names(now.files)))
    throw new Error(`${source}: names other files than it signed`)
  return { kid: header.kid, ...signed }
}

function privateKeyFromEnv() {
  const text = process.env.PIXL_FEED_KEY
  if (text) return createPrivateKey(text)
  const file = process.env.PIXL_FEED_KEY_FILE
  if (file) return createPrivateKey(readFileSync(file))
  return null
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === 'key') {
    const kid = args[0]
    if (!kid || !/^[a-z0-9-]+$/.test(kid)) throw new Error('usage: key <kid>, e.g. key feed-1')
    if (existsSync(keyFile(kid))) throw new Error(`${keyFile(kid)} exists; not overwriting it`)
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    mkdirSync(SECRETS, { recursive: true, mode: 0o700 })
    writeFileSync(keyFile(kid), privateKey.export({ format: 'pem', type: 'pkcs8' }), {
      mode: 0o600
    })
    chmodSync(keyFile(kid), 0o600)
    console.error(
      `private key: ${keyFile(kid)} (back it up offline; its text is the PIXL_FEED_KEY secret)`
    )
    console.log(`'${kid}': '${rawOf(publicKey)}'`)
  } else if (cmd === 'sign') {
    if (args.length === 0) throw new Error('usage: sign <feed.yml> [...]')
    const keys = feedKeys()
    const key = privateKeyFromEnv()
    if (!key) {
      if (Object.keys(keys).length > 0) {
        console.log(
          '::error::PIXL_FEED_KEY not set, and the app checks its feed: it would refuse this release'
        )
        process.exit(1)
      }
      console.log(
        '::notice::PIXL_FEED_KEY not set and the app holds no feed key: the feeds go unsigned'
      )
      return
    }
    const kid = kidOf(key, keys)
    if (!kid)
      throw new Error(
        'this key is not in FEED_KEYS (src/main/feedsig.ts): no app would trust its signature'
      )
    for (const file of args) {
      writeFileSync(file, signFeed(readFileSync(file, 'utf8'), key, kid, undefined, file))
      verifyFeed(readFileSync(file, 'utf8'), keys, file)
      console.log(`${file}: signed (${kid})`)
    }
  } else if (cmd === 'verify') {
    const keys = feedKeys()
    for (const file of args) {
      const v = verifyFeed(readFileSync(file, 'utf8'), keys, file)
      console.log(`${file}: ${v.version}, ${v.files.length} files, signed by ${v.kid}`)
    }
  } else {
    console.error('usage: key <kid> | sign <feed.yml> ... | verify <feed.yml> ...')
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
