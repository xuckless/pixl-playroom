/**
 * Painted brush planes, kept once by reference. The renderer holds recipes
 * whose brush components name a plane (`ref`) instead of carrying its PNG,
 * so a slider drag sends kilobytes, not the masks, and the edit history
 * stores each plane once. Every recipe coming in is hydrated here before
 * anything renders or saves it; sidecars always get the PNGs themselves.
 */
import { hasPlane, type Recipe } from '../shared/recipe'
import { slim } from './planeref'
import type { IndexClient } from './indexer/client'

/**
 * Planes kept in memory, by size: a photo with many brush masks keeps them
 * all through a drag (a count would let them miss on every update), and a
 * few huge ones cannot hold the process's memory. The rest are a query away.
 */
const KEEP_BYTES = 192 * 1024 * 1024

export class PlaneStore {
  private mem = new Map<string, string>()
  private bytes = 0

  constructor(private readonly index: IndexClient) {}

  /** Kept at once; the index is told in passing (it answers in order, so a later `get` finds it). */
  put(ref: string, png: string): void {
    if (this.mem.has(ref)) {
      this.remember(ref, png)
      return
    }
    this.index.putPlane(ref, png).catch(() => {})
    this.remember(ref, png)
  }

  async get(ref: string): Promise<string | undefined> {
    const hit = this.mem.get(ref)
    if (hit !== undefined) {
      // Used again: the last to go.
      this.mem.delete(ref)
      this.mem.set(ref, hit)
      return hit
    }
    const png = await this.index.plane(ref)
    if (png !== undefined) this.remember(ref, png)
    return png
  }

  private remember(ref: string, png: string): void {
    const was = this.mem.get(ref)
    if (was !== undefined) this.bytes -= was.length
    this.mem.delete(ref)
    this.mem.set(ref, png)
    this.bytes += png.length
    // The least recently used go first; the one just kept stays, whatever its size.
    for (const [k, v] of this.mem) {
      if (this.bytes <= KEEP_BYTES || k === ref) break
      this.mem.delete(k)
      this.bytes -= v.length
    }
  }

  /** Going out: planes by reference (and kept, so they can come back). */
  slim(recipe: Recipe): Recipe {
    return slim(recipe, (ref, png) => this.put(ref, png))
  }

  /**
   * Coming in: every referenced plane filled in. The reference stays beside
   * it (it is the plane's content hash): what names a plane by it, a plane
   * file or a slim copy going out again, need not hash the PNG.
   */
  async hydrate(recipe: Recipe): Promise<Recipe> {
    const wants = recipe.layers.some((l) =>
      l.components.some((c) => hasPlane(c) && !c.png && c.ref)
    )
    if (!wants) return recipe
    return {
      ...recipe,
      layers: await Promise.all(
        recipe.layers.map(async (l) => ({
          ...l,
          components: await Promise.all(
            l.components.map(async (c) => {
              if (!hasPlane(c) || c.png || !c.ref) return c
              const png = await this.get(c.ref)
              if (png === undefined)
                throw new Error('a painted mask is missing from the plane store')
              return { ...c, png }
            })
          )
        }))
      )
    }
  }
}
