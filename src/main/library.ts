/**
 * The library: a folder of photos, as they are on disk, with no import step.
 * Files stay where they are; each photo's edits, rating, flag, label and
 * virtual copies live in its sidecar, and the index mirrors them for speed.
 * Both are the index host's (indexer/): this side asks it, probes files and
 * keeps the thumbnail queue, which needs the engine.
 *
 * Thumbnails are rendered in the background engine: a RAW's embedded preview
 * until it has been edited, the photo's own pixels otherwise, and the graded
 * picture (from its proxy) once it has a recipe.
 */
import { activeSteps } from '../shared/pixels'
import { t } from '../shared/i18n'
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { compile } from '../shared/compile'
import { dhashFromGrey } from '../shared/dupes'
import {
  noPreview,
  PRESERVE_ALL,
  reduceRefused,
  type ConvertRequest,
  type SourceInfo,
  type WhitePoint
} from '../shared/engine-types'
import { previewPlan, type PreviewPlan } from '../shared/thumbsize'
import {
  IPC,
  type CameraProfileAdded,
  type CameraProfileChoices,
  type HdrKind,
  type LibraryItem,
  type LibrarySource,
  type Snapshot,
  type SourceListing
} from '../shared/ipc'
import { orientedFrame } from '../shared/compile'
import { defaultRecipe, hash32, isEdited, newId, type Recipe } from '../shared/recipe'
import type { VersionReason } from '../shared/versions'
import {
  asShotFor,
  dcpIdOf,
  dcpOf,
  defaultRawColour,
  effectiveInfo,
  exposureOffsetOf,
  parseRawColour,
  profileFits,
  profileLabel,
  rawColourLabel,
  readProfile,
  registerDcp,
  resolveRawColour,
  upgradesToPixl,
  type RawColour
} from '../shared/rawcolour'
import { whiteXy } from '../shared/wb'
import { NotAProfile, type CameraProfiles } from './cameraprofiles'
import { EngineError, type EngineClient } from './engine/client'
import { fillNoiseBook } from './ai/noisefill'
import type { PhotoRow } from './db'
import type { IndexClient } from './indexer/client'
import type { PlaneStore } from './planestore'
import { brushPlanes } from './brushes'
import { lutsFor } from './lutfile'
import { cacheFile } from './contain'
import { keyOf } from './keys'
import { paths } from './paths'
import { pixelDeps } from './pixels/base'
import { ensureWorking } from './pixels/working'
import { editsHdr, ensureHdrSource } from './hdrsource'
import { ensureProxies, ensureThumbSource } from './proxy'
import { pngToFloats } from './pngio'
import { cacheUrl } from './protocol'
import {
  BACKGROUND_THREADS,
  blankRequest,
  cellFactor,
  colourOf,
  displayPolicy,
  isLinearRaw,
  profileWhiteRequest,
  seedOf,
  sourceOrientation,
  versionStamp
} from './source'

export { keyOf, parseKey } from './keys'

export const THUMB_EDGE = 400
/** The picture Gemma names: the guide's "Playroom's 1024 px JPEG". */
export const NAMING_EDGE = 1024
/** The most photos whose proxies are made ahead at once (see `warm`). */
const WARM_MAX = 3

/** A file's version: its path, size and modification time. */
const versionOf = (row: PhotoRow): string => `${row.path}:${row.mtime}:${row.size}`

/** What kind of HDR a probe says a file is, or '' for none. */
export function hdrKindOf(info: SourceInfo): HdrKind | '' {
  if (info.gain_map) return 'gainmap'
  if (!info.is_hdr) return ''
  return /HLG/i.test(info.color) ? 'hlg' : 'pq'
}

interface ThumbJob {
  photoId: number
  copyId: string | null
}

/**
 * A picture Develop already rendered of the recipe just saved (its settled
 * JPEG, Display P3): the thumbnail is made by shrinking it, not by grading
 * the photo again on the background engine.
 */
export interface Picture {
  path: string
  width: number
  height: number
}

export class Library {
  private probes = new Map<string, SourceInfo>()
  private probing = new Map<string, Promise<SourceInfo>>()
  /** JPEGs being rebuilt from a project's JPEG XL repack, by where they go. */
  private rebuilding = new Map<string, Promise<void>>()
  private queue: ThumbJob[] = []
  /** Keys waiting in the queue. */
  private queued = new Set<string>()
  /** Keys rendering now, and those changed since theirs began (rendered again after). */
  private rendering = new Set<string>()
  private stale = new Set<string>()
  /** Who waits for a key's thumbnail: told when a render of it ends. */
  private waiting = new Map<string, (() => void)[]>()
  private running = 0
  /** The duplicate search hashing pictures now, if any. */
  private dupes: AbortController | null = null

  /** What edited photos looked like before engine 0.17: the first-open comparison. */

