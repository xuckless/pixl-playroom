/**
 * The Library's larger pictures (shared/previews.ts): the screen preview the
 * Loupe, Compare and Survey show, and the 1:1 that Z zooms to, never through
 * a Develop session. This side names them, keeps them in the previews folder
 * under its cap (the least recently shown go first) and decides which engine
 * makes them when:
 *
 * - the photo shown, unedited: at once, on the interactive engine (an
 *   embedded preview or a JPEG decodes in a fraction of a second);
 * - the photos either side (`warm`, asked again as the view moves on, what
 *   has not started dropped): unedited ones on the background engine;
 * - an edited photo's: graded from its proxies (seconds of work each), one
 *   at a time on the background engine, the one shown first, behind any
 *   thumbnail, so a busy library never starves the AI or the grid.
 */
import log from 'electron-log/main'
import { readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { t } from '../shared/i18n'
import type { FocusPicture, FocusTile, LibraryPreview, PreviewCacheState } from '../shared/ipc'
import {
  DEFAULT_PREVIEW_CAP,
  evictions,
  PREVIEW_EDGE,
  type CachedPreview
} from '../shared/previews'
import { hash32 } from '../shared/recipe'
import type { EngineClient } from './engine/client'
import { exists } from './exists'
import type { IndexClient } from './indexer/client'
import type { ThumbWork } from './indexer/service'
import { parseKey } from './keys'
import { hdrKindOf, type Library, type RegionSetup } from './library'
import { paths } from './paths'
import { cacheUrl } from './protocol'
import { BACKGROUND_THREADS, interactiveThreads } from './source'

/** A graded preview dropped before it started (the view moved on): asked for again when shown. */
export const PREVIEW_DROPPED = 'preview dropped: no longer shown'

/** Where the cap is kept (the index's settings). */
export const PREVIEW_CAP_SETTING = 'library.previewCap'
/** The smallest cap Settings takes: a few hundred photos' previews. */
const LEAST_CAP = 256 * 1024 ** 2
/** How many photos' previews are made ahead at once. */
const WARM_MAX = 4
/** The pictures shown last, never evicted under them. */
const SHOWN_KEEP = 8
/** How many photos' region set-ups are kept (the shown one, Compare's two, a step either side). */
const SETUPS_KEPT = 6
/** Tile files written in turn: a few at a time are being shown. */
const TILE_SLOTS = 6

/** A picture's size and how it is shown, kept beside it. */
interface Meta {
  width: number
  height: number
  sdr: boolean
}

/** A graded preview waiting its turn on the background engine. */
interface SlowJob {
  name: string
  key: string
  run: () => Promise<void>
  fail: (err: Error) => void
}

export class Previews {
  private cap = DEFAULT_PREVIEW_CAP
  /** The folder's pictures, by name, once it has been read. */
  private files: Map<string, CachedPreview> | null = null
  private reading: Promise<Map<string, CachedPreview>> | null = null
  /** Pictures being made, by name: a second ask joins the first. */
  private making = new Map<string, Promise<LibraryPreview>>()
  private slow: SlowJob[] = []
  private slowRunning = false
  private warming: string[] = []
  private warmRunning = false
  private shown: string[] = []
  private setups = new Map<string, Promise<RegionSetup>>()
  private regions = new Map<string, AbortController>()
  private tileSeq = 0

  constructor(
    private library: Library,
    private index: IndexClient,
    /** The interactive engine: the photo shown now. */
    private engine: EngineClient,
    /** The background engine: what is made ahead, and every graded preview. */
    private bg: EngineClient
  ) {
    void index
      .getSetting(PREVIEW_CAP_SETTING)
      .then((v) => {
        if (typeof v === 'number' && Number.isFinite(v)) this.cap = Math.max(LEAST_CAP, v)
      })
      .catch(() => undefined)
  }

  /** A photo's screen preview: made now when it is not on disk (see the module's comment). */
  async screen(key: string): Promise<LibraryPreview> {
    const work = await this.work(key)
    return this.screenOf(key, work, false)
  }

  /**
   * The photos either side of those shown (`shown`): their screen previews
   * made ahead. Asking again replaces what has not started; one is made at
   * a time. A graded preview still waiting for a photo neither shown nor
   * either side is dropped: the view moved on.
   */
  warm(keys: string[], shown: string[] = []): void {
    this.warming = keys.slice(0, WARM_MAX)
    const wanted = new Set([...this.warming, ...shown])
    const kept: SlowJob[] = []
    for (const j of this.slow)
      if (wanted.has(j.key)) kept.push(j)
      else j.fail(new Error(PREVIEW_DROPPED))
    this.slow = kept
    if (this.warmRunning) return
    this.warmRunning = true
    void (async () => {
      while (this.warming.length > 0) {
        const key = this.warming.shift()!
        try {
          const work = await this.work(key)
          const made = this.screenOf(key, work, true)
          // A graded one waits its turn in the slow queue: the next is not held for it.
          if (work.edited) made.catch(() => undefined)
          else await made
        } catch (err) {
          log.info('library preview not made ahead', key, (err as Error).message)
        }
      }
      this.warmRunning = false
    })()
  }

  /** A photo's 1:1 (shared/previews.ts `focusPlan`). */
  async focus(key: string): Promise<FocusPicture> {
    const work = await this.work(key)
    const plan = await this.library.focusPlanOf(work, this.engine)
    if (plan === 'region') {
      const setup = await this.setupFor(key, work)
      return {
        kind: 'region',
        width: setup.framed.width,
        height: setup.framed.height,
        sdr: hdrKindOf(setup.info) !== ''
      }
    }
    const name = `${this.base(key)}-f${hash32(work.stamp).toString(16)}.jpg`
    const p = await this.cached(name, (out) =>
      this.library.libraryPicture(work, Infinity, out, this.engine, interactiveThreads())
    )
    return { kind: 'whole', ...p }
  }

  /**
   * A part of a photo at 1:1 (`rect`, fractions of its picture as the
   * Library shows it): a newer ask for the same photo stops this one.
   */
  async region(
    key: string,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<FocusTile> {
    const work = await this.work(key)
    const setup = await this.setupFor(key, work)
    this.regions.get(key)?.abort()
    const abort = new AbortController()
    this.regions.set(key, abort)
    const seq = ++this.tileSeq
    const out = join(paths.previewTiles(), `tile-${seq % TILE_SLOTS}.jpg`)
    try {
      const placed = await this.library.regionPicture(setup, rect, out, this.engine, abort.signal)
      return { url: cacheUrl(out, seq), ...placed }
    } finally {
      if (this.regions.get(key) === abort) this.regions.delete(key)
    }
  }

  /** The previews folder's size and cap. */
  async state(): Promise<PreviewCacheState> {
    const files = await this.read()
    let bytes = 0
    for (const f of files.values()) bytes += f.bytes
    return { bytes, cap: this.cap }
  }

  async setCap(bytes: number): Promise<PreviewCacheState> {
    if (!Number.isFinite(bytes)) throw new Error('a cap is a number of bytes')
    this.cap = Math.max(LEAST_CAP, Math.round(bytes))
    await this.index.setSetting(PREVIEW_CAP_SETTING, this.cap)
    await this.evict()
    return this.state()
  }

  /** Every preview off the disk (they are made again as they are shown). */
  async clear(): Promise<PreviewCacheState> {
    const files = await this.read()
    for (const name of [...files.keys()]) await this.remove(name)
    return this.state()
  }

  // ── making ──

  private async work(key: string): Promise<ThumbWork> {
    const { photoId, copyId } = parseKey(key)
    const work = await this.index.previewJob(photoId, copyId)
    if (!work) throw new Error(t('This file cannot be read'))
    return work
  }

  /** A photo's (or copy's) names start with its ids. */
  private base(key: string): string {
    const { photoId, copyId } = parseKey(key)
    return `${photoId}${copyId ? '-' + copyId.replace(/[^a-zA-Z0-9]/g, '') : ''}`
  }

  private screenOf(key: string, work: ThumbWork, ahead: boolean): Promise<LibraryPreview> {
    const name = `${this.base(key)}-s${hash32(`${work.stamp}:${PREVIEW_EDGE}`).toString(16)}.jpg`
    // Queued ahead and shown now: it goes first.
    if (!ahead) this.toFront(name)
    return this.cached(name, (out) =>
      work.edited
        ? this.inTurn(name, key, ahead, () =>
            this.library.libraryPicture(work, PREVIEW_EDGE, out, this.bg, BACKGROUND_THREADS)
          )
        : ahead
          ? this.library.libraryPicture(work, PREVIEW_EDGE, out, this.bg, BACKGROUND_THREADS)
          : this.library.libraryPicture(work, PREVIEW_EDGE, out, this.engine, interactiveThreads())
    )
  }

  /**
   * The picture `name` from the folder, or made by `make` (once, however
   * many ask), its size kept beside it and the folder held to its cap.
   */
  private async cached(
    name: string,
    make: (out: string) => Promise<Meta>
  ): Promise<LibraryPreview> {
    const out = join(paths.previews(), name)
    const files = await this.read()
    if (files.has(name)) {
      const meta = await readFile(`${out}.json`, 'utf8')
        .then((s) => JSON.parse(s) as Meta)
        .catch(() => null)
      if (meta && (await exists(out))) {
        this.touch(name, out)
        return { url: cacheUrl(out, name), ...meta }
      }
      files.delete(name)
    }
    let p = this.making.get(name)
    if (!p) {
      p = (async (): Promise<LibraryPreview> => {
        const meta = await make(out)
        const kept: Meta = { width: meta.width, height: meta.height, sdr: meta.sdr }
        await writeFile(`${out}.json`, JSON.stringify(kept))
        const bytes = await stat(out).then(
          (s) => s.size,
          () => 0
        )
        files.set(name, { name, bytes, used: Date.now() })
        this.noteShown(name)
        await this.evict()
        return { url: cacheUrl(out, name), ...kept }
      })().finally(() => this.making.delete(name))
      this.making.set(name, p)
    }
    return p
  }

  /** A graded preview in the slow queue: the photo shown goes before those made ahead. */
  private inTurn(
    name: string,
    key: string,
    ahead: boolean,
    make: () => Promise<Meta>
  ): Promise<Meta> {
    return new Promise<Meta>((resolve, reject) => {
      const job: SlowJob = {
        name,
        key,
        run: () => make().then(resolve, reject),
        fail: reject
      }
      if (ahead) this.slow.push(job)
      else this.slow.unshift(job)
      this.pumpSlow()
    })
  }

  /** A graded preview queued ahead, wanted now: to the front of the queue. */
  private toFront(name: string): void {
    const i = this.slow.findIndex((j) => j.name === name)
    if (i < 0) return
    const [job] = this.slow.splice(i, 1)
    this.slow.unshift(job)
  }

  private pumpSlow(): void {
    if (this.slowRunning) return
    this.slowRunning = true
    void (async () => {
      while (this.slow.length > 0) await this.slow.shift()!.run()
      this.slowRunning = false
    })()
  }

  private setupFor(key: string, work: ThumbWork): Promise<RegionSetup> {
    const id = `${key}:${work.stamp}`
    let p = this.setups.get(id)
    if (!p) {
      p = this.library.regionSetup(work, this.engine)
      p.catch(() => this.setups.delete(id))
      // The oldest goes: the newest asked for are the ones being looked at.
      if (this.setups.size >= SETUPS_KEPT) this.setups.delete(this.setups.keys().next().value!)
      this.setups.set(id, p)
    }
    return p
  }

  // ── the folder ──

  private read(): Promise<Map<string, CachedPreview>> {
    if (this.files) return Promise.resolve(this.files)
    this.reading ??= (async () => {
      const dir = paths.previews()
      const files = new Map<string, CachedPreview>()
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.jpg')) continue
        const s = await stat(join(dir, e.name)).catch(() => null)
        if (s) files.set(e.name, { name: e.name, bytes: s.size, used: s.mtimeMs })
      }
      this.files = files
      return files
    })()
    return this.reading
  }

  /** Shown now: last to go, and its file's time says so after a relaunch. */
  private touch(name: string, out: string): void {
    const f = this.files?.get(name)
    if (f) f.used = Date.now()
    this.noteShown(name)
    const now = new Date()
    void utimes(out, now, now).catch(() => undefined)
  }

  private noteShown(name: string): void {
    this.shown = [name, ...this.shown.filter((n) => n !== name)].slice(0, SHOWN_KEEP)
  }

  private async evict(): Promise<void> {
    const files = await this.read()
    for (const name of evictions([...files.values()], this.cap, new Set(this.shown)))
      await this.remove(name)
  }

  private async remove(name: string): Promise<void> {
    this.files?.delete(name)
    const out = join(paths.previews(), name)
    await rm(out, { force: true }).catch(() => undefined)
    await rm(`${out}.json`, { force: true }).catch(() => undefined)
  }
}
