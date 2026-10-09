/**
 * Lens profiles: the catalogue (Lensfun's database, converted by
 * `scripts/lensfun-profiles.mjs`) and the profiles the user imports.
 *
 * - **Bundled**: the catalogue the app ships (`resources/lens-profiles`),
 *   so every lens Lensfun knows is there offline, from the first run.
 * - **Online**: the same layout on the models server
 *   (`<models>/lens-profiles/v1/index.json` and its shards). Checked a little
 *   after start and every few hours; a new version's changed shards are
 *   downloaded (the rest copied from what is here), each checked against
 *   the index's SHA-256, staged and swapped in whole, and kept in
 *   `userData/lens-profiles/catalog` — used whenever it is newer than the
 *   bundled one. The renderer is told, and re-resolves.
 * - **Imported**: the user's own JSON files in `userData/lens-profiles`,
 *   which come first where they name the same lens.
 *
 * Matching a photo's lens and resolving the profile for it happen here,
 * where the catalogue is: the renderer gets one resolved correction, not
 * fifteen hundred lenses. `PLAYROOM_LENS_PROFILES_URL` points the online
 * catalogue somewhere else (`file://` works).
 */
import { t } from '../shared/i18n'
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { createHash } from 'crypto'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { fileURLToPath } from 'url'
import { IPC, type LensCatalogStatus, type LensMatch, type LensSearchHit } from '../shared/ipc'
import {
  findCamera,
  matchProfile,
  mountsFor,
  profileName,
  resolveProfile,
  shotCrop,
  validateProfile,
  type CameraEntry,
  type LensProfile,
  type MountEntry,
  type ShotCamera
} from '../shared/lens'
import type { ShotLens } from '../shared/engine-types'
import { MODELS_BASE } from './ai/models'
import { exists } from './exists'
import { paths } from './paths'

/** The catalogue's layout version: an app reads only the format it knows. */
const FORMAT = 1
const BASE = (process.env.PLAYROOM_LENS_PROFILES_URL ?? `${MODELS_BASE}/lens-profiles/v1`).replace(
  /\/+$/,
  ''
)
const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 30_000

interface Shard {
  name: string
  file: string
  sha256: string
  bytes: number
  lenses: number
  cameras: number
}

export interface CatalogIndex {
  format: number
  version: string
  generated: string
  source: { name: string; url: string; licence: string; commit?: string; committed?: string }
  lenses: number
  cameras: number
  shards: Shard[]
}

