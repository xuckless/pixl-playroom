/**
 * Export: each photo's original, developed once more at full resolution with
 * its recipe and written where the settings say. The same compiler as the
 * previews, at scale 1. One file at a time, in the background engine, with
 * progress; cancelling stops the file being written at the engine's next
 * stage (a cancelled conversion writes nothing) and the rest are not begun.
 */
import { BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { mkdir } from 'fs/promises'
import { basename, extname, join } from 'path'
import { compile, framingWarps, orientedFrame } from '../shared/compile'
import type { ConvertRequest, Dither } from '../shared/engine-types'
import {
  buildColor,
  buildEncode,
  buildResize,
  expandTemplate,
  FORMAT_EXT,
  gainMapEncode,
  hdrLimit,
  metadataPlan,
  outputSharpen,
  outputSharpenRequest,
  sdrRendition,
  supportsGainMap,
  supportsHdr,
  withGainMap,
  type ExportSettings
} from '../shared/export'
import { IPC, type ExportProgress } from '../shared/ipc'
import { brushPlanes } from './brushes'
import { embedMetadata } from './exiftool'
import { exists } from './exists'
import { isCancelled, type EngineClient } from './engine/client'
import type { Library } from './library'
import { ensureProxies, type ProxyFile } from './proxy'
import { ensureBase, pixelDeps } from './pixels/base'
import { ensureWorking } from './pixels/working'
import { editsHdr, ensureHdrSource } from './hdrsource'
import { watermarkSize } from './watermark'
import { watermarkOverlay } from '../shared/watermark'
import type { PhotoRow } from './db'
import type { SourceInfo } from '../shared/engine-types'
import type { Recipe } from '../shared/recipe'
import type { DevelopSessions } from './render'
import {
  BACKGROUND_THREADS,
  blankRequest,
  RAW_DEVELOP,
  sourceOrientation,
  uprightFraming,
  INTERACTIVE_THREADS,
  seedOf,
  versionStamp
} from './source'

interface Job {
  id: string
  abort: AbortController
}

export class Exporter {
  private jobs = new Map<string, Job>()

  constructor(
    private readonly library: Library,
    private readonly sessions: DevelopSessions,
    private readonly engine: EngineClient
  ) {}

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
    const plain = await ensureProxies(this.engine, row, info)
    const set = await ensureWorking(
      pixelDeps(this.engine, this.library.index, row),
      versionStamp(row),
      plain,
      recipe.pixels,
      () => ensureBase(this.engine, row, info)
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
    await this.sessions.flush(key)
    const row = await this.library.photoRow(key)
    const item = await this.library.item(key)
    const recipe = this.sessions.liveRecipe(key) ?? (await this.library.recipe(key))
    const file = await this.library.probe(row)
    // A gain-map photo edited as HDR is exported from its applied rendition,
    // a PQ master: from here on it is an HDR source like any other.
    const hdrSource = editsHdr(recipe, file) ? await ensureHdrSource(this.engine, row, file) : null
    const info = hdrSource?.info ?? file
    // Pixel steps (an AI denoise): the photo at full size with them laid on is the source.
    const master = hdrSource?.master ?? (await this.stepsMaster(row, info, recipe))
    const raw = master ? null : info.input === 'Raw' ? RAW_DEVELOP : null
    const srcOrientation = master ? 'Normal' : sourceOrientation(info, raw)
    // The full-resolution frame, upright. A RAW's developed frame is smaller
    // than its mosaic and not always the same shape (a Canon's masked borders
    // make 6288×4056 of a 6000×4000 picture), and an exact resize takes the
    // shape as given, so a RAW's comes from the engine's own report on the
    // proxies (made once, cached); anything else is probe's size, turned by
    // the file's orientation.
    const swap = ['Transpose', 'Rotate90', 'Transverse', 'Rotate270'].includes(srcOrientation)
    const developed = raw ? await ensureProxies(this.engine, row, info) : null
    const frameW = master?.width ?? developed?.frameWidth ?? (swap ? info.height : info.width)
    const frameH = master?.height ?? developed?.frameHeight ?? (swap ? info.width : info.height)
    const { user, width, height } = orientedFrame(recipe, frameW, frameH)
    // PQ/HLG out: an HDR source kept HDR, or an SDR one expanded.
    const hdrOut =
      supportsHdr(s.format) &&
      ((info.is_hdr && s.hdr.mode === 'keep') || (!info.is_hdr && s.hdr.mode === 'expand'))
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
      hdr: info.is_hdr || hdrOut
    })
    const cw = Math.round((compiled.crop?.width ?? 1) * width)
    const ch = Math.round((compiled.crop?.height ?? 1) * height)
    const { encode, depth } = buildEncode(s, INTERACTIVE_THREADS, hdrOut)

    // Beside the photo: where it is listed (its copy may be the project's own).
    const folder = s.folder ?? row.folder
    const target = s.subfolder ? join(folder, s.subfolder) : folder
    await mkdir(target, { recursive: true })
    const stem = expandTemplate(s.template, {
      name: basename(row.name, extname(row.name)),
      ext: row.ext,
      seq,
      date: new Date().toISOString().slice(0, 10),
      rating: item?.rating ?? 0,
      copy: item?.copyName ?? ''
    })
    const ext = FORMAT_EXT[s.format]
    let out = join(target, `${stem}.${ext}`)
    if (await exists(out)) {
      if (s.collision === 'skip') return null
      if (s.collision === 'suffix') {
        let n = 2
        while (await exists(join(target, `${stem}-${n}.${ext}`))) n++
        out = join(target, `${stem}-${n}.${ext}`)
      }
    }
    if (out === row.path) throw new Error('the export would overwrite the original')

    // An HDR source stays HDR only where the settings ask and the format can
    // say so; otherwise it is tone mapped like any SDR delivery.
    const hdrKeep = info.is_hdr && s.hdr.mode === 'keep' && supportsHdr(s.format)
    // An HDR source as an SDR picture with a gain map, where the format
    // carries one: the grade states the HDR master, the engine renders its
    // SDR picture and writes the map between them. An SDR source has nothing
    // above white to map, and is written as plain SDR.
    const gainMapOut = info.is_hdr && s.hdr.mode === 'gainmap' && supportsGainMap(s.format)
    const effective: ExportSettings =
      (info.is_hdr && s.hdr.mode === 'keep' && !hdrKeep) ||
      (s.hdr.mode === 'gainmap' && !gainMapOut)
        ? { ...s, hdr: { ...s.hdr, mode: 'sdr' } }
        : s
    const peak = info.peak_nits ?? s.hdr.peak
    const resize = buildResize(s, cw, ch)
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
              hdrOut || gainMapOut
            )
          })()
        : null
    const floatWork =
      compiled.grade !== null ||
      compiled.lens !== null ||
      compiled.retouch !== null ||
      overlay !== null ||
      framingWarps(compiled.framing)
    const color = gainMapOut ? 'Preserve' : buildColor(effective, info.is_hdr, info.peak_nits)
    // Dither acts on the one float → integer rounding, so it is only asked
    // for when there is one (the engine refuses it otherwise).
    const floatPath =
      floatWork ||
      gainMapOut ||
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
      metadata: gainMapOut ? { ...plan.policy, icc: true } : plan.policy,
      color,
      sdr: gainMapOut ? sdrRendition(s, peak) : null,
      grade: compiled.grade,
      // A HEIF's EXIF says to turn what libheif has already turned: a stated
      // framing resets the tag in what is written.
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
      threads: BACKGROUND_THREADS * 2
    }
    // Only an SDR file is sharpened for output, after the resize, on the
    // values the file will hold.
    const sdrOut = typeof color === 'object' && ('ConvertTo' in color || 'ToneMap' in color)
    const sharpen = sdrOut ? outputSharpen(s) : null
    await this.engine.convert(
      sharpen
        ? {
            ...request,
            output_sharpen: outputSharpenRequest(s, sharpen),
            // The sharpen is a float pass of its own, so dither always applies.
            dither
          }
        : request,
      { signal }
    )

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
      warn(`metadata not written: ${(err as Error).message}`)
    }
    return out
  }
}
