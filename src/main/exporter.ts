/**
 * Export: each photo's original, developed once more at full resolution with
 * its recipe and written where the settings say. The same compiler as the
 * previews, at scale 1. One file at a time, in the background engine, with
 * progress; cancelling stops the file being written at the engine's next
 * stage (a cancelled conversion writes nothing) and the rest are not begun.
 */
import { BrowserWindow, shell } from 'electron'
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
import { IPC, type ExportPreview, type ExportProgress, type LibraryItem } from '../shared/ipc'
import { READ_LIMITS } from '../shared/limits'
import { paths } from './paths'
import { cacheUrl } from './protocol'
import { brushPlanes } from './brushes'
import { embedMetadata } from './exiftool'
import { exists, sameFile } from './exists'
import { EngineError, isCancelled, type EngineClient } from './engine/client'
import type { Library } from './library'
import { ensureProxies, type ProxyFile } from './proxy'
import { askOf, scenePlan, withScene } from './ai/rawdevelop'
import { ensureBase, pixelDeps } from './pixels/base'
import { ensureWorking } from './pixels/working'
import { editsHdr, ensureHdrSource } from './hdrsource'
import { watermarkSize } from './watermark'
import { watermarkOverlay } from '../shared/watermark'
import type { PhotoRow } from './db'
import type { SourceInfo } from '../shared/engine-types'
import type { Recipe } from '../shared/recipe'
import type { DevelopSessions } from './render'
import { t, tp } from '../shared/i18n'
import {
  BACKGROUND_THREADS,
  heavyThreads,
  blankRequest,
  colourOf,
  rawMaster,
  sourceOrientation,
  uprightFraming,
  seedOf,
  versionStamp
} from './source'

interface Job {
  id: string
  abort: AbortController
}

