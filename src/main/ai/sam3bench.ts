/**
 * SAM 3's sustained-load benchmark (shared/heavy.ts): a drawn picture read
 * three times back to back (each read a fresh embedding, the heavy part),
 * a phrase found on each, the AI engine's memory watched. Judged and kept
 * like Gemma's. While SAM 3 is held (E58) it is not offered.
 */
import { app } from 'electron'
import log from 'electron-log/main'
import { writeFile, rm } from 'fs/promises'
import { totalmem } from 'os'
import { join } from 'path'
import type { SamResult } from '../../shared/engine-types'
import { judgeSustained, type HeavyBenchmark, type SustainedRun } from '../../shared/heavy'
import { READ_LIMITS } from '../../shared/limits'
import { SAM3_PHRASE } from '../../shared/ai'
import type { EngineClient } from '../engine/client'
import { encodePng8 } from '../pngio'
import { paths } from '../paths'
import { BACKGROUND_THREADS } from '../source'
import type { ModelStore } from './models'
import type { AiSwitchStore } from './switches'

const RUNS = 3

/** The AI engine host's memory, MB (Electron's own count of its utility processes). */
function aiHostMb(): number {
  let mb = 0
  for (const m of app.getAppMetrics())
    if (m.type === 'Utility' && /ai/i.test(m.name ?? ''))
      mb = Math.max(mb, m.memory.workingSetSize / 1024)
  return Math.round(mb)
}

/** A drawn picture: sky, a field and a red car-like block (no photo, no one in it). */
function picture(): Buffer {
  const w = 1008
  const h = 672
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const sky = y < h * 0.55
      let [r, g, b] = sky ? [120, 170, 230] : [70, 130, 60]
      if (x > 380 && x < 640 && y > 400 && y < 500) [r, g, b] = [200, 30, 30]
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = 255
    }
  return encodePng8(px, w, h, 6)
}

export async function benchmarkSam3(
  engine: EngineClient,
  models: ModelStore,
  switches: AiSwitchStore,
  progress: (p: number, note: string) => void
): Promise<HeavyBenchmark> {
  if (!SAM3_PHRASE) throw new Error('SAM 3 is held back for now (it brings the engine down: E58)')
  if (!(await models.installed('sam3'))) throw new Error('Download SAM 3 first')
  const ref = (await models.ref('sam3', 'Cpu')) as {
    encoder: Record<string, unknown>
    text_encoder: Record<string, unknown>
    decoder: Record<string, unknown>
    segment: { min_score: number; max_instances: number; activation: string }
  }
  const file = join(paths.cacheRoot(), `sam3-bench-${process.pid}.png`)
  await writeFile(file, picture())
  const runs: SustainedRun[] = []
  let peak = 0
  const sampler = setInterval(() => (peak = Math.max(peak, aiHostMb())), 1000)
  let readyMs = 0
  try {
    if (engine.getStatus().status === 'starting') {
      engine.start()
      await engine.whenStarted()
    }
    for (let i = 0; i < RUNS; i++) {
      progress((i + 0.5) / RUNS, `Run ${i + 1} of ${RUNS}`)
      const t = Date.now()
      const r = (await engine.sam({
        op: 'concept',
        // A key of its own each run: a fresh embedding, the load being measured.
        key: `bench-${Date.now()}-${i}`,
        embed: {
          source: { Path: file },
          input: 'Png',
          raw: null,
          gain_map: null,
          orientation: 'Normal',
          lens: null,
          encoder: ref.encoder,
          guide: false,
          limits: READ_LIMITS,
          threads: BACKGROUND_THREADS
        },
        request: {
          text_encoder: ref.text_encoder,
          decoder: ref.decoder,
          prompt: { text: 'red car', exemplars: [] },
          min_score: ref.segment.min_score,
          max_instances: ref.segment.max_instances,
          activation: ref.segment.activation,
          upsample: { Resample: { kernel: 'Bilinear' } },
          bounds_at: null,
          png: { compression: 'Fast', filter: 'Sub' },
          threads: BACKGROUND_THREADS
        }
      })) as Extract<SamResult, { op: 'concept' }>
      if (i === 0) readyMs = r.embedMs
      runs.push({ ms: Date.now() - t })
      peak = Math.max(peak, aiHostMb())
    }
  } catch (err) {
    log.warn('sam3 benchmark stopped', (err as Error).message)
    runs.length = Math.min(runs.length, 1)
  } finally {
    clearInterval(sampler)
    await engine.sam({ op: 'release', embeddings: ['concept'] }).catch(() => undefined)
    await rm(file, { force: true })
  }
  const totalMb = Math.round(totalmem() / 1048576)
  const b: HeavyBenchmark = {
    model: 'sam3',
    at: new Date().toISOString(),
    machine: switches.machine,
    readyMs,
    runs,
    peakMb: peak,
    totalMb,
    ...judgeSustained('sam3', runs, peak, totalMb)
  }
  log.info('sam3 benchmark', JSON.stringify(b))
  await switches.recordBenchmark(b)
  progress(1, b.passed ? 'Passed' : 'Did not pass')
  return b
}
