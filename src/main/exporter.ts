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
import { basename, dirname, extname, join } from 'path'
import { compile, framingWarps, orientedFrame } from '../shared/compile'
import type { ConvertRequest, Dither } from '../shared/engine-types'
import {
  buildColor,
  buildEncode,
  buildResize,
  expandTemplate,
  FORMAT_EXT,
  metadataPlan,
  outputSharpen,
  outputSharpenRequest,
  supportsHdr,
  type ExportSettings
} from '../shared/export'
import { IPC, type ExportProgress } from '../shared/ipc'
import { hash32 } from '../shared/recipe'
import { brushPlanes } from './brushes'
import { embedMetadata } from './exiftool'
import { exists } from './exists'
import { isCancelled, type EngineClient } from './engine/client'
import type { Library } from './library'
import { ensureProxies } from './proxy'
import type { DevelopSessions } from './render'
import {
  BACKGROUND_THREADS,
  blankRequest,
  RAW_DEVELOP,
  sourceOrientation,
  INTERACTIVE_THREADS
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
    const info = await this.library.probe(row)
    const raw = info.input === 'Raw' ? RAW_DEVELOP : null
    const srcOrientation = sourceOrientation(info, raw)
    // The full-resolution frame, upright. A RAW's developed frame is smaller
    // than its mosaic and not always the same shape (a Canon's masked borders
    // make 6288×4056 of a 6000×4000 picture), and an exact resize takes the
    // shape as given, so a RAW's comes from the engine's own report on the
    // proxies (made once, cached); anything else is probe's size, turned by
    // the file's orientation.
    const swap = ['Transpose', 'Rotate90', 'Transverse', 'Rotate270'].includes(srcOrientation)
    const developed = raw ? await ensureProxies(this.engine, row, info) : null
    const frameW = developed?.frameWidth ?? (swap ? info.height : info.width)
    const frameH = developed?.frameHeight ?? (swap ? info.width : info.height)
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
      seed: hash32(row.path),
      brushPaths: await brushPlanes(row.id, recipe, user),
      applyCrop: true,
      hdr: info.is_hdr || hdrOut
    })
    const cw = Math.round((compiled.crop?.width ?? 1) * width)
    const ch = Math.round((compiled.crop?.height ?? 1) * height)
    const { encode, depth } = buildEncode(s, INTERACTIVE_THREADS, hdrOut)

    const folder = s.folder ?? dirname(row.path)
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
    const effective: ExportSettings =
      info.is_hdr && s.hdr.mode === 'keep' && !hdrKeep
        ? { ...s, hdr: { ...s.hdr, mode: 'sdr' } }
        : s
    const floatWork =
      compiled.grade !== null || compiled.lens !== null || framingWarps(compiled.framing)
    const resize = buildResize(s, cw, ch)
    const color = buildColor(effective, info.is_hdr, info.peak_nits)
    // Dither acts on the one float → integer rounding, so it is only asked
    // for when there is one (the engine refuses it otherwise).
    const floatPath =
      floatWork ||
      (resize !== 'None' && !hdrKeep) ||
      (typeof color === 'object' && ('ToneMap' in color || 'Expand' in color))
    const dither: Dither =
      s.dither && depth === 'Eight' ? { TriangularNoise: { seed: hash32(row.path) } } : 'None'
    const plan = metadataPlan(s, item ?? null)
    const request: ConvertRequest = {
      ...blankRequest(row.path, out, info.input, info),
      raw,
      resize,
      resampler: 'Lanczos3',
      // Kept HDR goes through the float path only when something needs it,
      // because that path needs the working white stated.
      linear_resample: hdrKeep ? floatWork : true,
      pixel: { depth, channels: 3 },
      encode,
      metadata: plan.policy,
      color,
      grade: compiled.grade,
      framing: compiled.framing,
      lens: compiled.lens,
      dither: floatPath ? dither : 'None',
      hdr:
        hdrKeep && floatWork
          ? {
              reference_white_nits: s.hdr.referenceWhite,
              peak_nits: info.peak_nits ?? s.hdr.peak,
              limit: 'Clip'
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
