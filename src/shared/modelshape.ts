/**
 * Models run on CoreML with their shape fixed (engine 0.19, integration
 * guide §4): with free H × W, CoreML splits a graph like NAFNet into dozens
 * of partitions and leaves the rest on the CPU, slower than the CPU alone;
 * with H × W fixed to a tile it takes the whole graph onto the GPU, about 9×
 * the best CPU (NAFNet SIDD: a 24 MP denoise in 15.2 s against 96.8 s on an
 * M2 Pro). The session fixes the roster's dimension names to the tile, and
 * the model is tiled `Fixed` at the same size. On the CPU (or DirectML),
 * nothing changes.
 */
import type { ExecutionProvider, ModelInput, SessionSpec } from './engine-types'

export interface StaticTile {
  size: number
  overlap: number
}

/** The models Playroom runs with static shapes, and their tiles. */
export const STATIC_TILE: Readonly<Record<string, StaticTile>> = {
  'nafnet-sidd-w32': { size: 512, overlap: 32 },
  'nafnet-gopro-w32': { size: 512, overlap: 32 },
  // A tile starts on the filter's period (the roster's `Fixed`): 2 × 2 Bayer, 6 × 6 X-Trans.
  'demosaicnet-bayer': { size: 512, overlap: 32 },
  'demosaicnet-xtrans': { size: 516, overlap: 36 },
  // PIXL's own demosaic (a development kit's roster; shared/pixldemosaic.ts), at its
  // roster's `Fixed` 576: a 25 MP Bayer frame in 8.6 s on an M2 Pro, 16 MP X-Trans 7.3 s.
  'pixl-demosaic-v1-bayer': { size: 576, overlap: 32 },
  'pixl-demosaic-v1-xtrans': { size: 576, overlap: 48 },
  // PIXL Enhance (shared/pixlenhance.ts) at 1024: a 12 MP HEIC at level 1 in
  // 8.1 s on an M2 Pro. The overlap is its level's (the roster's `levels`:
  // 128, or 256 for level 2, whose reach is wider); main/enhance.ts sets it.
  'pixl-enhance-v1': { size: 1024, overlap: 128 },
  // A multiple of its 32 (the roster's Dynamic tiling): 0.56 s for a 24 MP mosaic, 3.3 s on the CPU.
  pmrid: { size: 512, overlap: 32 }
}

/** The dimension names a static tile fixes; a graph with any other free one keeps its dynamic shape. */
const TILE_DIMS = new Set(['height', 'width'])

export interface StaticPlan {
  provider: ExecutionProvider
  dimensions: SessionSpec['dimensions']
  tiling: ModelInput
}

/**
 * How `id` runs with its shape fixed on `provider`, or null when it runs as
 * it is: not a static model, not on CoreML, or a graph whose free dimensions
 * (the roster's `files[i].dimensions`) aren't just height and width.
 */
export function staticPlan(
  id: string,
  dims: readonly string[],
  provider: ExecutionProvider
): StaticPlan | null {
  const tile = STATIC_TILE[id]
  if (!tile || typeof provider !== 'object' || !('CoreMl' in provider)) return null
  if (dims.length === 0 || dims.some((d) => !TILE_DIMS.has(d))) return null
  return {
    // The GPU: the Neural Engine alone measured 3–5× slower on NAFNet.
    provider: {
      CoreMl: {
        ...provider.CoreMl,
        units: 'CpuAndGpu',
        format: 'MlProgram',
        static_shapes: true
      }
    },
    dimensions: dims.map((name) => ({ name, value: tile.size })),
    tiling: { Fixed: { width: tile.size, height: tile.size, overlap: tile.overlap } }
  }
}

/**
 * Whether an error is the accelerator's own (a model it would not load, a
 * provider it could not register), so the CPU is worth a try (the store's
 * `withCpuFallback`). A request the engine refuses for anything else is
 * refused the same on the CPU: the PIXL demosaic on an X-Trans mosaic is
 * `InvalidRequest`, field `raw.demosaic.noise.noise`, in 20 ms, and must
 * not move a model to the CPU for the session.
 */
export function acceleratorTrouble(err: unknown): boolean {
  const e = err as { message?: unknown; code?: unknown; field?: unknown } | null
  if (e?.code === 'InvalidRequest' && typeof e.field === 'string' && !/provider/i.test(e.field))
    return false
  return /load-model|provider/i.test(String(e?.message))
}
