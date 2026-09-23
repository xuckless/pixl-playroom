#!/usr/bin/env node
// Fetch what Enhance → Super Resolution bundles: Microsoft's prebuilt ONNX
// Runtime for a platform and the Real-ESRGAN ×2 model (BSD-3-Clause), into
// resources/ai/<platform>-<arch>/ — the layout src/main/paths.ts and
// electron-builder.yml expect. The same versions and checksum the engine's
// Enhance is tested against.
//
//   node scripts/fetch-ai.mjs                       this machine
//   node scripts/fetch-ai.mjs darwin-arm64          another target (for packaging)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'

const ORT_VERSION = '1.28.0'
const MODEL = 'real_esrgan_x2.onnx'
const MODEL_URL = `https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/main/${MODEL}`
const MODEL_SHA256 = '7115ba92e8a1bfa63d68558ef006ef3d91273a068d321b1439f8bb1c9179002c'
const ORT_ASSETS = {
  'darwin-arm64': `onnxruntime-osx-arm64-${ORT_VERSION}.tgz`,
  'darwin-x64': `onnxruntime-osx-x86_64-${ORT_VERSION}.tgz`,
  'linux-x64': `onnxruntime-linux-x64-${ORT_VERSION}.tgz`,
  'linux-arm64': `onnxruntime-linux-aarch64-${ORT_VERSION}.tgz`,
  'win32-x64': `onnxruntime-win-x64-${ORT_VERSION}.zip`
}

const target = process.argv[2] ?? `${process.platform}-${process.arch}`
const asset = ORT_ASSETS[target]
if (!asset) {
  console.error(`fetch-ai: no ONNX Runtime ${ORT_VERSION} build known for ${target}`)
  process.exit(1)
}
const dir = resolve(import.meta.dirname, '..', 'resources', 'ai', target)
mkdirSync(dir, { recursive: true })

async function download(url, file) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const model = join(dir, MODEL)
if (!existsSync(model) || sha256(model) !== MODEL_SHA256) {
  console.log(`fetching ${MODEL} (67 MB)`)
  await download(MODEL_URL, `${model}.part`)
  const got = sha256(`${model}.part`)
  if (got !== MODEL_SHA256) {
    rmSync(`${model}.part`)
    throw new Error(`checksum mismatch for ${MODEL}: ${got}`)
  }
  renameSync(`${model}.part`, model)
}

const ortDir = join(dir, 'onnxruntime')
if (!existsSync(join(ortDir, 'lib'))) {
  console.log(`fetching ${asset}`)
  const archive = join(dir, asset)
  await download(
    `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/${asset}`,
    archive
  )
  // bsdtar (macOS, Windows 10+) and GNU tar both unpack .tgz; bsdtar unpacks .zip too.
  execFileSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' })
  rmSync(archive)
  const unpacked = readdirSync(dir).find((f) => f.startsWith('onnxruntime-'))
  if (!unpacked) throw new Error('the ONNX Runtime archive held no onnxruntime-* folder')
  rmSync(ortDir, { recursive: true, force: true })
  renameSync(join(dir, unpacked), ortDir)
}
console.log(`ai bundle ready: ${dir}`)