interface Catalog {
  index: CatalogIndex
  origin: 'bundled' | 'online'
  dir: string
  lenses: LensProfile[]
  cameras: CameraEntry[]
  mounts: MountEntry[]
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

/** A URL's bytes: `file://` read from disk, anything else fetched. */
async function fetchBytes(url: string): Promise<Buffer> {
  if (url.startsWith('file:')) return readFile(fileURLToPath(url))
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function readIndex(v: unknown): CatalogIndex | null {
  const i = v as CatalogIndex
  if (!i || typeof i !== 'object' || i.format !== FORMAT || typeof i.version !== 'string')
    return null
  if (!Array.isArray(i.shards) || i.shards.some((s) => !/^[\w.-]+\.json$/.test(s.file))) return null
  return i
}

/** A catalogue directory's index alone (small), or null when there is none or it does not read. */
async function readIndexAt(dir: string): Promise<CatalogIndex | null> {
  try {
    return readIndex(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')))
  } catch {
    return null
  }
}

/** A catalogue directory read whole, every shard checked; null when any part is missing or wrong. */
async function readCatalog(dir: string, origin: Catalog['origin']): Promise<Catalog | null> {
  // Nothing downloaded yet is not a fault.
  if (!(await exists(join(dir, 'index.json')))) return null
  try {
    const index = readIndex(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')))
    if (!index) return null
    const lenses: LensProfile[] = []
    const cameras: CameraEntry[] = []
    const mounts: MountEntry[] = []
    for (const s of index.shards) {
      const body = await readFile(join(dir, s.file))
      if (sha256(body) !== s.sha256) throw new Error(`${s.file}: checksum differs from the index`)
      const shard = JSON.parse(body.toString('utf8')) as {
        lenses?: unknown[]
        cameras?: CameraEntry[]
        mounts?: MountEntry[]
      }
      for (const l of shard.lenses ?? []) {
        const id = (l as { id?: unknown }).id
        const p = validateProfile(l, typeof id === 'string' ? id : '')
        if (typeof p !== 'string' && p.id) lenses.push(p)
      }
      cameras.push(...(shard.cameras ?? []))
      mounts.push(...(shard.mounts ?? []))
    }
    return { index, origin, dir, lenses, cameras, mounts }
  } catch (err) {
    log.warn('lens catalogue unreadable', dir, (err as Error).message)
    return null
  }
}

/** Every imported profile that reads; a file that does not is logged and left out. */
export async function listImported(): Promise<LensProfile[]> {
  const dir = paths.lensProfiles()
  const files = (await readdir(dir)).filter((f) => extname(f).toLowerCase() === '.json').sort()
  const out: LensProfile[] = []
  for (const f of files) {
    try {
      const p = validateProfile(
        JSON.parse(await readFile(join(dir, f), 'utf8')),
        basename(f, '.json')
      )
      if (typeof p === 'string') log.warn('lens profile refused', f, p)
      else out.push({ ...p, source: p.source ?? t('Imported') })
    } catch (err) {
      log.warn('lens profile unreadable', f, (err as Error).message)
    }
  }
  return out
}

/**
 * Copy profiles into the store after checking each; a file that is not a
 * profile is refused by name with the reason, and nothing of it is kept.
 */
export async function importProfiles(files: string[]): Promise<LensProfile[]> {
  const out: LensProfile[] = []
  for (const f of files) {
    const id = basename(f, extname(f))
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(f, 'utf8'))
    } catch {
      throw new Error(t('{{file}} is not JSON', { file: basename(f) }))
    }
    const p = validateProfile(parsed, id)
    if (typeof p === 'string') throw new Error(`${basename(f)}: ${p}`)
    await writeFile(join(paths.lensProfiles(), `${id}.json`), JSON.stringify(parsed, null, 2))
    out.push(p)
  }
  return out
}

/** A photo as matching needs it: its lens, its camera and its frame. */
export interface LensShot {
  lens: ShotLens | null
  camera: ShotCamera | null
  width: number
  height: number
}

export class LensProfileStore {
  private catalog: Catalog | null = null
  private imported: LensProfile[] = []
  private checkedAt: string | null = null
  private error: string | null = null
  private checking: Promise<LensCatalogStatus> | null = null
  private timer: ReturnType<typeof setInterval> | undefined

  /** Read what is here, then keep the catalogue current in the background. */
  async start(): Promise<void> {
    await this.load()
    setTimeout(() => void this.check().catch(() => undefined), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check().catch(() => undefined), CHECK_EVERY_MS)
  }

  stop(): void {
    clearInterval(this.timer)
  }

  /** The bundled and the downloaded catalogue, whichever is newer, and the imported profiles. */
  async load(): Promise<void> {
    // The indexes say which is newer; only that one is read whole (its
    // shards parsed, hashed and checked), the other only should it not read.
    const [bundledIndex, onlineIndex] = await Promise.all([
      readIndexAt(paths.bundledLensCatalog()),
      readIndexAt(paths.lensCatalog())
    ])
    const onlineFirst =
      !!onlineIndex && (!bundledIndex || onlineIndex.generated >= bundledIndex.generated)
    const order: [string, Catalog['origin']][] = onlineFirst
      ? [
          [paths.lensCatalog(), 'online'],
          [paths.bundledLensCatalog(), 'bundled']
        ]
      : [
          [paths.bundledLensCatalog(), 'bundled'],
          [paths.lensCatalog(), 'online']
        ]
    this.catalog = null
    for (const [dir, origin] of order) {
      this.catalog = await readCatalog(dir, origin)
      if (this.catalog) break
    }
    this.imported = await listImported().catch(() => [])
    if (!this.catalog) log.warn('no lens catalogue: neither the bundled nor a downloaded one reads')
  }

  /** Every profile: the imported first (they win a tie), then the catalogue's. */
  all(): LensProfile[] {
    return [...this.imported, ...(this.catalog?.lenses ?? [])]
  }

  status(): LensCatalogStatus {
    const c = this.catalog
    return {
      version: c?.index.version ?? null,
      origin: c?.origin ?? null,
      generated: c?.index.generated ?? null,
      lensfunCommit: c?.index.source.commit ?? null,
      lenses: c?.lenses.length ?? 0,
      cameras: c?.cameras.length ?? 0,
      imported: this.imported.length,
      checkedAt: this.checkedAt,
      error: this.error,
      url: `${BASE}/index.json`
    }
  }

  /**
   * Look for a newer catalogue online and take it: the index first; each
   * shard it names that is not here with the same SHA-256 downloaded and
   * checked; the whole set staged beside the current one and swapped in.
   */
  check(): Promise<LensCatalogStatus> {
    this.checking ??= this.update().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async update(): Promise<LensCatalogStatus> {
    try {
      const raw = await fetchBytes(`${BASE}/index.json`)
      const index = readIndex(JSON.parse(raw.toString('utf8')))
      if (!index)
        throw new Error(t('the online catalogue is in a format this version does not read'))
      this.checkedAt = new Date().toISOString()
      this.error = null
      const current = this.catalog
      if (current?.index.version === index.version) return this.status()
      if (current && index.generated < current.index.generated) return this.status()
      const target = paths.lensCatalog()
      const staging = `${target}.staging`
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      // What is already here, by checksum: the bundled and the current shards.
      const have = new Map<string, string>()
      const bundledDir = paths.bundledLensCatalog()
      const bundledIndex = await readIndexAt(bundledDir)
      for (const c of [
        current && { index: current.index, dir: current.dir },
        bundledIndex && { index: bundledIndex, dir: bundledDir }
      ])
        for (const s of c?.index.shards ?? []) have.set(s.sha256, join(c!.dir, s.file))
      let fetched = 0
      for (const s of index.shards) {
        const local = have.get(s.sha256)
        if (local && (await exists(local))) {
          await cp(local, join(staging, s.file))
          continue
        }
        const body = await fetchBytes(`${BASE}/${s.file}`)
        if (sha256(body) !== s.sha256) throw new Error(`${s.file}: checksum differs from the index`)
        await writeFile(join(staging, s.file), body)
        fetched++
      }
      await writeFile(join(staging, 'index.json'), raw)
      const staged = await readCatalog(staging, 'online')
      if (!staged) throw new Error(t('the downloaded catalogue does not read'))
      await rm(target, { recursive: true, force: true })
      await rename(staging, target)
      this.catalog = { ...staged, dir: target }
      log.info('lens catalogue updated', index.version, `${fetched} shard(s) downloaded`)
      this.changed()
    } catch (err) {
      this.checkedAt = new Date().toISOString()
      this.error = (err as Error).message
      log.info('lens catalogue check failed', this.error)
    }
    return this.status()
  }

  /** Imported profiles changed (an import): read them again and say so. */
  async reloadImported(): Promise<void> {
    this.imported = await listImported().catch(() => [])
    this.changed()
  }

  private changed(): void {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send(IPC.lens.changed, this.status())
  }

  /** Lenses whose name contains every word of `query`, best first. */
  search(query: string, limit = 40): LensSearchHit[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const hits: LensSearchHit[] = []
    for (const p of this.all()) {
      const name = profileName(p).toLowerCase()
      const hay = `${name} ${(p.aliases ?? []).join(' ').toLowerCase()} ${(p.mounts ?? [p.mount ?? '']).join(' ').toLowerCase()}`
      if (words.every((w) => hay.includes(w)))
        hits.push({
          id: p.id,
          name: profileName(p),
          mount: p.mount ?? null,
          crop: p.calibration?.crop ?? null,
          source: p.source ?? null
        })
      if (hits.length >= limit) break
    }
    return hits
  }

  /**
   * The profile for a photo — the one chosen by id, or the best match for
   * its lens — resolved at its focal length, aperture, crop factor and
   * frame, with how it was found.
   */
  /** A shot's crop factor: from its EXIF, else its camera's in the catalogue; null when neither says. */
  crop(shot: LensShot): number | null {
    const camera = findCamera(shot.camera, this.catalog?.cameras ?? [])
    return shotCrop(shot.lens, camera)?.value ?? null
  }

  resolve(shot: LensShot, id: string | null): LensMatch {
    const camera = findCamera(shot.camera, this.catalog?.cameras ?? [])
    const crop = shotCrop(shot.lens, camera)
    const all = this.all()
    const profile = id
      ? (all.find((p) => p.id === id) ?? null)
      : matchProfile(shot.lens, all, {
          mounts: mountsFor(camera?.mount ?? null, this.catalog?.mounts ?? []),
          crop: crop?.value ?? null
        })
    return {
      profile: profile
        ? {
            id: profile.id,
            name: profileName(profile),
            source: profile.source ?? null,
            mount: profile.mount ?? null,
            calibrationCrop: profile.calibration?.crop ?? null
          }
        : null,
      camera: camera ? { name: profileName(camera), crop: camera.crop } : null,
      resolved: profile
        ? resolveProfile(profile, shot.lens, { crop, width: shot.width, height: shot.height })
        : null,
      catalog: this.status().version
    }
  }
}
