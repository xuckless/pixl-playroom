/**
 * Export: each photo's original, developed once more at full resolution with
 * its recipe and written where the settings say. The same compiler as the
 * previews, at scale 1. One file at a time, in the background engine, one
 * export after another (main/exportqueue.ts), each from the recipes and the
 * folder there were when Export was pressed; stopping one stops the file
 * being written at the engine's next stage (a cancelled conversion writes
 * nothing) and the rest are not begun.
 */
import { activeSteps } from '../shared/pixels'
import { BrowserWindow, Notification, shell } from 'electron'
import log from 'electron-log/main'
import { constants as fsConstants } from 'fs'
import { access, mkdir, rm, statfs } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { compile, framingWarps, orientedFrame } from '../shared/compile'
import type { ColorPolicy, ConvertReport, ConvertRequest, Dither } from '../shared/engine-types'
import {
  buildColor,
  buildEncode,
  buildResize,
  displayPeak,
  expandTemplate,
  FORMAT_EXT,
  gainMapEncode,
  hdrLimit,
  masterPolicy,
  metadataPlan,
  outputSharpen,
  outputSharpenRequest,
  previewResize,
  previewSettings,
  sdrRendition,
  supportsGainMap,
  supportsHdr,
  withGainMap,
  type ExportSettings
} from '../shared/export'
import { FORMAT_NAME, receiptNotes, type Guard } from '../shared/exportGuards'
import { estimateEach, formatBytes } from '../shared/exportSummary'
import {
  IPC,
  type ExportFacts,
  type ExportPreview,
  type ExportProgress,
  type LibraryItem
} from '../shared/ipc'
import { ExportQueue, mapLimit, type PhotoSnapshot, type QueuedExport } from './exportqueue'
import { READ_LIMITS } from '../shared/limits'
import { paths, scriptedHome } from './paths'
import { exportDirFor } from './project/locate'
import { LOCATION_SETTING, locationOf, type SaveLocation } from '../shared/locations'
import { cacheUrl } from './protocol'
import { brushPlanes } from './brushes'
import { lutsFor } from './lutfile'
import { maskFramesFor } from './maskframe'
import { embedMetadata } from './exiftool'
import { exists, sameFile } from './exists'
import { EngineError, isCancelled, type EngineClient } from './engine/client'
import type { Library } from './library'
import { ensureProxies, type ProxyFile } from './proxy'
import { askOf, scenePlan, withScene } from './ai/rawdevelop'
import { standInNote } from '../shared/develops'
import { ensureBase, pixelDeps } from './pixels/base'
import { ensureWorking } from './pixels/working'
import { editsHdr, ensureHdrSource } from './hdrsource'
import { watermarkSize } from './watermark'
import { watermarkOverlay } from '../shared/watermark'
import type { PhotoRow } from './db'
import type { SourceInfo } from '../shared/engine-types'
import type { Recipe } from '../shared/recipe'
import type { DevelopSessions } from './render'
import { t, tp, tk } from '../shared/i18n'
import {
  BACKGROUND_THREADS,
  heavyThreads,
  blankRequest,
  colourOf,
  isLinearRaw,
  rawMaster,
  sourceOrientation,
  uprightFraming,
  seedOf,
  versionStamp
} from './source'
import { exposureOffsetOf } from '../shared/rawcolour'

/** Photos probed for their size in a preflight: a probe is cached, but a thousand are still a wait. */
const PROBE_LIMIT = 100

/** How long what a selection's photos are stays known to the sheet's checks. */
const FACTS_FRESH_MS = 60_000
/** Photos read at once for the sheet's checks. */
const FACTS_AT_ONCE = 8

/** One photo as the sheet's checks know it. */
interface Fact {
  key: string
  item: LibraryItem | undefined
  /** Null when offline, or gone. */
  row: PhotoRow | null
  offline: boolean
}

interface Gathered {
  photos: Fact[]
  /** The first PROBE_LIMIT photos there are, as probed. */
  sample: (ExportFacts['sample'][number] & { name: string; tooLarge: boolean })[]
}

/** The peak an HDR source that states none is read at, in cd/m². */
const UNSTATED_HDR_PEAK = 1000
/** The room an export leaves, below which it is refused. */
const MIN_FREE = 50 * 1024 * 1024

