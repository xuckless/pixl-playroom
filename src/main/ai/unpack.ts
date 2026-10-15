/**
 * Gemma's llama.cpp server, unpacked from its pinned archive and checked
 * against it (audit SEC-6). The archive is checked by its SHA-256 when it
 * arrives (ModelStore.fetchFile) and again whenever one already on disk is
 * reused; it is unpacked by the system's own tar (by its absolute path,
 * never one found on PATH) into a fresh folder, refused when any entry would
 * land outside it, and only then moved into place. Before each launch the
 * server binary is compared with its entry in the archive, and the archive
 * with its pin, so a binary changed on disk never runs with Playroom's
 * permissions.
 *
 * Free of Electron, for tests/unpack.test.ts.
 */
import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, existsSync } from 'fs'
import { lstat, mkdir, readdir, readlink, rename, rm } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'path'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import { within } from '../contain'

const run = promisify(execFile)

/** A file's SHA-256, hex, read as a stream. */
export async function sha256Of(file: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), h)
  return h.digest('hex')
}

/**
 * The system's tar, by its absolute path: bsdtar at /usr/bin/tar on macOS,
 * System32's tar.exe on Windows 10 and later (it reads a zip too), GNU tar
 * on Linux. Never one a PATH could put first.
 */
export function tarPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (platform === 'win32')
    return win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  if (platform === 'linux' && !existsSync('/usr/bin/tar')) return '/bin/tar'
  return '/usr/bin/tar'
}

/** An entry's name as tar lists it, with either separator, without a leading `./`. */
export const entryPath = (name: string): string => name.replace(/\\/g, '/').replace(/^(\.\/)+/, '')

/** Whether an archive entry would land outside the folder it is unpacked into. */
export function entryEscapes(name: string): boolean {
  const p = entryPath(name)
  if (p === '' || p.includes('\0')) return true
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return true
  return p.split('/').some((s) => s === '..')
}

/** The archive's entries, as its tar lists them. */
export async function listArchive(archive: string, tar = tarPath()): Promise<string[]> {
  const { stdout } = await run(tar, ['-tf', archive], { maxBuffer: 64 * 1024 * 1024 })
  return stdout.split(/\r?\n/).filter((l) => l !== '')
}

/** Every link under `dir` that points outside it, as a path relative to `dir`. */
async function linksOutside(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      const st = await lstat(p)
      if (st.isSymbolicLink()) {
        const to = await readlink(p)
        if (isAbsolute(to) || !within(dir, resolve(dirname(p), to))) out.push(relative(dir, p))
      } else if (st.isDirectory()) await walk(p)
    }
  }
  await walk(dir)
  return out
}

/**
 * Unpack `archive` into `into`: listed first and refused if any entry would
 * land outside, unpacked into a fresh folder beside `into`, refused if a link
 * in it points outside, and only then put in place of `into`.
 */
export async function unpack(archive: string, into: string, tar = tarPath()): Promise<void> {
  const bad = (await listArchive(archive, tar)).filter(entryEscapes)
  if (bad.length > 0) throw new Error(`the archive names files outside its folder: ${bad[0]}`)
  const fresh = `${into}.unpacking-${process.pid}`
  await rm(fresh, { recursive: true, force: true })
  await mkdir(fresh, { recursive: true })
  try {
    await run(tar, ['-xf', archive, '-C', fresh])
    const links = await linksOutside(fresh)
    if (links.length > 0) throw new Error(`the archive links outside its folder: ${links[0]}`)
    await rm(into, { recursive: true, force: true })
    await rename(fresh, into)
  } catch (err) {
    await rm(fresh, { recursive: true, force: true })
    throw err
  }
}

/** The SHA-256 of one entry of the archive, read by tar to a pipe (nothing written). */
export function entrySha256(archive: string, entry: string, tar = tarPath()): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const h = createHash('sha256')
    const child = spawn(tar, ['-xOf', archive, entry], { stdio: ['ignore', 'pipe', 'ignore'] })
    child.stdout.on('data', (b: Buffer) => h.update(b))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(h.digest('hex'))
        : reject(new Error(`tar could not read ${entry}`))
    )
  })
}

/**
 * Whether the server about to run is the one in its pinned archive: the
 * archive's SHA-256 is its pin's, and `binary` (under `unpacked`) is byte for
 * byte its entry there. A file added beside the server, or the server changed
 * after it was unpacked, is refused.
 */
export async function serverMatches(
  archive: string,
  sha256: string,
  unpacked: string,
  binary: string,
  tar = tarPath()
): Promise<boolean> {
  try {
    if ((await sha256Of(archive)) !== sha256) return false
    const rel = relative(unpacked, binary).split(sep).join('/')
    if (!within(unpacked, binary) || entryEscapes(rel)) return false
    const entry = (await listArchive(archive, tar)).find((e) => entryPath(e) === rel)
    if (!entry) return false
    return (await entrySha256(archive, entry, tar)) === (await sha256Of(binary))
  } catch {
    return false
  }
}
