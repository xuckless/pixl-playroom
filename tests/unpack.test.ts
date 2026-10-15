import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  entryEscapes,
  entryPath,
  entrySha256,
  serverMatches,
  sha256Of,
  tarPath,
  unpack
} from '../src/main/ai/unpack'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pixl-unpack-'))
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

/** One ustar entry: a file ('0'), a folder ('5') or a symbolic link ('2'). */
function entry(name: string, body: Buffer, type = '0', link = ''): Buffer {
  const h = Buffer.alloc(512)
  const put = (s: string, at: number, len: number): void => {
    h.write(s.slice(0, len), at, 'utf8')
  }
  const octal = (n: number, len: number): string => n.toString(8).padStart(len - 1, '0') + '\0'
  put(name, 0, 100)
  put(octal(type === '5' ? 0o755 : 0o644, 8), 100, 8)
  put(octal(0, 8), 108, 8)
  put(octal(0, 8), 116, 8)
  put(octal(type === '0' ? body.length : 0, 12), 124, 12)
  put(octal(0, 12), 136, 12)
  h.fill(' ', 148, 156)
  put(type, 156, 1)
  put(link, 157, 100)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  let sum = 0
  for (const b of h) sum += b
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  const pad = type === '0' ? Buffer.alloc((512 - (body.length % 512)) % 512) : Buffer.alloc(0)
  return Buffer.concat([h, type === '0' ? body : Buffer.alloc(0), pad])
}

const tarOf = (...entries: Buffer[]): Buffer => Buffer.concat([...entries, Buffer.alloc(1024)])

const SERVER = Buffer.from('#!/bin/sh\necho llama\n')

test('tar is the system’s own, by its absolute path', () => {
  assert.equal(tarPath('darwin'), '/usr/bin/tar')
  assert.equal(tarPath('win32', { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\tar.exe')
  assert.match(tarPath('linux'), /^\/(usr\/)?bin\/tar$/)
})

test('an entry that would land outside its folder is told', () => {
  assert.equal(entryPath('./build/bin/llama-server'), 'build/bin/llama-server')
  assert.equal(entryPath('build\\bin\\llama-server.exe'), 'build/bin/llama-server.exe')
  for (const ok of ['build/bin/llama-server', './a', 'a/b..c/d', 'llama-b1/'])
    assert.equal(entryEscapes(ok), false, ok)
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\x', '..\\x', '', 'a/..'])
    assert.equal(entryEscapes(bad), true, bad)
})

test('an archive is unpacked whole into its folder, and the server checked against it', async () => {
  const dir = tmp()
  const archive = join(dir, 'llama.tar')
  writeFileSync(
    archive,
    tarOf(
      entry('build/', Buffer.alloc(0), '5'),
      entry('build/bin/', Buffer.alloc(0), '5'),
      entry('build/bin/llama-server', SERVER),
      entry('build/bin/libggml.dylib', Buffer.from('lib')),
      entry('build/bin/libggml.1.dylib', Buffer.alloc(0), '2', 'libggml.dylib')
    )
  )
  const into = join(dir, 'server')
  mkdirSync(into)
  writeFileSync(join(into, 'old'), 'from before')
  await unpack(archive, into)
  const binary = join(into, 'build', 'bin', 'llama-server')
  assert.equal(readFileSync(binary, 'utf8'), SERVER.toString())
  assert.equal(existsSync(join(into, 'old')), false, 'what was there before is replaced whole')
  assert.equal(await entrySha256(archive, 'build/bin/llama-server'), sha(SERVER))
  const pin = await sha256Of(archive)
  assert.equal(await serverMatches(archive, pin, into, binary), true)
  // Changed on disk after it was unpacked: refused.
  writeFileSync(binary, '#!/bin/sh\necho owned\n')
  assert.equal(await serverMatches(archive, pin, into, binary), false)
  // A file the archive never held, posing as the server: refused.
  writeFileSync(join(into, 'llama-server'), SERVER)
  assert.equal(await serverMatches(archive, pin, into, join(into, 'llama-server')), false)
  // The archive itself not its pin's: refused.
  assert.equal(await serverMatches(archive, 'f'.repeat(64), into, binary), false)
  rmSync(dir, { recursive: true })
})

test('an archive that climbs out, or links out, puts nothing outside its folder', async () => {
  const dir = tmp()
  const outside = join(dir, 'outside')
  for (const [name, archive] of [
    ['climbs', tarOf(entry('ok', SERVER), entry('../outside', Buffer.from('owned')))],
    ['absolute', tarOf(entry(`${outside}-abs`, Buffer.from('owned')))],
    [
      'links',
      tarOf(entry('bin/', Buffer.alloc(0), '5'), entry('bin/up', Buffer.alloc(0), '2', '../../'))
    ]
  ] as const) {
    const file = join(dir, `${name}.tar`)
    writeFileSync(file, archive)
    const into = join(dir, `${name}-server`)
    const failed = await unpack(file, into).then(
      () => null,
      (err: Error) => err
    )
    assert.equal(existsSync(`${into}.unpacking-${process.pid}`), false, `${name}: no leftovers`)
    if (failed) assert.equal(existsSync(into), false, `${name}: nothing put in place`)
    // bsdtar (macOS, Windows) lists an absolute name as it is, and it is
    // refused; GNU tar strips its leading slash, and it lands inside.
    else assert.equal(name, 'absolute', `${name} must be refused`)
  }
  assert.equal(existsSync(outside), false)
  assert.equal(existsSync(`${outside}-abs`), false)
  rmSync(dir, { recursive: true })
})
