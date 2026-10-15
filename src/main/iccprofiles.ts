/**
 * The ICC profiles soft proofing offers (shared/proof.ts): found where the
 * system and printer drivers keep them, each read whole once for its
 * SHA-256 (what finds it again if it moves, and merges the copies Epson's
 * drivers repeat) and its header (class, data space, name). Scanned again
 * each time the proof setup opens, with no watching; a file whose size and
 * time are unchanged is not read again.
 *
 * The engine takes a profile's bytes in every request (`{ Icc: number[] }`),
 * so the few in use are kept here as numbers, by SHA-256.
 */
import { createHash } from 'crypto'
import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, extname, join } from 'path'
import { isSafeLocalPath } from './contain'
import {
  MAX_ICC_BYTES,
  mergeBySha,
  NOT_A_PROFILE,
  proofUse,
  readIccHeader,
  type FoundProfile,
  type IccProof
} from '../shared/proof'

/** How deep a folder is walked (printer drivers nest theirs in bundles). */
const MAX_DEPTH = 8
/** At most this many profiles are read in one scan. */
const MAX_FILES = 2000
/** The profiles kept as numbers for the engine. */
const KEEP_BYTES = 4

/** Where this platform keeps ICC profiles, the person's own first; printers' last. */
export function profileFolders(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string[] {
  if (platform === 'darwin')
    return [
      join(home, 'Library', 'ColorSync', 'Profiles'),
      join('/Library', 'ColorSync', 'Profiles'),
      join('/Network', 'Library', 'ColorSync', 'Profiles'),
      join('/System', 'Library', 'ColorSync', 'Profiles'),
      join('/Library', 'Printers')
    ]
  if (platform === 'win32')
    return [join(env['WINDIR'] ?? 'C:\\Windows', 'System32', 'spool', 'drivers', 'color')]
  return [
    join(home, '.local', 'share', 'icc'),
    join(home, '.color', 'icc'),
    join('/usr', 'local', 'share', 'color', 'icc'),
    join('/usr', 'share', 'color', 'icc')
  ]
}

const isProfileFile = (name: string): boolean => /^\.ic[cm]$/i.test(extname(name))

/** What reading a file as a profile gave: the profile, or why it is none. */
export type ReadProfile = { found: FoundProfile; bytes: Buffer } | { error: string }

/** A file read as a profile (Browse…, a scan), with what engine 0.21 can do with it. */
export async function readProfile(path: string): Promise<ReadProfile> {
  try {
    const st = await stat(path)
    if (!st.isFile() || st.size > MAX_ICC_BYTES || st.size < 132) return { error: NOT_A_PROFILE }
    const bytes = await readFile(path)
    const header = readIccHeader(bytes)
    if (!header) return { error: NOT_A_PROFILE }
    const use = proofUse(header)
    const found: FoundProfile = {
      sha: createHash('sha256').update(bytes).digest('hex'),
      name: header.name ?? basename(path, extname(path)),
      path,
      cls: header.cls,
      space: header.space,
      use: use.use,
      ...(use.use === 'none' ? { why: use.why } : {}),
      size: bytes.length
    }
    return { found, bytes }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

/** The last scan's profiles, by path, with the size and time they were read at. */
const scanned = new Map<string, { size: number; mtime: number; found: FoundProfile | null }>()
let scanning: Promise<FoundProfile[]> | null = null
let lastScan: FoundProfile[] | null = null

async function walk(dir: string, depth: number, into: string[]): Promise<void> {
  if (depth > MAX_DEPTH || into.length >= MAX_FILES) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (into.length >= MAX_FILES) return
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, depth + 1, into)
    else if ((e.isFile() || e.isSymbolicLink()) && isProfileFile(e.name)) into.push(p)
  }
}

/** A file read as a profile, or null: read again only when its size or time changed. */
async function scannedProfile(path: string): Promise<FoundProfile | null> {
  const st = await stat(path).catch(() => null)
  if (!st) return null
  const was = scanned.get(path)
  if (was && was.size === st.size && was.mtime === st.mtimeMs) return was.found
  const r = await readProfile(path)
  const found = 'found' in r ? r.found : null
  scanned.set(path, { size: st.size, mtime: st.mtimeMs, found })
  return found
}

/**
 * Every profile in the folders (`profileFolders`), the same one once: the
 * scan the proof setup asks for as it opens. One scan at a time; a second
 * ask while it runs waits for it.
 */
export function scanProfiles(folders: string[] = profileFolders()): Promise<FoundProfile[]> {
  scanning ??= (async () => {
    const files: string[] = []
    for (const f of folders) await walk(f, 0, files)
    const out: FoundProfile[] = []
    for (const path of files) {
      const found = await scannedProfile(path)
      if (found) out.push(found)
    }
    lastScan = mergeBySha(out)
    return lastScan
  })().finally(() => {
    scanning = null
  })
  return scanning
}

/** Profiles chosen with Browse… or Locate… this run: a network path among them is the person's own choice. */
const chosen = new Set<string>()

/** A profile file the person chose (Browse…, Locate…): read from where it is, a network share included. */
export function chooseProfile(path: string): void {
  chosen.add(path)
}

/**
 * Whether a proof's path may be looked at. It travels in a copy's sidecar
 * and in a project, so it is a file's word: never a device, and a network
 * path only when chosen here (on Windows, looking at a UNC path sends the
 * person's NTLM hash to whoever serves it). A profile elsewhere is still
 * found by its SHA-256 in the folders scanned.
 */
const mayRead = (path: string): boolean => chosen.has(path) || isSafeLocalPath(path)

/**
 * The setup's list: every profile the scan finds, and those named outside
 * its folders (Recent's, the proof in force: a file once chosen with
 * Browse…) where they still are, each once.
 */
export async function proofProfiles(named: readonly string[] = []): Promise<FoundProfile[]> {
  const found = await scanProfiles()
  const known = new Set(found.map((f) => f.path))
  const more: FoundProfile[] = []
  for (const path of new Set(named)) {
    if (known.has(path) || !mayRead(path)) continue
    const f = await scannedProfile(path)
    if (f) more.push(f)
  }
  return mergeBySha([...found, ...more])
}

/** A profile's bytes as the engine takes them, by SHA-256: the last few used. */
const kept = new Map<string, number[]>()

function keep(sha: string, bytes: Uint8Array): number[] {
  const numbers = Array.from(bytes)
  kept.delete(sha)
  kept.set(sha, numbers)
  while (kept.size > KEEP_BYTES) kept.delete(kept.keys().next().value as string)
  return numbers
}

/**
 * A chosen profile's bytes: from where it was chosen, else wherever a scan
 * finds the same file (moved, a driver updated); null when it is nowhere
 * (a volume not mounted, the file deleted). Never another profile in its place.
 */
export async function profileBytes(p: IccProof): Promise<number[] | null> {
  const have = kept.get(p.sha)
  const readable = mayRead(p.path)
  // Kept, and its file still there (a profile deleted or unmounted since is not proofed with).
  if (
    have &&
    readable &&
    (await stat(p.path).then(
      (s) => s.isFile() && s.size === have.length,
      () => false
    ))
  ) {
    kept.delete(p.sha)
    kept.set(p.sha, have)
    return have
  }
  const at = async (path: string): Promise<number[] | null> => {
    const r = await readProfile(path)
    return 'found' in r && r.found.sha === p.sha ? keep(p.sha, r.bytes) : null
  }
  const direct = readable ? await at(p.path) : null
  if (direct) return direct
  kept.delete(p.sha)
  // Elsewhere: where the last scan saw it, else where a scan now finds it.
  const elsewhere = (list: FoundProfile[]): FoundProfile | undefined =>
    list.find((f) => f.sha === p.sha && f.path !== p.path)
  const seen = lastScan ? elsewhere(lastScan) : undefined
  const moved = (seen && (await at(seen.path))) || null
  if (moved) return moved
  const now = elsewhere(await scanProfiles())
  return now ? at(now.path) : null
}

/** For tests: forget what was scanned and kept. */
export function resetProfiles(): void {
  scanned.clear()
  chosen.clear()
  kept.clear()
  lastScan = null
}
