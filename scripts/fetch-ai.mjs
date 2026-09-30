#!/usr/bin/env node
// Fetch the Real-ESRGAN ×2 model (BSD-3-Clause) Enhance → Super Resolution
// bundles, into resources/ai/<platform>-<arch>/ — the layout
// src/main/paths.ts and electron-builder.yml expect. The file and checksum
// are the engine's roster entry `real-esrgan-x2plus`. The ONNX Runtime it
// runs on ships inside the engine's platform package (0.15+).
//
//   node scripts/fetch-ai.mjs                       this machine
//   node scripts/fetch-ai.mjs darwin-arm64          another target (for packaging)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MODEL = 'real_esrgan_x2.onnx'
const MODEL_URL = `https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/09f741bac80a246b407da3ee902bf5f3291b602f/${MODEL}`
const MODEL_SHA256 = '7115ba92e8a1bfa63d68558ef006ef3d91273a068d321b1439f8bb1c9179002c'
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64']

const target = process.argv[2] ?? `${process.platform}-${process.arch}`
if (!TARGETS.includes(target)) {
  console.error(`fetch-ai: the engine ships no build for ${target}`)
  process.exit(1)
}
const dir = resolve(import.meta.dirname, '..', 'resources', 'ai', target)
mkdirSync(dir, { recursive: true })
// Before 0.15 the runtime was fetched here; the engine's own copy replaces it.
rmSync(join(dir, 'onnxruntime'), { recursive: true, force: true })

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
console.log(`ai bundle ready: ${dir}`)
