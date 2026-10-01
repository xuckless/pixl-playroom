// The pixl-updates bucket through R2's S3 API, without the AWS CLI: GET, PUT
// and DELETE one object, signed with AWS Signature V4. For the owner's
// scripts (rollout.mjs, policy.mjs); release.yml uses the AWS CLI.
//
// Reads the same names release.yml does: R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY and R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com),
// and R2_BUCKET (default pixl-updates).
import { createHash, createHmac } from 'node:crypto'

const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

function env(name, fallback) {
  const v = process.env[name] ?? fallback
  if (!v) throw new Error(`${name} isn't set (see RELEASING.md, "The update bucket")`)
  return v
}

/** One signed request; answers fetch's Response. */
export async function r2(method, key, { body, headers = {} } = {}) {
  const endpoint = env('R2_ENDPOINT').replace(/\/+$/, '')
  const bucket = env('R2_BUCKET', 'pixl-updates')
  const keyId = env('R2_ACCESS_KEY_ID')
  const secret = env('R2_SECRET_ACCESS_KEY')
  const path = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  const host = new URL(endpoint).host
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
  const date = now.slice(0, 8)
  const payload = sha256(body ?? '')
  const signed = 'host;x-amz-content-sha256;x-amz-date'
  const canonical = [
    method,
    path,
    '',
    `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${now}\n`,
    signed,
    payload
  ].join('\n')
  const scope = `${date}/auto/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n')
  const k = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), 'auto'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', k).update(toSign).digest('hex')
  return fetch(`${endpoint}${path}`, {
    method,
    body,
    headers: {
      ...headers,
      'x-amz-content-sha256': payload,
      'x-amz-date': now,
      Authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`
    }
  })
}

/** An object's text, or null when there is none. */
export async function getText(key) {
  const res = await r2('GET', key)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET ${key}: HTTP ${res.status}: ${await res.text()}`)
  return res.text()
}

export async function putText(key, text, contentType) {
  const res = await r2('PUT', key, {
    body: text,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' }
  })
  if (!res.ok) throw new Error(`PUT ${key}: HTTP ${res.status}: ${await res.text()}`)
}

export async function remove(key) {
  const res = await r2('DELETE', key)
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${key}: HTTP ${res.status}`)
}

/** `--name value` and `--flag` out of argv. */
export function flags(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) out._.push(a)
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) out[a.slice(2)] = true
    else out[a.slice(2)] = argv[++i]
  }
  return out
}
