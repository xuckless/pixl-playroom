/**
 * Enhance → Super Resolution: the engine's generative upscaler (a bundled
 * Real-ESRGAN ×2 model on a bundled ONNX Runtime) enlarges a photo's
 * *original*, before any grade — the model wants display-referred pixels and
 * the engine refuses a grade beside it — into a new 16-bit TIFF beside the
 * original. The new file joins the folder with the source's recipe copied
 * over, so the look carries across, as Lightroom's Enhance does.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { existsSync, readdirSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { ExecutionProvider, UpscalerRef } from '../shared/engine-types'
import { PRESERVE_ALL } from '../shared/engine-types'
import { IPC, type EnhanceProgress } from '../shared/ipc'
import { baseWhite } from '../shared/compile'
import { relativeFromOp } from '../shared/wb'
import type { EngineClient } from './engine/client'
import type { Library } from './library'
import { paths } from './paths'
import { BACKGROUND_THREADS, blankRequest, RAW_DEVELOP, sourceOrientation } from './source'

export const MODEL_FILE = 'real_esrgan_x2.onnx'

function runtimeLibrary(dir: string): string | null {
  const lib = join(dir, 'onnxruntime', 'lib')
  if (!existsSync(lib)) return null
  const want =
    process.platform === 'win32'
      ? /^onnxruntime\.dll$/
      : process.platform === 'darwin'
        ? /^libonnxruntime\.\d.*\.dylib$|^libonnxruntime\.dylib$/
        : /^libonnxruntime\.so(\.\d+)*$/
  const hit = readdirSync(lib).find((f) => want.test(f))
  return hit ? join(lib, hit) : null
}

export interface EnhanceAvailability {
  available: boolean
  reason?: string
  model?: string
  runtime?: string
}

export function enhanceAvailability(engineHasEnhance: boolean): EnhanceAvailability {
  if (!engineHasEnhance)
    return { available: false, reason: 'this build of the engine has no generative upscaler' }
  const dir = paths.ai()
  const model = join(dir, MODEL_FILE)
  if (!existsSync(model))
    return { available: false, reason: `the model is not bundled (${model}); run pnpm fetch-ai` }
  const runtime = runtimeLibrary(dir)
  if (!runtime)
    return { available: false, reason: `ONNX Runtime is not bundled in ${dir}; run pnpm fetch-ai` }
  return { available: true, model, runtime }
}

/**
 * The provider the bundled runtime offers: CoreML in Apple's builds; DirectML
 * only when a DirectML build of the runtime was bundled; otherwise the CPU.
 */
function provider(choice: 'auto' | 'cpu', runtime: string): ExecutionProvider {
  if (choice === 'cpu') return 'Cpu'
  if (process.platform === 'darwin') return 'CoreMl'
  if (process.platform === 'win32' && existsSync(join(dirname(runtime), 'DirectML.dll'))) {
    return { DirectMl: { device: 0 } }
  }
  return 'Cpu'
}

export class Enhancer {
  constructor(
    private readonly library: Library,
    private readonly engine: EngineClient
  ) {}

  private send(p: EnhanceProgress): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.enhance.progress, p)
  }

  async run(key: string, choice: 'auto' | 'cpu'): Promise<void> {
    const status = this.engine.getStatus()
    const avail = enhanceAvailability(status.enhance === true)
    if (!avail.available || !avail.model || !avail.runtime) {
      this.send({ key, phase: 'error', message: avail.reason ?? 'unavailable' })
      return
    }
    const row = await this.library.photoRow(key)
    const info = await this.library.probe(row)
    const stem = basename(row.name, extname(row.name))
    const out = join(dirname(row.path), `${stem}-Enhanced-SR.tif`)
    if (existsSync(out)) {
      this.send({ key, phase: 'error', message: `${basename(out)} already exists` })
      return
    }
    this.send({ key, phase: 'running', message: `Enhancing ${row.name} ×2…` })
    const raw = info.input === 'Raw' ? RAW_DEVELOP : null
    const orientation = sourceOrientation(info, raw)
    const upscaler: UpscalerRef = {
      model_path: avail.model,
      runtime_library: avail.runtime,
      provider: provider(choice, avail.runtime),
      threads: BACKGROUND_THREADS * 2,
      scale: 2,
      tile: 256,
      overlap: 16,
      input_multiple: 2,
      then: null,
      alpha: { Resample: 'Lanczos3' }
    }
    const tryRun = (up: UpscalerRef): Promise<unknown> =>
      this.engine.convert({
        ...blankRequest(row.path, out, info.input),
        raw,
        resize: { Scale: { factor: 2 } },
        resampler: 'Ai',
        upscaler: up,
        pixel: { depth: 'Sixteen', channels: 3 },
        encode: { Tiff: { compression: 'Deflate' } },
        metadata: raw ? { ...PRESERVE_ALL, icc: true } : PRESERVE_ALL,
        color: 'Preserve',
        framing:
          orientation === 'Normal'
            ? null
            : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
        threads: BACKGROUND_THREADS * 2
      })
    try {
      try {
        await tryRun(upscaler)
      } catch (err) {
        // A provider the runtime cannot register is an error, never a silent
        // CPU run — so the retry on the CPU is the app's, and it says so.
        if (upscaler.provider !== 'Cpu' && /provider/i.test((err as Error).message)) {
          log.warn('enhance: accelerated provider unavailable, retrying on the CPU', err)
          this.send({
            key,
            phase: 'running',
            message: 'GPU provider unavailable — running on the CPU…'
          })
          await tryRun({ ...upscaler, provider: 'Cpu' })
        } else throw err
      }
      // The enhanced file starts with the source's look.
      const recipe = await this.library.recipe(key)
      recipe.geometry = { ...recipe.geometry, quarterTurns: 0, flipHorizontal: false }
      // A RAW's absolute white balance becomes the same white as relative
      // sliders: the enhanced file was developed with the as-shot white.
      if (raw && recipe.wb.mode === 'custom') {
        const op = baseWhite(recipe, { isRaw: true, asShot: info.as_shot_white })
        const rel = op ? relativeFromOp(op) : { temperature: 0, tint: 0 }
        recipe.wb = {
          mode: 'custom',
          temperature: Math.round(rel.temperature),
          tint: Math.round(rel.tint),
          preset: null
        }
      }
      await this.library.index.seedRecipe(out, recipe)
      await this.library.openFolder(dirname(row.path))
      this.send({ key, phase: 'done', message: `Wrote ${basename(out)}`, output: out })
    } catch (err) {
      log.warn('enhance failed', err)
      this.send({ key, phase: 'error', message: (err as Error).message })
    }
  }
}
