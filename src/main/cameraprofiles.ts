/**
 * DNG camera profiles (`.dcp`, engine 0.21, E21): the ones the person
 * imported, kept as the engine reads them (one JSON file each under
 * userData/camera-profiles, named by the first 8 hex digits of the file's
 * SHA-256), and the ones Adobe's DNG Converter or Camera Raw installed,
 * found where Adobe keeps them. Playroom never ships Adobe's profiles and
 * never keeps a path to one: a profile chosen from Adobe's folder is
 * imported (its JSON kept) first.
 *
 * A photo's colour names a profile by its id (`dcp:<id>`, shared/rawcolour.ts);
 * the profile is registered there for the develop, and carried in the
 * photo's sidecar or project by the index.
 */
import { createHash } from 'crypto'
import log from 'electron-log/main'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, join } from 'path'
import type { DcpProfile, SourceInfo } from '../shared/engine-types'
import { profileFits, profileLabel, readProfile, registerDcp } from '../shared/rawcolour'
import type { EngineClient } from './engine/client'

/** A profile kept for the person, with where it came from. */
export interface KeptProfile {
  id: string
  /** The file it was imported from, by name (for the menu's words, never read again). */
  file: string
  importedAt: string
  profile: DcpProfile
}

/** A profile in Adobe's folders that fits a body, not imported yet. */
export interface FoundProfile {
  path: string
  name: string
}

/** A `.dcp` file's id: the first 8 hex digits of its SHA-256. */
export function profileId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8)
}

/**
 * Where Adobe's DNG Converter and Camera Raw install camera profiles: the
 * machine's folder and the person's own (macOS: Application Support; Windows:
 * ProgramData and AppData).
 */
export function adobeFolders(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string[] {
  const tail = ['Adobe', 'CameraRaw', 'CameraProfiles']
  if (platform === 'darwin')
    return [
      join('/Library', 'Application Support', ...tail),
      join(home, 'Library', 'Application Support', ...tail)
    ]
  if (platform === 'win32')
    return [
      join(env['ProgramData'] ?? 'C:\\ProgramData', ...tail),
      ...(env['APPDATA'] ? [join(env['APPDATA'], ...tail)] : [])
    ]
  return []
}

/** Names compared as Adobe writes a body into a file name: case and spacing aside. */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()

/**
 * Whether an Adobe profile's file is named for one of these bodies:
 * "Canon EOS 200D Adobe Standard.dcp", "Canon EOS 200D Camera Faithful.dcp".
 * Read before deciding (the profile's own UniqueCameraModel decides); the
 * name only keeps the other 1400 files unread.
 */
export function namedFor(file: string, bodies: string[]): boolean {
  const name = norm(basename(file).replace(/\.dcp$/i, ''))
  return bodies.some((b) => b && name.startsWith(`${norm(b)} `))
}

export class CameraProfiles {
  private kept = new Map<string, KeptProfile>()
  /** Adobe's `.dcp` files, listed once a run (a few thousand names). */
  private adobeFiles: Promise<string[]> | null = null

  private readonly dir: string
  private readonly engine: Pick<EngineClient, 'readCameraProfile'>
  private readonly folders: string[]

  constructor(
    dir: string,
    engine: Pick<EngineClient, 'readCameraProfile'>,
    folders: string[] = adobeFolders()
  ) {
    this.dir = dir
    this.engine = engine
    this.folders = folders
  }

  /** Read the kept profiles and register them for the develop. Sync: once, at start. */
  load(): void {
    if (!existsSync(this.dir)) return
    for (const f of readdirSync(this.dir)) {
      if (!/^[0-9a-f]{8}\.json$/.test(f)) continue
      try {
        const o = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Partial<KeptProfile>
        const profile = readProfile(o.profile)
        const id = f.slice(0, 8)
        if (!profile) continue
        this.remember({
          id,
          file: String(o.file ?? ''),
          importedAt: String(o.importedAt ?? ''),
          profile
        })
      } catch (err) {
        log.warn('camera profile not read', f, (err as Error).message)
      }
    }
  }

  private remember(k: KeptProfile): void {
    this.kept.set(k.id, k)
    registerDcp(k.id, k.profile)
  }

  get(id: string): KeptProfile | null {
    return this.kept.get(id) ?? null
  }

  /** Import a `.dcp` file: read by the engine, kept as JSON, registered. Refused by the engine if it is not one. */
  async import(path: string): Promise<KeptProfile> {
    const bytes = await readFile(path)
    const id = profileId(bytes)
    const had = this.kept.get(id)
    if (had) return had
    const profile = await this.engine.readCameraProfile(new Uint8Array(bytes))
    const k: KeptProfile = {
      id,
      file: basename(path),
      importedAt: new Date().toISOString(),
      profile
    }
    await this.write(k)
    return k
  }

  /** A profile a photo's sidecar or project carried in: kept here too, so it can be chosen again. */
  async keep(id: string, profile: DcpProfile): Promise<void> {
    if (this.kept.has(id)) return
    await this.write({ id, file: '', importedAt: new Date().toISOString(), profile })
  }

  private async write(k: KeptProfile): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, `${k.id}.json`), JSON.stringify(k))
    this.remember(k)
  }

  /** The kept profiles for this RAW's body, by name. */
  forCamera(info: Pick<SourceInfo, 'camera_colour'>): KeptProfile[] {
    return [...this.kept.values()]
      .filter((k) => profileFits(k.profile, info))
      .sort((a, b) => profileLabel(a.profile).localeCompare(profileLabel(b.profile)))
  }

  /**
   * The profiles Adobe's folders hold for this RAW's body that are not kept
   * yet: named for it, read, and its UniqueCameraModel the body's.
   */
  async adobe(info: Pick<SourceInfo, 'camera_colour'>): Promise<FoundProfile[]> {
    const cc = info.camera_colour
    if (!cc) return []
    const bodies = [`${cc.make} ${cc.model}`, cc.pixl_camera ?? '']
    const files = (await this.listAdobe()).filter((f) => namedFor(f, bodies))
    const found: FoundProfile[] = []
    for (const path of files) {
      try {
        const bytes = await readFile(path)
        if (this.kept.has(profileId(bytes))) continue
        const profile = await this.engine.readCameraProfile(new Uint8Array(bytes))
        if (profileFits(profile, info)) found.push({ path, name: profileLabel(profile) })
      } catch (err) {
        log.info('Adobe camera profile not read', path, (err as Error).message)
      }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name))
  }

  private listAdobe(): Promise<string[]> {
    if (!this.adobeFiles) this.adobeFiles = this.walk()
    return this.adobeFiles
  }

  /** Every `.dcp` under Adobe's folders, three levels down at most ("Camera/<body>/…"). */
  private async walk(): Promise<string[]> {
    const out: string[] = []
    const visit = async (dir: string, depth: number): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory() && depth < 3) await visit(p, depth + 1)
        else if (e.isFile() && /\.dcp$/i.test(e.name)) out.push(p)
      }
    }
    for (const f of this.folders) await visit(f, 0)
    return out
  }
}