  constructor(
    readonly index: IndexClient,
    private readonly engine: EngineClient,
    /** Painted planes: the index hands recipes out and takes them in by reference. */
    readonly planes: PlaneStore,
    /** DNG camera profiles kept and found (engine 0.21, E21): what a `dcp:<id>` colour names. */
    readonly profiles: CameraProfiles | null = null
  ) {
    index.on((e) => {
      if (e.name === 'changed') this.broadcast(IPC.library.changed, { folder: e.folder })
      else if (e.name === 'sources') this.broadcast(IPC.library.sourcesChanged, null)
    })
  }

  /**
   * Thumbnails still to make: the safe-shutdown rest keeps the background
   * engine for them (rest.ts), as for an export, so a folder opened just
   * before Playroom goes behind finishes once, rather than the host being
   * let go between two thumbnails and started again for the next (Pass 116:
   * that churn made a 259-RAW folder take minutes instead of a minute).
   */
  get busy(): boolean {
    return this.running > 0 || this.queue.length > 0
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  /**
   * A photo's probe, cached per file version: in memory, and on disk beside
   * its proxies so a photo opened again (another day) does not ask the
   * engine. `engine`: the one to ask when it must (opening a photo asks the
   * interactive one, not the background one busy with thumbnails).
   */
  async probe(photo: PhotoRow, engine: EngineClient = this.engine): Promise<SourceInfo> {
    return this.withColour(photo, await this.engineProbe(photo, engine))
  }

  /** Photos whose camera colour is being chosen now, so two probes choose it once. */
  private adopting = new Map<number, Promise<RawColour>>()

  /**
   * A RAW's probe as the app reads it: its camera colour recorded the first
   * time it is wanted (PIXL's where the database holds the body, else the
   * file's own), `photo.raw_colour` set on the caller's row (every cache's
   * name, `versionStamp`, reads it), and the as-shot white the one that
   * colour develops with (`effectiveInfo`). The first time, the photo's
   * saved absolute white balances move with the white so the picture keeps
   * its look; the colour is written before anything is made from it.
   */
  private async withColour(photo: PhotoRow, info: SourceInfo): Promise<SourceInfo> {
    if (photo.is_raw !== 1) return info
    await this.knowProfile(photo.raw_colour)
    if (!parseRawColour(photo.raw_colour)) {
      let p = this.adopting.get(photo.id)
      if (!p) {
        p = this.adoptColour(photo.id, info).finally(() => this.adopting.delete(photo.id))
        this.adopting.set(photo.id, p)
      }
      photo.raw_colour = await p
    } else if (upgradesToPixl(photo.raw_colour, photo.raw_colour_chosen === 1, info)) {
      // A default from before PIXL's database held this body: PIXL's colour
      // now, its whites carried as a first probe would (once; never a chosen one).
      let p = this.adopting.get(photo.id)
      if (!p) {
        p = this.upgradeColour(photo.id, info).finally(() => this.adopting.delete(photo.id))
        this.adopting.set(photo.id, p)
      }
      photo.raw_colour = await p
    }
    const colour = resolveRawColour(photo.raw_colour, info)
    if (!dcpIdOf(colour)) return effectiveInfo(info, colour)
    const white = await this.asShot(photo, info, colour)
    return white === info.as_shot_white ? info : { ...info, as_shot_white: white }
  }

  /**
   * A camera profile a photo's colour names, made known for the develop: one
   * its sidecar or project carried in (from another machine) is read from
   * the index, and kept here too.
   */
  private async knowProfile(colour: string | null | undefined): Promise<void> {
    const id = dcpIdOf(colour)
    if (!id || dcpOf(id)) return
    const profile = readProfile(await this.index.cameraProfile(id).catch(() => null))
    if (!profile) return
    registerDcp(id, profile)
    await this.profiles?.keep(id, profile).catch(() => undefined)
  }

  /** As-shot whites under a camera profile, by photo version and profile. */
  private dcpWhites = new Map<string, Promise<WhitePoint | null>>()

  /**
   * The white a colour's develop balances for (where a temperature and tint
   * start). Under a camera profile it is the one the profile's matrices find
   * for the file's as-shot neutral: the engine's own, read off a small binned
   * develop once per photo version and profile (kept beside its proxies).
   * Anything else, and a linear DNG (its matrices are the profile's but its
   * white is the file's), as `asShotFor` says.
   */
  private async asShot(row: PhotoRow, info: SourceInfo, c: RawColour): Promise<WhitePoint | null> {
    if (!dcpIdOf(c) || !dcpOf(c) || isLinearRaw(info)) return asShotFor(info, c)
    const k = `${versionOf(row)}:${c}`
    let p = this.dcpWhites.get(k)
    if (!p) {
      // Not measured: the file's white for this run (not a failed develop
      // again at every probe).
      p = this.measureWhite(row, info, c, k).catch((err) => {
        log.info('camera profile white not measured', row.id, (err as Error).message)
        return info.as_shot_white
      })
      this.dcpWhites.set(k, p)
    }
    return p
  }

  private async measureWhite(
    row: PhotoRow,
    info: SourceInfo,
    c: RawColour,
    k: string
  ): Promise<WhitePoint | null> {
    const file = join(paths.photoCachePath(row.id), `white-${hash32(k).toString(16)}.json`)
    try {
      return JSON.parse(await readFile(file, 'utf8')) as WhitePoint
    } catch {
      // not measured yet
    }
    const report = await this.engine.convert(
      profileWhiteRequest(row.path, info, c, cellFactor(row))
    )
    const kelvin = report.raw?.white_temperature_kelvin
    const tint = report.raw?.white_tint
    if (typeof kelvin !== 'number' || typeof tint !== 'number') return info.as_shot_white
    const [x, y] = whiteXy(kelvin, tint)
    const white: WhitePoint = { x, y, temperature_kelvin: kelvin, tint }
    await mkdir(paths.photoCachePath(row.id), { recursive: true })
    await writeFile(file, JSON.stringify(white)).catch(() => undefined)
    return white
  }

  /** A default `container` moved to PIXL's colour (`upgradesToPixl`): recorded, whites carried. */
  private async upgradeColour(photoId: number, info: SourceInfo): Promise<RawColour> {
    await this.index.setRawColour(photoId, 'pixl:1')
    await this.index.carryWhite(
      photoId,
      { isRaw: true, asShot: asShotFor(info, 'container') },
      { isRaw: true, asShot: asShotFor(info, 'pixl:1') },
      t('Camera colour: {{colour}}', { colour: rawColourLabel(info, 'pixl:1') })
    )
    this.queueThumb(photoId, null, true)
    log.info('camera colour moved to PIXL’s (its body is in the database now)', photoId)
    return 'pixl:1'
  }

  private async adoptColour(photoId: number, info: SourceInfo): Promise<RawColour> {
    const colour = defaultRawColour(info)
    await this.index.setRawColour(photoId, colour)
    if (colour !== 'container')
      await this.index.carryWhite(
        photoId,
        { isRaw: true, asShot: asShotFor(info, 'container') },
        { isRaw: true, asShot: asShotFor(info, colour) },
        t('Camera colour: {{colour}}', { colour: rawColourLabel(info, colour) })
      )
    return colour
  }

  /**
   * The person's choice of camera colour for a RAW: recorded (in its sidecar
   * or project too), its saved white balances carried to the new as-shot
   * white, and the caches that name the colour made again on the next use.
   * Returns the colour now in force. Nothing is changed for a body PIXL's
   * database lacks.
   */
  async setRawColour(key: string, colour: RawColour): Promise<RawColour> {
    const row = await this.photoRow(key)
    if (row.is_raw !== 1) throw new Error(t('only a RAW has a camera colour'))
    const info = await this.engineProbe(row, this.engine)
    await this.knowProfile(row.raw_colour)
    const to = resolveRawColour(colour, info)
    const from = resolveRawColour(row.raw_colour, info)
    if (to === from && parseRawColour(row.raw_colour)) return to
    // A camera profile goes into the index first: the photo's sidecar or
    // project carries it with the colour that names it.
    const id = dcpIdOf(to)
    const profile = dcpOf(to)
    if (id && profile) await this.index.setCameraProfile(id, JSON.stringify(profile))
    await this.index.setRawColour(row.id, to, true)
    await this.index.carryWhite(
      row.id,
      { isRaw: true, asShot: await this.asShot(row, info, from) },
      { isRaw: true, asShot: await this.asShot(row, info, to) },
      t('Camera colour: {{colour}}', { colour: rawColourLabel(info, to) })
    )
    // Its thumbnail's stamp names the colour: made again.
    this.queueThumb(row.id, null, true)
    return to
  }

  /**
   * The DNG camera profiles a RAW's colour can be (engine 0.21, E21): those
   * kept for its body, and Adobe's for it that are not kept yet.
   */
  async cameraProfiles(key: string): Promise<CameraProfileChoices> {
    const row = await this.photoRow(key)
    if (row.is_raw !== 1 || !this.profiles) return { kept: [], adobe: [] }
    const info = await this.engineProbe(row, this.engine)
    return {
      kept: this.profiles
        .forCamera(info)
        .map((k) => ({ colour: `dcp:${k.id}` as const, name: profileLabel(k.profile) })),
      adobe: await this.profiles.adobe(info)
    }
  }

  /**
   * A `.dcp` imported for a RAW (the person's file, or one of Adobe's found
   * for it): kept as the engine reads it, never by its path. Whether it is
   * for this photo's body is said; one that is not is kept, but offered only
   * for its own camera. The engine refuses a file that is not a profile.
   */
  async addCameraProfile(
    key: string,
    path: string,
    from: 'chosen' | 'adobe' = 'chosen'
  ): Promise<CameraProfileAdded> {
    if (!this.profiles) throw new Error(t('Camera profiles are not available'))
    // A path the renderer names is only ever one of Adobe's it was offered.
    if (from === 'adobe' && !(await this.profiles.isAdobe(path)))
      throw new Error(
        t('{{name}} is not a DNG camera profile Playroom can read.', { name: basename(path) })
      )
    const row = await this.photoRow(key)
    const info = await this.engineProbe(row, this.engine)
    let kept
    try {
      kept = await this.profiles.import(path)
    } catch (err) {
      if (
        (err instanceof EngineError && err.code === 'InvalidRequest') ||
        err instanceof NotAProfile
      )
        throw new Error(
          t('{{name}} is not a DNG camera profile Playroom can read.', { name: basename(path) })
        )
      throw err
    }
    return {
      colour: `dcp:${kept.id}`,
      name: profileLabel(kept.profile),
      fits: profileFits(kept.profile, info),
      camera: kept.profile.unique_camera_model
    }
  }

  private async engineProbe(photo: PhotoRow, engine: EngineClient): Promise<SourceInfo> {
    const k = versionOf(photo)
    const hit = this.probes.get(k)
    if (hit) return hit
    let p = this.probing.get(k)
    if (!p) {
      p = this.probeOnce(photo, k, engine).finally(() => this.probing.delete(k))
      this.probing.set(k, p)
    }
    return p
  }

  private async probeOnce(photo: PhotoRow, k: string, engine: EngineClient): Promise<SourceInfo> {
    // Per app version and per engine build too (a development run's engine
    // shares the app's version): a newer engine may say more (0.21's
    // `raw_previews`). Before the engine has said which it is, it is asked.
    const file = (): string | null => {
      const status = engine.getStatus()
      const build = status.build?.commit ?? status.version
      if (!build) return null
      const name = hash32(`${k}:${app.getVersion()}:${build}`).toString(16)
      return join(paths.photoCachePath(photo.id), `probe-${name}.json`)
    }
    const known = file()
    let info: SourceInfo | null = null
    try {
      if (!known) throw new Error('the engine has not said which build it is')
      info = JSON.parse(await readFile(known, 'utf8')) as SourceInfo
    } catch {
      info = await engine.probe(photo.path)
      const to = file()
      if (to) {
        const dir = paths.photoCachePath(photo.id)
        await mkdir(dir, { recursive: true })
        await writeFile(to, JSON.stringify(info)).catch(() => undefined)
        // Those of another version or engine are not read again.
        for (const f of await readdir(dir).catch(() => [] as string[]))
          if (/^probe-[0-9a-f]+\.json$/.test(f) && join(dir, f) !== to)
            await rm(join(dir, f), { force: true }).catch(() => undefined)
      }
    }
    this.probes.set(k, info)
    // The grid's HDR badge learns what the file is.
    const kind = hdrKindOf(info)
    if (photo.hdr_key !== versionOf(photo) || (photo.hdr ?? '') !== kind) {
      void this.index.setHdr(photo.id, kind).catch(() => undefined)
      this.broadcast(IPC.library.hdr, { photoId: photo.id, hdr: kind || null })
    }
    return info
  }

  /** Photos whose HDR kind is not known yet, probed one by one in the background. */
  private hdrWork: string[] = []
  private hdrSeen = new Set<string>()
  private hdrRunning = false

  private queueHdr(items: LibraryItem[]): void {
    for (const it of items) {
      if (it.hdr !== undefined || it.offline || it.unreadable || it.copyId) continue
      if (this.hdrSeen.has(it.key)) continue
      this.hdrSeen.add(it.key)
      this.hdrWork.push(it.key)
    }
    if (this.hdrRunning) return
    this.hdrRunning = true
    void (async () => {
      while (this.hdrWork.length) {
        const key = this.hdrWork.shift()!
        try {
          await this.probe(await this.photoRow(key))
        } catch {
          // unreadable: the thumbnail says so
        }
      }
      this.hdrRunning = false
    })()
  }

  /** Photos whose proxies are to be made ahead, the newest asked for first. */
  private warming: string[] = []
  private warmRunning = false

  /**
   * Make these photos' proxies ahead, on the background engine (behind any
   * preview being rendered): the photos either side of the open one, so
   * stepping to the next opens at once. Asking again replaces what has not
   * started; one is made at a time.
   */
  warm(keys: string[]): void {
    this.warming = keys.slice(0, WARM_MAX)
    if (this.warmRunning) return
    this.warmRunning = true
    void (async () => {
      while (this.warming.length > 0) {
        const key = this.warming.shift()!
        try {
          const row = await this.readable(await this.photoRow(key))
          await ensureProxies(this.engine, row, await this.probe(row), BACKGROUND_THREADS)
        } catch (err) {
          // Not readable, or gone: its own open will say so.
          log.info('proxies not made ahead for', key, (err as Error).message)
        }
      }
      this.warmRunning = false
    })()
  }

  /** A folder's items as the index has them; its thumbnails are queued. */
  async openFolder(folder: string): Promise<LibraryItem[]> {
    const items = await this.index.listFolder(folder)
    for (const it of items) this.queueThumb(it.photoId, it.copyId)
    this.queueHdr(items)
    return items
  }

  /**
   * Any source's items (a collection's come from many folders); thumbnails
   * are queued for those that are there. Thumbnails belong to photos, not
   * folders, so one rendered for a folder serves every collection too.
   */
  async openSource(src: LibrarySource): Promise<SourceListing> {
    // Another source opened: a duplicate search still hashing is not wanted now.
    if (src.kind !== 'duplicates') this.dupes?.abort()
    const listing =
      src.kind === 'duplicates'
        ? await this.duplicates(src.folder, src.threshold)
        : await this.index.listSource(src)
    for (const it of listing.items) if (!it.offline) this.queueThumb(it.photoId, it.copyId)
    this.queueHdr(listing.items)
    return listing
  }

  /**
   * Exact and near duplicates in a folder or the whole library. Near ones
   * need each photo's picture hash, made here from its thumbnail (rendered
   * first where there is none) since this side has the engine.
   */
  async duplicates(folder: string | null, threshold = 6): Promise<SourceListing> {
    // One search at a time: a new one (or another source opened) stops the last.
    this.dupes?.abort()
    const abort = new AbortController()
    this.dupes = abort
    const work = await this.index.dhashWork(folder)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < work.length && !abort.signal.aborted) {
        const w = work[next++]
        try {
          await this.hashPicture(w.photoId, w.thumbPath)
        } catch (err) {
          const message = (err as Error)?.message ?? String(err)
          log.warn('picture hash failed', w.photoId, message)
          void this.index.markFailed(w.photoId, message).catch(() => {})
        }
      }
    }
    // Two at a time, as the thumbnail queue runs.
    await Promise.all([worker(), worker()])
    if (this.dupes === abort) this.dupes = null
    // Stopped: what was hashed is kept, and the rest waits for the next search.
    return this.index.duplicates(folder, threshold)
  }

  /** A photo's 64-bit dHash, of its thumbnail shrunk to 9×8 by the engine. */
  private async hashPicture(photoId: number, thumbPath: string | null): Promise<void> {
    if (!thumbPath) await this.thumbFor(photoId, null)
    const row = await this.index.row(keyOf(photoId, null))
    if (!row.thumb_path || !row.thumb_key || !existsSync(row.thumb_path)) return
    const report = await this.engine.convert({
      ...blankRequest(row.thumb_path, '', 'Jpeg'),
      sink: 'Bytes',
      resize: { Exact: { width: 9, height: 8 } },
      resampler: 'Bilinear',
      pixel: { depth: 'Eight', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'NoFilter' } },
      threads: 1
    })
    if (!report.output) throw new Error('the engine returned no pixels')
    const px = pngToFloats(Buffer.from(report.output))
    const grey = new Uint8Array(px.width * px.height)
    for (let i = 0; i < grey.length; i++) {
      const o = i * px.channels
      const y =
        px.channels >= 3
          ? 0.299 * px.data[o] + 0.587 * px.data[o + 1] + 0.114 * px.data[o + 2]
          : px.data[o]
      grey[i] = Math.round(y * 255)
    }
    await this.index.setDhash(row.id, dhashFromGrey(grey, px.width, px.height), row.thumb_key)
  }

  item(key: string): Promise<LibraryItem | undefined> {
    return this.index.item(key)
  }

  /** The photo's row, its path a file that can be read (see `readable`). */
  async photoRow(key: string): Promise<PhotoRow> {
    return this.readable(await this.index.sourceRow(key))
  }

  /**
   * A row (from `sourceRow`, `openData` or `thumbJob`) whose path is a file
   * the engine can read: the photo itself, or, when it is gone, the copy its
   * project carries. A JPEG the project keeps repacked into JPEG XL is
   * rebuilt into the very JPEG it was, byte for byte, once.
   */
  async readable(row: PhotoRow): Promise<PhotoRow> {
    const e = row.embedded
    if (e === undefined) return row
    if (e === null)
      throw new Error(
        t('{{name}} is missing, and its project does not carry a copy of it yet', {
          name: row.name
        })
      )
    if (e.codec !== 'jxl-jpeg') return { ...row, path: e.path }
    const jpg = e.path.replace(/\.jxl$/i, '.jpg')
    if (!existsSync(jpg)) {
      let made = this.rebuilding.get(jpg)
      if (!made) {
        made = this.engine
          .convert({
            ...blankRequest(e.path, jpg, 'Jxl'),
            encode: 'JpegFromJxl',
            metadata: PRESERVE_ALL
          })
          .then(() => undefined)
          .finally(() => this.rebuilding.delete(jpg))
        this.rebuilding.set(jpg, made)
      }
      await made
    }
    return { ...row, path: jpg }
  }

  /** A key's saved recipe, its planes filled in. */
  async recipe(key: string): Promise<Recipe> {
    return this.planes.hydrate(await this.index.recipe(key))
  }

  /**
   * A Version of a photo (shared/versions.ts): named (the user's), or
   * automatic, made only when the photo has an edit to keep. Its planes go
   * by reference. Returns the photo's versions after (null: none made).
   */
  async addVersion(
    key: string,
    v: { name: string; recipe: Recipe; kind?: 'named' | 'auto'; reason?: VersionReason }
  ): Promise<Snapshot[] | null> {
    const kind = v.kind ?? 'named'
    if (kind === 'auto') {
      const row = await this.index.sourceRow(key)
      if (!isEdited(v.recipe, row.is_raw === 1)) return null
    }
    try {
      return await this.index.addVersion(key, {
        id: newId(),
        name: v.name,
        at: new Date().toISOString(),
        kind,
        ...(v.reason ? { reason: v.reason } : {}),
        recipe: this.planes.slim(v.recipe)
      })
    } catch (err) {
      // An automatic version never stops what it was made before.
      if (kind === 'named') throw err
      log.warn('automatic version not kept', key, (err as Error).message)
      return null
    }
  }

  /** Save a key's recipe; its planes cross by reference. */
  saveRecipe(key: string, recipe: Recipe): Promise<void> {
    return this.index.saveRecipe(key, this.planes.slim(recipe))
  }

  // ── thumbnails ──

  /** Pictures offered for the next thumbnail of a key (see `Picture`). */
  private readonly pictures = new Map<string, Picture>()

  queueThumb(photoId: number, copyId: string | null, urgent = false, picture?: Picture): void {
    const k = keyOf(photoId, copyId)
    // Only a picture of what is saved now: one queued without says the recipe moved on.
    if (picture) this.pictures.set(k, picture)
    else this.pictures.delete(k)
    // One rendering now may be of the recipe before this change: it goes again after.
    if (this.rendering.has(k)) {
      this.stale.add(k)
      return
    }
    if (this.queued.has(k)) {
      if (urgent) this.prioritize([k])
      return
    }
    this.queued.add(k)
    if (urgent) this.queue.unshift({ photoId, copyId })
    else this.queue.push({ photoId, copyId })
    this.pump()
  }

  /** A key's thumbnail, rendered through the queue (never beside it); resolves when it is current. */
  private thumbFor(photoId: number, copyId: string | null): Promise<void> {
    const k = keyOf(photoId, copyId)
    return new Promise((resolve) => {
      this.waiting.set(k, [...(this.waiting.get(k) ?? []), resolve])
      this.queueThumb(photoId, copyId, true)
    })
  }

  /** Move these keys' waiting thumbnails to the front of the queue. */

  prioritize(keys: string[]): void {
    const want = new Set(keys)
    const first = this.queue.filter((j) => want.has(keyOf(j.photoId, j.copyId)))
    if (first.length === 0) return
    this.queue = [...first, ...this.queue.filter((j) => !want.has(keyOf(j.photoId, j.copyId)))]
  }

  private pump(): void {
    while (this.running < 2 && this.queue.length > 0) {
      const job = this.queue.shift() as ThumbJob
      const k = keyOf(job.photoId, job.copyId)
      this.queued.delete(k)
      this.rendering.add(k)
      this.running++
      this.thumb(job)
        .catch((err) => {
          log.warn('thumbnail failed', job, err?.message ?? err)
          // Only the engine failing to read the file says the photo is
          // unreadable (once per version of it: not tried again until it
          // changes). Anything else (the index stopping at quit, a plane not
          // found) leaves it to be tried another time.
          if (!(err instanceof EngineError) || err.cancelled) return
          void this.index.markFailed(job.photoId, err.userMessage).catch(() => {})
          this.broadcast(IPC.library.thumb, {
            key: keyOf(job.photoId, job.copyId),
            url: null,
            unreadable: true
          })
        })
        .finally(() => {
          this.running--
          this.rendering.delete(k)
          if (this.stale.delete(k)) this.queueThumb(job.photoId, job.copyId, true)
          else {
            for (const done of this.waiting.get(k) ?? []) done()
            this.waiting.delete(k)
          }
          this.pump()
        })
    }
  }

  private async thumb(job: ThumbJob): Promise<void> {
    const picture = this.pictures.get(keyOf(job.photoId, job.copyId))
    this.pictures.delete(keyOf(job.photoId, job.copyId))
    let work = await this.index.thumbJob(job.photoId, job.copyId)
    if (!work) return
    // A RAW's camera colour is chosen the first time it is probed and names
    // what is made from it, its thumbnail's stamp too: take the work again
    // with the colour recorded.
    if (work.row.is_raw === 1 && !work.row.raw_colour) {
      await this.probe(await this.readable(work.row))
      work = await this.index.thumbJob(job.photoId, job.copyId)
      if (!work) return
    }
    const { edited, stamp } = work
    const recipe = await this.planes.hydrate(work.recipe)
    const row = await this.readable(work.row)
    const key = keyOf(row.id, job.copyId)
    const info = await this.probe(row)
    // The first RAW of a camera and ISO: its noise read into the book (E65).
    if (row.is_raw === 1) void fillNoiseBook(this.engine, row, info)
    const out = cacheFile(
      paths.thumbs(),
      `${row.id}${job.copyId ? '-' + job.copyId : ''}-${hash32(stamp).toString(16)}.jpg`
    )
    const base = {
      encode: { Jpeg: { quality: 85, subsampling: 'Quarter' as const, optimize: true } },
      pixel: { depth: 'Eight' as const, channels: 3 },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      threads: BACKGROUND_THREADS,
      color: displayPolicy(info, 'Srgb')
    }
    if (!edited) {
      // The quickest honest picture: a RAW's embedded preview, anything else
      // its own pixels, upright and small.
      await this.unedited(row, info, THUMB_EDGE, out, base, recipe)
    } else if (!picture || !(await this.shrunk(picture, out, base))) {
      await this.graded(row, info, recipe, out, base)
    }
    await this.index.setThumb(row.id, job.copyId, out, stamp)
    this.broadcast(IPC.library.thumb, { key, url: cacheUrl(out, stamp) })
  }

  /**
   * The photo as Gemma is shown it (shared/naming.ts): unedited (names are
   * of what is in it, not of an edit), NAMING_EDGE on its long side.
   */
  async namingPicture(photoId: number): Promise<Buffer> {
    const out = join(paths.cacheRoot(), `naming-${process.pid}-${photoId}.jpg`)
    try {
      await this.writeUnedited(photoId, NAMING_EDGE, out)
      return await readFile(out)
    } finally {
      await rm(out, { force: true })
    }
  }

  /**
   * The photo unedited, upright and sRGB, at most `edge` on its long side,
   * as a JPEG at `out`: what is measured or named of it (Gemma's names, the
   * cull signals), never an edit. A RAW's embedded preview, anything else
   * its own pixels; a RAW with no usable preview is developed plainly at
   * thumbnail size.
   */
  async writeUnedited(photoId: number, edge: number, out: string): Promise<void> {
    const row = await this.readable(await this.index.row(keyOf(photoId, null)))
    const info = await this.probe(row)
    const base = {
      encode: { Jpeg: { quality: 90, subsampling: 'Quarter' as const, optimize: false } },
      pixel: { depth: 'Eight' as const, channels: 3 },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      threads: BACKGROUND_THREADS,
      color: displayPolicy(info, 'Srgb')
    }
    await this.unedited(row, info, edge, out, base, defaultRecipe(true))
  }

  /**
   * An unedited RAW's first look while it opens (engine 0.21, OBS-1d): its
   * embedded preview at about the stage's size (`edge`, device pixels),
   * Display P3 as the develop's pictures are, so the photo shows at once and
   * its develop fades in over it. Null for an edited photo (the camera's
   * rendering would read as the edit: the renderer shows its thumbnail), for
   * anything that is not a RAW, and for a RAW with no preview to decode or
   * one no bigger than its thumbnail.
   * `engine`: the interactive one, beside the open's own work.
   */
  async firstLook(
    key: string,
    edge: number,
    engine: EngineClient = this.engine
  ): Promise<{ url: string; width: number; height: number } | null> {
    const item = await this.index.item(key)
    if (!item || item.edited || !item.isRaw) return null
    const row = await this.photoRow(key)
    if (row.is_raw !== 1) return null
    const info = await this.probe(row, engine)
    // The renderer's number, held to a sane size before it names a file.
    const side = Number.isFinite(edge) ? Math.max(256, Math.min(8192, Math.round(edge))) : 2560
    const plan = previewPlan(info, true, side)
    // A preview no bigger than the thumbnail (an older body's, a DNG's
    // small one) adds nothing to the thumbnail already showing.
    if (plan === 'develop' || plan.long <= THUMB_EDGE) return null
    // Swept with the photo's other renders as it leaves Develop (sweep.ts).
    const dir = join(paths.photoCache(row.id), 'renders')
    await mkdir(dir, { recursive: true })
    const stamp = `${versionOf(row)}:${side}`
    const out = join(dir, `first-${hash32(stamp).toString(16)}.jpg`)
    const request = (reduce: PreviewPlan['reduce'], factor: number): ConvertRequest => ({
      ...blankRequest(row.path, out, info.input, info),
      raw: 'EmbeddedPreview',
      decode_reduce: reduce,
      resize: factor < 1 ? { Scale: { factor } } : 'None',
      encode: { Jpeg: { quality: 90, subsampling: 'Quarter', optimize: false } },
      pixel: { depth: 'Eight', channels: 3 },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: displayPolicy(info, 'DisplayP3')
    })
    const report = await engine.convert(request(plan.reduce, plan.factor)).catch((err) => {
      if (!(err instanceof EngineError) || !plan.reduce || !reduceRefused(err.code, err.detail))
        throw err
      return engine.convert(request(null, Math.min(1, side / plan.long)))
    })
    return { url: cacheUrl(out, stamp), width: report.width, height: report.height }
  }

  /**
   * The photo unedited at most `edge` on its long side (`previewPlan`): a
   * RAW's embedded preview sized from the preview, a JPEG decoded at a
   * fraction of its size where that still leaves the edge. Only a RAW with
   * no preview the engine can decode is developed instead (graded with
   * `recipe`); any other refusal is the photo's.
   */
  private async unedited(
    row: PhotoRow,
    info: SourceInfo,
    edge: number,
    out: string,
    base: Record<string, unknown>,
    recipe: Recipe
  ): Promise<void> {
    const raw = row.is_raw === 1
    const plan = previewPlan(info, raw, edge)
    if (plan === 'develop') return this.graded(row, info, recipe, out, base)
    const rawMode = raw ? ('EmbeddedPreview' as const) : null
    const orientation = sourceOrientation(info, rawMode)
    const convert = ({ reduce, factor }: PreviewPlan): ReturnType<EngineClient['convert']> =>
      this.engine.convert({
        ...blankRequest(row.path, out, info.input, info),
        ...base,
        raw: rawMode,
        decode_reduce: reduce,
        resize: factor < 1 ? { Scale: { factor } } : 'None',
        framing:
          orientation === 'Normal'
            ? null
            : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null }
      })
    try {
      await convert(plan).catch((err) => {
        // A JPEG the scaled decode cannot read (a lossless one): whole, then.
        if (!(err instanceof EngineError) || !plan.reduce || !reduceRefused(err.code, err.detail))
          throw err
        return convert({ reduce: null, long: plan.long, factor: Math.min(1, edge / plan.long) })
      })
    } catch (err) {
      if (!raw || !(err instanceof EngineError) || !noPreview(err.code, err.detail)) throw err
      // No usable embedded preview after all: develop instead.
      await this.graded(row, info, recipe, out, base)
    }
  }

  /**
   * A thumbnail shrunk from a picture Develop rendered (Display P3, so turned
   * into sRGB on the way): its settled JPEG, or in Full HDR its SDR companion
   * (a PNG), so the thumbnail is the picture as it was shown. False when it could not be (the picture already
   * replaced by a newer one): the caller grades the photo instead.
   */
  private async shrunk(
    picture: Picture,
    out: string,
    base: Record<string, unknown>
  ): Promise<boolean> {
    if (!existsSync(picture.path)) return false
    const factor = Math.min(1, THUMB_EDGE / Math.max(picture.width, picture.height, 1))
    try {
      await this.engine.convert({
        ...blankRequest(picture.path, out, picture.path.endsWith('.png') ? 'Png' : 'Jpeg'),
        ...base,
        color: {
          ConvertTo: { to: 'Srgb', intent: 'RelativeColorimetric', black_point_compensation: false }
        },
        resize: factor < 1 ? { Scale: { factor } } : 'None'
      })
      return true
    } catch (err) {
      log.info('thumbnail not shrunk from the develop picture', (err as Error).message)
      return false
    }
  }

  /**
   * A thumbnail of the graded picture, from the photo's draft proxy — a
   * quarter of the proxy's pixels, and still more than a thumbnail needs —
   * or the proxy when a tight crop leaves the draft too few.
   */
  private async graded(
    row: PhotoRow,
    file: SourceInfo,
    recipe: Recipe,
    out: string,
    base: Record<string, unknown>
  ): Promise<void> {
    // A gain-map photo edited as HDR: its applied rendition, tone mapped.
    const hdr = editsHdr(recipe, file) ? await ensureHdrSource(this.engine, row, file) : null
    const info = hdr?.info ?? file
    if (hdr) base = { ...base, color: displayPolicy(info, 'Srgb') }
    // Pixel steps (an AI denoise) laid on: made from what the project keeps,
    // never by running a model.
    // A RAW without proxies yet: a binned develop (proxy.ts). Its pixel steps,
    // though, are laid on the proxies, which the editor then finds made.
    const plain =
      hdr?.px ??
      (activeSteps(recipe.pixels).length > 0
        ? await ensureProxies(this.engine, row, info, BACKGROUND_THREADS)
        : await ensureThumbSource(this.engine, row, info, BACKGROUND_THREADS))
    const px =
      !hdr && activeSteps(recipe.pixels).length > 0
        ? (
            await ensureWorking(
              pixelDeps(this.engine, this.index, row),
              versionStamp(row),
              plain,
              activeSteps(recipe.pixels),
              null
            )
          ).px
        : plain
    const { user, width, height } = orientedFrame(recipe, px.frameWidth, px.frameHeight)
    const cropOf = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      exposureOffset: exposureOffsetOf(colourOf(row)),
      sourceOrientation: 'Normal',
      frameWidth: px.frameWidth,
      frameHeight: px.frameHeight,
      scale: 1,
      seed: 0,
      brushPaths: {},
      applyCrop: true
    }).crop
    const cropLong = Math.max((cropOf?.width ?? 1) * width, (cropOf?.height ?? 1) * height)
    const src = cropLong * (px.draft.width / px.frameWidth) >= THUMB_EDGE ? px.draft : px.proxy
    const compiled = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      exposureOffset: exposureOffsetOf(colourOf(row)),
      sourceOrientation: 'Normal',
      frameWidth: px.frameWidth,
      frameHeight: px.frameHeight,
      scale: src.width / px.frameWidth,
      seed: seedOf(row),
      brushPaths: await brushPlanes(row.id, recipe, user),
      luts: await lutsFor(recipe, paths.luts()),
      applyCrop: true,
      hdr: info.is_hdr
    })
    const cropW = (compiled.crop?.width ?? 1) * width
    const cropH = (compiled.crop?.height ?? 1) * height
    const factor = Math.min(1, THUMB_EDGE / (Math.max(cropW, cropH) * (src.width / px.frameWidth)))
    await this.engine.convert({
      ...blankRequest(src.path, out, src.input),
      ...base,
      resize: factor < 1 ? { Scale: { factor } } : 'None',
      grade: compiled.grade,
      framing: compiled.framing,
      lens: compiled.lens,
      retouch: compiled.retouch
    })
  }
}