/** The nearest folder that exists at or above `dir`: where a missing one would be made. */
async function nearestExisting(dir: string): Promise<string> {
  let d = dir
  while (!(await exists(d))) {
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  return d
}

/** Bytes free on the disk `dir` is on, or null when the system will not say. */
async function freeBytes(dir: string): Promise<number | null> {
  try {
    const st = await statfs(dir)
    return st.bavail * st.bsize
  } catch {
    return null
  }
}

/** How often a running export looks whether its engine waits for the editing. */
const PAUSE_POLL_MS = 500
/** How long "Paused while you edit" stays after the last wait, so it does not flicker. */
const PAUSE_LINGER_MS = 2000

type Job = QueuedExport<Recipe | null, SaveLocation>

export class Exporter {
  private readonly queue: ExportQueue<Recipe | null, SaveLocation>
  /**
   * What the exports running have written: a name taken by one of their own
   * files is never written over or skipped, whatever is asked of files that
   * were there before (two photos of one name, from two folders, exported
   * into one).
   */
  private readonly written = new Set<string>()
  private pauseTimer: ReturnType<typeof setInterval> | null = null
  private heldAt = 0

  /** Where exports go (`export.location`: Settings and the Export dialog change the one setting). */
  private async destination(): Promise<SaveLocation> {
    return locationOf(
      await this.library.index.getSetting(LOCATION_SETTING.exports).catch(() => null)
    )
  }

  constructor(
    private readonly library: Library,
    private readonly sessions: DevelopSessions,
    private readonly engine: EngineClient,
    /** Whether someone is at Playroom (a window of it has the focus): no Finder over their edit. */
    private readonly attended: () => boolean = () => BrowserWindow.getFocusedWindow() !== null
  ) {
    this.queue = new ExportQueue<Recipe | null, SaveLocation>({
      snapshot: (key) => this.snapshot(key),
      destination: () => this.destination(),
      render: (job, key, seq, warn) => this.one(job, key, seq, warn),
      version: (key, recipe) => {
        // The state an export was made from, a Version to come back to; one
        // the same as the photo's newest is not made again (shared/versions.ts).
        if (recipe)
          void this.library.addVersion(key, {
            name: tk('Exported'),
            kind: 'auto',
            reason: 'export',
            recipe
          })
      },
      send: (p) => this.send(p),
      isCancelled,
      failed: (key, err) => log.warn('export failed', key, err),
      finished: (p, s) => this.finished(p, s),
      idle: () => {
        this.written.clear()
        this.watchPause(false)
      }
    })
  }

  /** Whether an export is running or queued. */
  get busy(): boolean {
    return this.queue.busy
  }

  private send(p: ExportProgress): void {
    if (!p.finished && !p.queued) this.watchPause(true)
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.export.progress, p)
  }

  /**
   * While an export runs, whether the background engine is holding its work
   * for the editing (`holdFor`): the pill says "Paused while you edit"
   * rather than standing still without a word.
   */
  private watchPause(on: boolean): void {
    if (!on) {
      if (this.pauseTimer) clearInterval(this.pauseTimer)
      this.pauseTimer = null
      return
    }
    if (this.pauseTimer) return
    this.pauseTimer = setInterval(() => {
      const now = Date.now()
      if (this.engine.heldBack) this.heldAt = now
      this.queue.setPaused(now - this.heldAt < PAUSE_LINGER_MS)
    }, PAUSE_POLL_MS)
    this.pauseTimer.unref?.()
  }

  /** Every export queued, running, or lately finished (a window opened again finds them). */
  jobs(): ExportProgress[] {
    return this.queue.list()
  }

  /** Queue an export: each photo's recipe and the folder are taken now. */
  enqueue(keys: string[], settings: ExportSettings, label: string | null): Promise<string> {
    return this.queue.enqueue(keys, settings, label)
  }

  cancel(id: string): void {
    this.queue.stop(id)
  }

  /** Stop every export (quitting). */
  stopAll(): void {
    this.queue.stopAll()
  }

  retry(id: string): Promise<string | null> {
    return this.queue.retry(id)
  }

  /** An export's files in the system's file browser: the first of them, selected. */
  show(id: string): void {
    const out = this.queue.list().find((p) => p.jobId === id)?.outputs[0]
    if (out) shell.showItemInFolder(out)
  }

  /** The photo as Export finds it: pending edits saved, then its recipe as it is now. */
  private async snapshot(key: string): Promise<PhotoSnapshot<Recipe | null>> {
    await this.sessions.flush(key).catch(() => undefined)
    const item = await this.library.item(key).catch(() => undefined)
    if (item?.offline) return { recipe: null, name: item.name, offline: true }
    // A RAW's camera colour is recorded by its first probe, and its saved
    // white balance moves with it, before the recipe is read.
    if (item?.isRaw)
      await this.library
        .photoRow(key)
        .then((row) => this.library.probe(row))
        .catch(() => undefined)
    const recipe =
      this.sessions.liveRecipe(key) ?? (await this.library.recipe(key).catch(() => null))
    return { recipe, name: item?.name ?? key, offline: false }
  }

  /**
   * An export done: when nobody is at Playroom, its folder comes up (if the
   * settings ask) and the system says so; otherwise the receipt in the top
   * bar's pill has its Show action, and nothing jumps in front of the edit.
   */
  private finished(p: ExportProgress, s: ExportSettings): void {
    if (p.stopped || this.attended()) return
    const failed = p.errors.filter((e) => !e.warning).length
    if (s.reveal && p.outputs.length > 0) shell.showItemInFolder(p.outputs[0])
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: p.label ? t('Export done · {{label}}', { label: p.label }) : t('Export done'),
      body:
        failed > 0
          ? t('{{count}} written, {{failed}} failed.', { count: p.outputs.length, failed })
          : t('{{count}} written.', { count: p.outputs.length })
    })
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0]
      if (!w) return
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    })
    n.show()
  }

  /**
   * The photo at full size with its pixel steps laid on (an AI denoise), made
   * from what its project keeps (never by running a model); null when it has
   * none.
   */
  private async stepsMaster(
    row: PhotoRow,
    info: SourceInfo,
    recipe: Recipe
  ): Promise<ProxyFile | null> {
    if (activeSteps(recipe.pixels).length === 0) return null
    const plain = await ensureProxies(this.engine, row, info, BACKGROUND_THREADS)
    const set = await ensureWorking(
      pixelDeps(this.engine, this.library.index, row),
      versionStamp(row),
      plain,
      activeSteps(recipe.pixels),
      () => ensureBase(this.engine, row, info, askOf(recipe))
    )
    return set.master
  }

  /**
   * One photo of a queued export, from its snapshot. Returns the written
   * path, or null when skipped. What goes wrong after the file is written
   * (its metadata) is a `warn`.
   */
  private async one(
    job: Job,
    key: string,
    seq: number,
    warn: (message: string) => void
  ): Promise<string | null> {
    const recipe = job.photos.get(key)?.recipe ?? null
    const done = await this.render(key, job.settings, seq, job.abort.signal, warn, undefined, {
      recipe,
      dest: job.dest
    })
    return done?.out ?? null
  }

  /**
   * The export of one item; with `preview` the same request at the preview's
   * size and settings (`previewSettings`), written to `preview.out`: what
   * the picture will look like through the same colour path and encoder.
   * Returns the written path and the engine's report, or null when skipped.
   */
  private async render(
    key: string,
    s0: ExportSettings,
    seq: number,
    signal: AbortSignal,
    warn: (message: string) => void,
    preview?: { out: string },
    /** A queued export's: the recipe and the folder as they were when Export was pressed. */
    snap?: { recipe: Recipe | null; dest: SaveLocation }
  ): Promise<{ out: string; report: ConvertReport } | null> {
    const s = preview ? previewSettings(s0) : s0
    if (!snap) await this.sessions.flush(key)
    const row = await this.library.photoRow(key)
    // First: a RAW's camera colour is recorded by its first probe, and its
    // saved white balance moves with it, before the recipe is read.
    const file = await this.library.probe(row)
    const item = await this.library.item(key)
    const recipe = snap?.recipe ?? this.sessions.liveRecipe(key) ?? (await this.library.recipe(key))
    // The engine's own HDR path (`ColorPolicy::Master`) where the settings
    // and the photo allow it: it reads a gain map itself and grades with
    // headroom, so the rendition below is not made for it.
    const pixl = masterPolicy(s, {
      isHdr: file.is_hdr,
      hasGainMap: !!file.gain_map,
      editsBase: !!file.gain_map && !editsHdr(recipe, file)
    })
    // A gain-map photo edited as HDR is exported from its applied rendition,
    // a PQ master: from here on it is an HDR source like any other.
    const hdrSource =
      !pixl && editsHdr(recipe, file) ? await ensureHdrSource(this.engine, row, file) : null
    const info = hdrSource?.info ?? file
    // Pixel steps (an AI denoise): the photo at full size with them laid on is the source.
    const master = hdrSource?.master ?? (await this.stepsMaster(row, info, recipe))
    const raw = master
      ? null
      : info.input === 'Raw'
        ? rawMaster(colourOf(row), undefined, isLinearRaw(info))
        : null
    const srcOrientation = master ? 'Normal' : sourceOrientation(info, raw)
    // The full-resolution frame, upright. A RAW's developed frame is smaller
    // than its mosaic and not always the same shape (a Canon's masked borders
    // make 6288×4056 of a 6000×4000 picture), and an exact resize takes the
    // shape as given, so a RAW's comes from the engine's own report on the
    // proxies (made once, cached); anything else is probe's size, turned by
    // the file's orientation.
    const swap = ['Transpose', 'Rotate90', 'Transverse', 'Rotate270'].includes(srcOrientation)
    const developed = raw ? await ensureProxies(this.engine, row, info, BACKGROUND_THREADS) : null
    const frameW = master?.width ?? developed?.frameWidth ?? (swap ? info.height : info.width)
    const frameH = master?.height ?? developed?.frameHeight ?? (swap ? info.width : info.height)
    const { user, width, height } = orientedFrame(recipe, frameW, frameH)
    // PQ/HLG out: an HDR source kept HDR, or an SDR one expanded.
    const hdrOut =
      !pixl &&
      supportsHdr(s.format) &&
      ((info.is_hdr && s.hdr.mode === 'keep') || (!info.is_hdr && s.hdr.mode === 'expand'))
    // An HDR source as an SDR picture with a gain map, where the format
    // carries one: the grade states the HDR master, the engine renders its
    // SDR picture and writes the map between them. An SDR source has nothing
    // above white to map, and is written as plain SDR.
    const gainMapOut = !pixl && info.is_hdr && s.hdr.mode === 'gainmap' && supportsGainMap(s.format)
    // Masks drawn under another lens than the one rendered are carried to it.
    const maskFrames = await maskFramesFor(
      pixelDeps(this.engine, this.library.index, row),
      recipe,
      row.is_raw === 1,
      frameW,
      frameH
    ).catch((err) => {
      log.warn('export: masks on another lens not mapped', err)
      return null
    })
    const compiled = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      exposureOffset: exposureOffsetOf(colourOf(row)),
      sourceOrientation: srcOrientation,
      frameWidth: frameW,
      frameHeight: frameH,
      scale: 1,
      seed: seedOf(row),
      brushPaths: await brushPlanes(row.id, recipe, user, {
        isRaw: row.is_raw === 1,
        frames: maskFrames
      }),
      maskFrames,
      luts: await lutsFor(recipe, paths.luts()),
      applyCrop: true,
      // HDR only where the pipeline keeps room above white: PQ/HLG out, or
      // the gain map's HDR master. Tone mapped to SDR, the grade runs after
      // the tone map on values that stop at 1.
      hdr: hdrOut || gainMapOut || pixl !== null
    })
    const cw = Math.round((compiled.crop?.width ?? 1) * width)
    const ch = Math.round((compiled.crop?.height ?? 1) * height)
    // An export runs behind the editing: the encoder takes the export's share too.
    // `Master` writes PQ into JXL and PNG, at 16 bits (8-bit PQ is refused).
    const pqOut = pixl?.headroom === true && (s.format === 'jxl' || s.format === 'png')
    const { encode, depth } = buildEncode(s, heavyThreads(), hdrOut || pqOut)

    let out: string
    if (preview) out = preview.out
    else {
      // Where exports go: beside the photo (where it is listed: its copy may
      // be the project's own), the preset folder, or the user's.
      const dest = snap?.dest ?? (await this.destination())
      const { target, stem } = this.nameOf(row, item, s, seq, dest)
      await mkdir(target, { recursive: true })
      const ext = FORMAT_EXT[s.format]
      out = join(target, `${stem}.${ext}`)
      const mine = this.written.has(out)
      if (mine || (await exists(out))) {
        if (!mine && s.collision === 'skip') return null
        if (mine || s.collision === 'suffix') {
          let n = 2
          const at = (): string => join(target, `${stem}-${n}.${ext}`)
          while (this.written.has(at()) || (await exists(at()))) n++
          out = at()
        }
      }
      this.written.add(out)
      // By the file, not the name: IMG_1.jpg is IMG_1.JPG on a case-insensitive disk.
      if (await sameFile(out, row.path))
        throw new Error(t('the export would overwrite the original'))
    }

    // An HDR source stays HDR only where the settings ask and the format can
    // say so; otherwise it is tone mapped like any SDR delivery.
    const hdrKeep = !pixl && info.is_hdr && s.hdr.mode === 'keep' && supportsHdr(s.format)
    const effective: ExportSettings =
      (info.is_hdr && s.hdr.mode === 'keep' && !hdrKeep) ||
      (s.hdr.mode === 'gainmap' && !gainMapOut && !pixl)
        ? { ...s, hdr: { ...s.hdr, mode: 'sdr' } }
        : s
    // An HDR source that states no peak is taken at 1000 cd/m² (the expand
    // setting's peak is SDR → HDR's alone, and its default moved to 1600).
    const peak = displayPeak(info.peak_nits ?? UNSTATED_HDR_PEAK)
    const resize = preview ? previewResize(s, cw, ch) : buildResize(s, cw, ch)
    // The watermark, placed on the output as it will be: cropped, then resized.
    const wm = s.watermark
    const overlay =
      wm.enabled && wm.path
        ? await (async () => {
            const pic = await watermarkSize(wm.path!)
            const outW =
              resize === 'None'
                ? cw
                : 'Exact' in resize
                  ? resize.Exact.width
                  : Math.round(cw * resize.Scale.factor)
            const outH =
              resize === 'None'
                ? ch
                : 'Exact' in resize
                  ? resize.Exact.height
                  : Math.round(ch * resize.Scale.factor)
            return watermarkOverlay(
              wm,
              wm.path!,
              outW,
              outH,
              pic.width,
              pic.height,
              hdrOut || gainMapOut || pixl !== null
            )
          })()
        : null
    const floatWork =
      compiled.grade !== null ||
      compiled.lens !== null ||
      compiled.retouch !== null ||
      overlay !== null ||
      framingWarps(compiled.framing)
    const color: ColorPolicy = pixl
      ? { Master: pixl }
      : gainMapOut
        ? 'Preserve'
        : buildColor(effective, info.is_hdr, info.peak_nits)
    // Dither acts on the one float → integer rounding, so it is only asked
    // for when there is one (the engine refuses it otherwise).
    const floatPath =
      floatWork ||
      gainMapOut ||
      pixl !== null ||
      (resize !== 'None' && !hdrKeep) ||
      (typeof color === 'object' && ('ToneMap' in color || 'Expand' in color))
    const dither: Dither =
      s.dither && depth === 'Eight' ? { TriangularNoise: { seed: seedOf(row) } } : 'None'
    const plan = metadataPlan(s, item ?? null)
    const request: ConvertRequest = {
      ...(master
        ? blankRequest(master.path, out, master.input)
        : blankRequest(row.path, out, info.input, info)),
      raw,
      resize,
      resampler: 'Lanczos3',
      // Kept HDR goes through the float path only when something needs it,
      // because that path needs the working white stated.
      linear_resample: hdrKeep ? floatWork : true,
      pixel: { depth, channels: 3 },
      encode: gainMapOut ? withGainMap(encode, gainMapEncode(s, peak)) : encode,
      // A reader reaches the base's linear light, which the map multiplies,
      // through its colour description.
      // `Master` refuses `icc: false`; so does a gain map's base, which a
      // reader reaches the linear light of through its colour description.
      metadata: gainMapOut || pixl ? { ...plan.policy, icc: true } : plan.policy,
      color,
      sdr: gainMapOut ? sdrRendition(s, peak) : null,
      // `Master` reads the map itself and refuses the field.
      ...(pixl ? { gain_map: null } : {}),
      grade: compiled.grade,
      // A HEIF's EXIF tag is never applied: a stated framing resets it in
      // what is written.
      framing: compiled.framing ?? (master ? null : uprightFraming('Normal', info)),
      lens: compiled.lens,
      retouch: compiled.retouch,
      overlays: overlay ? [overlay] : null,
      dither: floatPath ? dither : 'None',
      hdr:
        gainMapOut || (hdrKeep && floatWork)
          ? {
              reference_white_nits: s.hdr.referenceWhite,
              peak_nits: peak,
              limit: hdrLimit(s, peak)
            }
          : null,
      threads: heavyThreads()
    }
    // Only an SDR file is sharpened for output, after the resize, on the
    // values the file will hold.
    const sdrOut =
      typeof color === 'object' &&
      ('ConvertTo' in color || 'ToneMap' in color || ('Master' in color && !color.Master.headroom))
    const sharpen = sdrOut ? outputSharpen(s) : null
    const convert = (r: ConvertRequest): Promise<ConvertReport> =>
      this.engine
        .convert(
          sharpen
            ? {
                ...r,
                output_sharpen: outputSharpenRequest(s, sharpen),
                // The sharpen is a float pass of its own, so dither always applies.
                dither
              }
            : r,
          { signal }
        )
        .catch((err: unknown) => {
          // HR-0.18-9: the export says which adjustment broke the picture.
          if (err instanceof EngineError)
            err.nameInvariant(compiled.grade, r.sdr?.grade ?? null, compiled.layerIndex)
          throw err
        })
    // A RAW exported from the file at full size: its best demosaic, and PMRID
    // when the edit asks (ai/rawdevelop.ts). A preview is too small to show
    // either, and stays classic.
    let report: ConvertReport
    if (raw && !preview) {
      const plan = await scenePlan(info.raw_cfa, askOf(recipe))
      const done = await withScene(
        plan,
        (scene) => convert({ ...request, raw: rawMaster(colourOf(row), scene, isLinearRaw(info)) }),
        signal,
        { camera: row.camera, iso: row.iso }
      )
      log.info(
        'export RAW develop',
        key,
        done.classic ? `${done.ran} (stood in for ${plan.tag})` : plan.tag
      )
      // Another develop stood in: the receipt says which, and why (the engine's words).
      if (done.classic && (done.refused || done.declined))
        warn(standInNote(plan.tag, done.ran, done.declined ? null : (done.refused ?? '')))
      report = done.value
    } else report = await convert(request)

    // What the engine's own path did, in its words: for the log and the receipt.
    const m = report.color.master
    if (m) log.info('export master', key, m.output, ...m.notes)
    if (preview) return { out, report }
    // The receipt: what landed against what the settings asked.
    for (const note of receiptNotes(request.metadata, report.metadata_written, m?.notes ?? []))
      warn(note)

    // The engine copies blocks as they are; the photo's own fields, the
    // copyright and the location are ExifTool's. The picture is written by
    // now, so a format ExifTool cannot write only costs the metadata.
    try {
      await embedMetadata(out, plan.tags, {
        removeLocation: plan.removeLocation,
        source: row.path
      })
    } catch (err) {
      log.warn('export metadata failed', out, err)
      warn(t('metadata not written: {{reason}}', { reason: (err as Error).message }))
    }
    return { out, report }
  }

  /** Where an item's file goes: its folder (`exportDirFor`, for where exports are saved) and its name. */
  private nameOf(
    row: PhotoRow,
    item: LibraryItem | null | undefined,
    s: ExportSettings,
    seq: number,
    dest: SaveLocation
  ): { target: string; stem: string } {
    const folder = exportDirFor(dest, row.folder, scriptedHome() ?? undefined)
    return {
      target: s.subfolder ? join(folder, s.subfolder) : folder,
      stem: expandTemplate(s.template, {
        name: basename(row.name, extname(row.name)),
        ext: row.ext,
        seq,
        date: new Date().toISOString().slice(0, 10),
        rating: item?.rating ?? 0,
        copy: item?.copyName ?? ''
      })
    }
  }

  private previewAbort: AbortController | null = null
  private previewFile: string | null = null

  /**
   * One photo as the export would write it, at the preview's size: the same
   * request through the same colour path and encoder (`previewSettings` says
   * where it differs), for the export dialog to show. A newer preview stops
   * the one before.
   */
  async preview(key: string, s: ExportSettings): Promise<ExportPreview> {
    this.previewAbort?.abort()
    const abort = new AbortController()
    this.previewAbort = abort
    const shown = previewSettings(s)
    const dir = join(paths.cacheRoot(), 'export-preview')
    await mkdir(dir, { recursive: true })
    const out = join(dir, `${Math.random().toString(36).slice(2)}.${FORMAT_EXT[shown.format]}`)
    const notes: string[] = []
    try {
      const done = await this.render(key, s, 1, abort.signal, (m) => notes.push(m), { out })
      if (!done) throw new Error('nothing was rendered')
      if (this.previewFile && this.previewFile !== out) await rm(this.previewFile, { force: true })
      this.previewFile = out
      const { report } = done
      const shownAs: string[] = []
      if (shown.format !== s.format)
        shownAs.push(
          t('Shown as {{shown}}: the window cannot show {{format}}.', {
            shown: FORMAT_NAME[shown.format],
            format: FORMAT_NAME[s.format]
          })
        )
      if (shown.hdr.mode !== s.hdr.mode) shownAs.push(t('Shown as its SDR picture.'))
      return {
        url: cacheUrl(out, Date.now()),
        width: report.width,
        height: report.height,
        bytes: report.output_bytes,
        format: shown.format,
        notes: [...shownAs, ...notes]
      }
    } catch (err) {
      await rm(out, { force: true }).catch(() => undefined)
      throw err
    } finally {
      if (this.previewAbort === abort) this.previewAbort = null
    }
  }

  cancelPreview(): void {
    this.previewAbort?.abort()
  }

  private gathered: { keys: string; at: number; facts: Promise<Gathered> } | null = null

  /**
   * What an export of `keys` needs to know of them that no setting changes:
   * each one's row (offline or not) and a sample's probe. Read once for a
   * selection (a minute at most), so the checks that follow the settings in
   * the sheet only look at the disk.
   */
  private gather(keys: string[]): Promise<Gathered> {
    const id = keys.join('\n')
    const now = Date.now()
    if (this.gathered?.keys === id && now - this.gathered.at < FACTS_FRESH_MS)
      return this.gathered.facts
    const facts = (async (): Promise<Gathered> => {
      const photos = await mapLimit(keys, FACTS_AT_ONCE, async (key): Promise<Fact> => {
        const item = await this.library.item(key).catch(() => undefined)
        if (item?.offline) return { key, item, row: null, offline: true }
        const row = await this.library.photoRow(key).catch(() => null)
        return { key, item, row, offline: false }
      })
      const probed = photos.filter((p) => p.row).slice(0, PROBE_LIMIT)
      const infos = await mapLimit(probed, FACTS_AT_ONCE, (p) =>
        this.library.probe(p.row!).catch(() => null)
      )
      const sample: Gathered['sample'] = []
      for (const [i, p] of probed.entries()) {
        const info = infos[i]
        if (!info) continue
        const turned = ['Transpose', 'Rotate90', 'Transverse', 'Rotate270'].includes(
          sourceOrientation(info, null)
        )
        sample.push({
          key: p.key,
          name: p.row!.name,
          width: turned ? info.height : info.width,
          height: turned ? info.width : info.height,
          isHdr: info.is_hdr,
          hasGainMap: !!info.gain_map,
          tooLarge:
            info.width * info.height > READ_LIMITS.max_pixels ||
            Math.max(info.width, info.height) > READ_LIMITS.max_side
        })
      }
      return { photos, sample }
    })()
    this.gathered = { keys: id, at: now, facts }
    facts.catch(() => {
      if (this.gathered?.facts === facts) this.gathered = null
    })
    return facts
  }

  /** The photos an export of `keys` would take, for the sheet's summary and estimate. */
  async facts(keys: string[]): Promise<ExportFacts> {
    const { photos, sample } = await this.gather(keys)
    return {
      photos: photos.length,
      offline: photos.filter((p) => p.offline).length,
      sample: sample.map(({ key, width, height, isHdr, hasGainMap }) => ({
        key,
        width,
        height,
        isHdr,
        hasGainMap
      }))
    }
  }

  /**
   * The checks an export's settings cannot make on their own: a folder that
   * cannot be written, too little room, files that would be replaced or
   * skipped, a photo past what the engine opens, photos offline. The same
   * `Guard`s as `exportGuards`, raised before anything is written; what
   * the photos are is read once (`gather`), what the settings make of them
   * each time.
   */
  async preflight(keys: string[], s: ExportSettings): Promise<Guard[]> {
    const out: Guard[] = []
    const folders = new Set<string>()
    let existing = 0
    let replaced = false
    const { photos, sample } = await this.gather(keys)
    const dest = await this.destination()
    const offline = photos.filter((p) => p.offline).length
    const big = sample.filter((p) => p.tooLarge).map((p) => p.name)
    const checked = await mapLimit([...photos.entries()], FACTS_AT_ONCE, async ([i, p]) => {
      if (!p.row) return null
      const { target, stem } = this.nameOf(p.row, p.item, s, i + 1, dest)
      const file = join(target, `${stem}.${FORMAT_EXT[s.format]}`)
      const there = await exists(file)
      return { target, there: there && (await sameFile(file, p.row.path)) ? 'original' : there }
    })
    for (const c of checked) {
      if (!c) continue
      folders.add(c.target)
      if (c.there === 'original') replaced = true
      else if (c.there) existing++
    }
    // The room it needs: the sample's estimate for every photo, with a margin.
    const written = photos.filter((p) => p.row).length
    // (The sheet's own estimate, so the two never disagree.)
    const each = estimateEach(s, sample)
    const need = Math.max(
      Math.round(each * written * 1.25),
      photos.reduce((n, p) => n + (p.row?.size ?? 0), 0)
    )
    if (replaced)
      out.push({
        id: 'overwrite-original',
        severity: 'block',
        card: 'location',
        message: t(
          'A file would be written over its original: change the name, the folder or the format.'
        )
      })
    for (const dir of folders) {
      const there = await nearestExisting(dir)
      const writable = await access(there, fsConstants.W_OK).then(
        () => true,
        () => false
      )
      if (!writable) {
        out.push({
          id: 'folder-unwritable',
          severity: 'block',
          card: 'location',
          message: t('Playroom cannot write to {{folder}}: choose another folder.', {
            folder: there
          })
        })
        continue
      }
      const free = await freeBytes(there)
      if (free !== null && free < MIN_FREE)
        out.push({
          id: 'disk-full',
          severity: 'block',
          card: 'location',
          message: t('Only {{free}} is free where {{folder}} is.', {
            free: formatBytes(free),
            folder: there
          })
        })
      else if (free !== null && free < need + MIN_FREE)
        out.push({
          id: 'disk-low',
          severity: 'warn',
          card: 'location',
          message: t('{{free}} is free where {{folder}} is; this export may need about {{need}}.', {
            free: formatBytes(free),
            folder: there,
            need: formatBytes(need)
          })
        })
    }
    if (existing > 0) {
      out.push(
        s.collision === 'overwrite'
          ? {
              id: 'collide',
              severity: 'warn',
              card: 'location',
              message: tp(
                '{{count}} file already exists and will be replaced.',
                '{{count}} files already exist and will be replaced.',
                existing
              )
            }
          : s.collision === 'skip'
            ? {
                id: 'collide',
                severity: 'warn',
                card: 'location',
                message: tp(
                  '{{count}} file already exists and will be skipped.',
                  '{{count}} files already exist and will be skipped.',
                  existing
                )
              }
            : {
                id: 'collide',
                severity: 'minor',
                card: 'location',
                message: tp(
                  '{{count}} file already exists: the new ones get a number.',
                  '{{count}} files already exist: the new ones get a number.',
                  existing
                )
              }
      )
    }
    if (offline > 0)
      out.push({
        id: 'offline',
        severity: 'warn',
        card: null,
        message: tp(
          '{{count}} photo is offline and will be skipped.',
          '{{count}} photos are offline and will be skipped.',
          offline
        )
      })
    if (big.length > 0)
      out.push({
        id: 'too-large',
        severity: 'warn',
        card: 'size',
        message:
          big.length > 1
            ? tp(
                '{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail.',
                '{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail.',
                big.length - 1,
                { name: big[0], megapixels: READ_LIMITS.max_pixels / 1e6 }
              )
            : t(
                '{{name}} is larger than Playroom opens ({{megapixels}} megapixels) and will fail.',
                { name: big[0], megapixels: READ_LIMITS.max_pixels / 1e6 }
              )
      })
    return out
  }
}