/** Photos probed for their size in a preflight: a probe is cached, but a thousand are still a wait. */
const PROBE_LIMIT = 100

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

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export class Exporter {
  private jobs = new Map<string, Job>()

  constructor(
    private readonly library: Library,
    private readonly sessions: DevelopSessions,
    private readonly engine: EngineClient
  ) {}

  /** Whether an export is running. */
  get busy(): boolean {
    return this.jobs.size > 0
  }

  private send(p: ExportProgress): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.export.progress, p)
  }

  cancel(id: string): void {
    this.jobs.get(id)?.abort.abort()
  }

  start(keys: string[], settings: ExportSettings): string {
    const job: Job = { id: Math.random().toString(36).slice(2), abort: new AbortController() }
    this.jobs.set(job.id, job)
    void this.run(job, keys, settings).finally(() => this.jobs.delete(job.id))
    return job.id
  }

  private async run(job: Job, keys: string[], s: ExportSettings): Promise<void> {
    const progress: ExportProgress = {
      jobId: job.id,
      done: 0,
      total: keys.length,
      current: null,
      errors: [],
      finished: false,
      outputs: []
    }
    const { signal } = job.abort
    for (const [i, key] of keys.entries()) {
      if (signal.aborted) break
      const item = await this.library.item(key)
      progress.current = item?.name ?? key
      this.send(progress)
      const name = item?.name ?? key
      try {
        const out = await this.one(key, s, i + 1, signal, (message) =>
          progress.errors.push({ name, message, warning: true })
        )
        if (out) progress.outputs.push(out)
      } catch (err) {
        // Stopped by Cancel: the file was never written, and nothing failed.
        if (isCancelled(err)) break
        log.warn('export failed', key, err)
        progress.errors.push({ name, message: (err as Error).message })
      }
      progress.done = i + 1
      this.send(progress)
    }
    progress.finished = true
    progress.current = null
    this.send(progress)
    if (s.reveal && progress.outputs.length > 0) shell.showItemInFolder(progress.outputs[0])
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
    if (recipe.pixels.length === 0) return null
    const plain = await ensureProxies(this.engine, row, info, BACKGROUND_THREADS)
    const set = await ensureWorking(
      pixelDeps(this.engine, this.library.index, row),
      versionStamp(row),
      plain,
      recipe.pixels,
      () => ensureBase(this.engine, row, info, askOf(recipe))
    )
    return set.master
  }

  /**
   * Export one item. Returns the written path, or null when skipped. What
   * goes wrong after the file is written (its metadata) is a `warn`.
   */
  private async one(
    key: string,
    s: ExportSettings,
    seq: number,
    signal: AbortSignal,
    warn: (message: string) => void
  ): Promise<string | null> {
    return (await this.render(key, s, seq, signal, warn))?.out ?? null
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
    preview?: { out: string }
  ): Promise<{ out: string; report: ConvertReport } | null> {
    const s = preview ? previewSettings(s0) : s0
    await this.sessions.flush(key)
    const row = await this.library.photoRow(key)
    // First: a RAW's camera colour is recorded by its first probe, and its
    // saved white balance moves with it, before the recipe is read.
    const file = await this.library.probe(row)
    const item = await this.library.item(key)
    const recipe = this.sessions.liveRecipe(key) ?? (await this.library.recipe(key))
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
    const raw = master ? null : info.input === 'Raw' ? rawMaster(colourOf(row)) : null
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
    const compiled = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      sourceOrientation: srcOrientation,
      frameWidth: frameW,
      frameHeight: frameH,
      scale: 1,
      seed: seedOf(row),
      brushPaths: await brushPlanes(row.id, recipe, user),
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
      // Beside the photo: where it is listed (its copy may be the project's own).
      const { target, stem } = this.nameOf(row, item, s, seq)
      await mkdir(target, { recursive: true })
      const ext = FORMAT_EXT[s.format]
      out = join(target, `${stem}.${ext}`)
      if (await exists(out)) {
        if (s.collision === 'skip') return null
        if (s.collision === 'suffix') {
          let n = 2
          while (await exists(join(target, `${stem}-${n}.${ext}`))) n++
          out = join(target, `${stem}-${n}.${ext}`)
        }
      }
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
        (scene) => convert({ ...request, raw: rawMaster(colourOf(row), scene) }),
        signal
      )
      log.info('export RAW develop', key, done.classic ? 'classic' : plan.tag)
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

  /** Where an item's file goes: its folder (beside the original unless one is chosen) and its name. */
  private nameOf(
    row: PhotoRow,
    item: LibraryItem | null | undefined,
    s: ExportSettings,
    seq: number
  ): { target: string; stem: string } {
    const folder = s.folder ?? row.folder
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

  /**
   * The checks an export's settings cannot make on their own: a folder that
   * cannot be written, too little room, files that would be replaced or
   * skipped, a photo past what the engine opens. The same `Guard`s as
   * `exportGuards`, raised before anything is written.
   */
  async preflight(keys: string[], s: ExportSettings): Promise<Guard[]> {
    const out: Guard[] = []
    const folders = new Set<string>()
    let existing = 0
    let replaced = false
    let need = 0
    const big: string[] = []
    for (const [i, key] of keys.entries()) {
      const row = await this.library.photoRow(key).catch(() => null)
      if (!row) continue
      const item = await this.library.item(key)
      const { target, stem } = this.nameOf(row, item, s, i + 1)
      folders.add(target)
      const file = join(target, `${stem}.${FORMAT_EXT[s.format]}`)
      if (await exists(file)) {
        if (await sameFile(file, row.path)) replaced = true
        else existing++
      }
      need += row.size * 2
      if (i < PROBE_LIMIT) {
        const info = await this.library.probe(row).catch(() => null)
        if (
          info &&
          (info.width * info.height > READ_LIMITS.max_pixels ||
            Math.max(info.width, info.height) > READ_LIMITS.max_side)
        )
          big.push(row.name)
      }
    }
    if (replaced)
      out.push({
        id: 'overwrite-original',
        severity: 'block',
        step: 'review',
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
          step: 'review',
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
          step: 'review',
          message: t('Only {{free}} is free where {{folder}} is.', {
            free: formatBytes(free),
            folder: there
          })
        })
      else if (free !== null && free < need + MIN_FREE)
        out.push({
          id: 'disk-low',
          severity: 'warn',
          step: 'review',
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
              step: 'review',
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
                step: 'review',
                message: tp(
                  '{{count}} file already exists and will be skipped.',
                  '{{count}} files already exist and will be skipped.',
                  existing
                )
              }
            : {
                id: 'collide',
                severity: 'minor',
                step: 'review',
                message: tp(
                  '{{count}} file already exists: the new ones get a number.',
                  '{{count}} files already exist: the new ones get a number.',
                  existing
                )
              }
      )
    }
    if (big.length > 0)
      out.push({
        id: 'too-large',
        severity: 'warn',
        step: 'format',
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
