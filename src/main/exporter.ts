/**
 * Export: each photo's original, developed once more at full resolution with
 * its recipe and written where the settings say. The same compiler as the
 * previews, at scale 1. One file at a time, in the background engine, with
 * progress and cancellation between files (the engine itself is synchronous
 * and never cancels mid-file).
 */
import { BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { existsSync, mkdirSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { compile, orientedFrame } from '../shared/compile'
import {
  buildColor,
  buildEncode,
  buildResize,
  expandTemplate,
  FORMAT_EXT,
  supportsHdr,
  type ExportSettings
} from '../shared/export'
import { IPC, type ExportProgress } from '../shared/ipc'
import { hash32 } from '../shared/recipe'
import { brushPlanes } from './brushes'
import type { EngineClient } from './engine/client'
import type { Library } from './library'
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
  cancelled: boolean
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
    const j = this.jobs.get(id)
    if (j) j.cancelled = true
  }

  start(keys: string[], settings: ExportSettings): string {
    const job: Job = { id: Math.random().toString(36).slice(2), cancelled: false }
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
    for (const [i, key] of keys.entries()) {
      if (job.cancelled) break
      const item = this.library.item(key)
      progress.current = item?.name ?? key
      this.send(progress)
      try {
        const out = await this.one(key, s, i + 1)
        if (out) progress.outputs.push(out)
      } catch (err) {
        log.warn('export failed', key, err)
        progress.errors.push({ name: item?.name ?? key, message: (err as Error).message })
      }
      progress.done = i + 1
      this.send(progress)
    }
    progress.finished = true
    progress.current = null
    this.send(progress)
    if (s.reveal && progress.outputs.length > 0) shell.showItemInFolder(progress.outputs[0])
  }

  /** Export one item. Returns the written path, or null when skipped. */
  private async one(key: string, s: ExportSettings, seq: number): Promise<string | null> {
    this.sessions.flush(key)
    const row = this.library.photoRow(key)
    const item = this.library.item(key)
    const recipe = this.sessions.liveRecipe(key) ?? this.library.recipe(key)
    const info = await this.library.probe(row)
    const raw = info.input === 'Raw' ? RAW_DEVELOP : null
    const srcOrientation = sourceOrientation(info, raw)
    // The full-resolution frame, upright: probe's size turned by the file's
    // orientation (a RAW's developed frame is a little smaller than its
    // mosaic; the crop is normalised, so only the aspect has to be right).
    const swap = ['Transpose', 'Rotate90', 'Transverse', 'Rotate270'].includes(srcOrientation)
    const frameW = swap ? info.height : info.width
    const frameH = swap ? info.width : info.height
    const { user, width, height } = orientedFrame(recipe, frameW, frameH)
    const compiled = compile(recipe, {
      isRaw: row.is_raw === 1,
      asShot: info.as_shot_white,
      sourceOrientation: srcOrientation,
      frameWidth: frameW,
      frameHeight: frameH,
      scale: 1,
      seed: hash32(row.path),
      brushPaths: await brushPlanes(row.id, recipe, user),
      applyCrop: true
    })
    const cw = Math.round((compiled.crop?.width ?? 1) * width)
    const ch = Math.round((compiled.crop?.height ?? 1) * height)
    const { encode, depth } = buildEncode(s, INTERACTIVE_THREADS)

    const folder = s.folder ?? dirname(row.path)
    const target = s.subfolder ? join(folder, s.subfolder) : folder
    mkdirSync(target, { recursive: true })
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
    if (existsSync(out)) {
      if (s.collision === 'skip') return null
      if (s.collision === 'suffix') {
        let n = 2
        while (existsSync(join(target, `${stem}-${n}.${ext}`))) n++
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
    const floatWork = compiled.grade !== null || (compiled.framing?.rotate_degrees ?? 0) !== 0
    const resize = buildResize(s, cw, ch)
    const color = buildColor(effective, info.is_hdr, info.peak_nits)
    // Dither acts on the one float → integer rounding, so it is only asked
    // for when there is one (the engine refuses it otherwise).
    const floatPath =
      floatWork ||
      (resize !== 'None' && !hdrKeep) ||
      (typeof color === 'object' && ('ToneMap' in color || 'Expand' in color))
    await this.engine.convert({
      ...blankRequest(row.path, out, info.input),
      raw,
      resize,
      resampler: 'Lanczos3',
      // Kept HDR goes through the float path only when something needs it,
      // because that path needs the working white stated.
      linear_resample: hdrKeep ? floatWork : true,
      pixel: { depth, channels: 3 },
      encode,
      metadata: s.metadata,
      color,
      grade: compiled.grade,
      framing: compiled.framing,
      dither:
        s.dither && depth === 'Eight' && floatPath
          ? { TriangularNoise: { seed: hash32(row.path) } }
          : 'None',
      hdr:
        hdrKeep && floatWork
          ? { reference_white_nits: s.hdr.referenceWhite, peak_nits: info.peak_nits ?? s.hdr.peak }
          : null,
      threads: BACKGROUND_THREADS * 2
    })
    return out
  }
}
