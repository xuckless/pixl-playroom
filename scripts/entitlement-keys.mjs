// The keys behind the entitlement token, so signing keys can change without
// an app release. The app ships only ROOT public keys (src/shared/account.ts:
// ROOT_KEYS). The Worker signs tokens with its own signing key, and hands the
// app a key set: the signing keys valid now, signed by a root. To rotate,
// put the next key in a new key set; to revoke a leaked one, publish a key
// set without it (the app keeps only the newest it has seen).
//
//   node scripts/entitlement-keys.mjs root <kid>
//       Makes a root key pair. The private key goes to ~/.pixl-secrets/
//       (never overwritten; back it up offline). Prints the public key for
//       ROOT_KEYS.
//   node scripts/entitlement-keys.mjs sign-keyset <root-kid> <kid>=<public> [...]
//       Prints the key set (a JWS) for the Worker, signed by that root.
//       `dev-root` signs with the development root (dev-entitlement-root.mjs),
//       which only unpackaged builds trust: for the mock and wrangler dev.
//   node scripts/entitlement-keys.mjs verify <keyset-jws>
//       Checks a key set against ROOT_KEYS and prints its keys.
//
// Public keys are base64url of the raw 32-byte Ed25519 key, as in the
// contract with pixl-web ("Contract with the apps").
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEV_ROOT } from './dev-entitlement-root.mjs'

const SECRETS = join(homedir(), '.pixl-secrets')
const keyFile = (kid) => join(SECRETS, `entitlement-${kid}.pem`)
const ISSUER = 'pixlfoundation.com'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const rawOf = (publicKey) => publicKey.export({ format: 'jwk' }).x
const isRaw = (s) => /^[A-Za-z0-9_-]{43}$/.test(s)

/** ROOT_KEYS, read out of src/shared/account.ts rather than repeated here. */
function rootKeys() {
  const src = readFileSync(new URL('../src/shared/account.ts', import.meta.url), 'utf8')
  const block = /export const ROOT_KEYS[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? ''
  return Object.fromEntries([...block.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]))
}

const [cmd, ...args] = process.argv.slice(2)

if (cmd === 'root') {
  const kid = args[0]
  if (!kid || !/^[a-z0-9-]+$/.test(kid)) throw new Error('usage: root <kid>, e.g. root root-1')
  if (existsSync(keyFile(kid))) throw new Error(`${keyFile(kid)} exists; not overwriting it`)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 })
  writeFileSync(keyFile(kid), privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  chmodSync(keyFile(kid), 0o600)
  console.error(`private key: ${keyFile(kid)} (back it up offline; it never goes to a server)`)
  console.log(`'${kid}': '${rawOf(publicKey)}'`)
} else if (cmd === 'sign-keyset') {
  const [rootKid, ...pairs] = args
  if (!rootKid || pairs.length === 0)
    throw new Error('usage: sign-keyset <root-kid> <kid>=<public> [...]')
  const keys = {}
  for (const p of pairs) {
    const [kid, raw] = p.split('=')
    if (!kid || !isRaw(raw ?? '')) throw new Error(`not <kid>=<base64url raw key>: ${p}`)
    // Fails here, not in the app, on anything that isn't an Ed25519 key.
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw }, format: 'jwk' })
    keys[kid] = raw
  }
  const root =
    rootKid === DEV_ROOT.kid
      ? createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', ...DEV_ROOT }, format: 'jwk' })
      : createPrivateKey(readFileSync(keyFile(rootKid)))
  const data = `${b64({ alg: 'EdDSA', kid: rootKid, typ: 'pixl-keyset' })}.${b64({
    iss: ISSUER,
    keys,
    iat: Math.floor(Date.now() / 1000)
  })}`
  console.log(`${data}.${sign(null, Buffer.from(data), root).toString('base64url')}`)
} else if (cmd === 'verify') {
  const [h, p, s] = (args[0] ?? '').split('.')
  const header = JSON.parse(Buffer.from(h, 'base64url').toString())
  const raw = header.kid === DEV_ROOT.kid ? DEV_ROOT.x : rootKeys()[header.kid]
  if (!raw) throw new Error(`signed by ${header.kid}, which isn't in ROOT_KEYS`)
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw }, format: 'jwk' })
  if (!verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url')))
    throw new Error('bad signature')
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
  console.log(JSON.stringify({ root: header.kid, ...payload }, null, 2))
} else {
  console.error('usage: root <kid> | sign-keyset <root-kid> <kid>=<public> ... | verify <jws>')
  process.exit(1)
}
