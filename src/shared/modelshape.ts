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
  'nafnet-gopro-w32': { size: 512, overlap: 32 }
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
