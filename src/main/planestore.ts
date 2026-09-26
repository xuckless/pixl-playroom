/**
 * Painted brush planes, kept once by reference. The renderer holds recipes
 * whose brush components name a plane (`ref`) instead of carrying its PNG,
 * so a slider drag sends kilobytes, not the masks, and the edit history
 * stores each plane once. Every recipe coming in is hydrated here before
 * anything renders or saves it; sidecars always get the PNGs themselves.
 */
import { slimRecipe, type Recipe } from '../shared/recipe'
import type { IndexClient } from './indexer/client'

/** Planes kept in memory; the rest are a query away. */
const KEEP = 48

export class PlaneStore {
  private mem = new Map<string, string>()

  constructor(private readonly index: IndexClient) {}

  /** Kept at once; the index is told in passing (it answers in order, so a later `get` finds it). */
  put(ref: string, png: string): void {
    if (this.mem.has(ref)) {
      this.mem.delete(ref)
      this.mem.set(ref, png)
      return
    }
    this.index.putPlane(ref, png).catch(() => {})
    this.remember(ref, png)
  }

  async get(ref: string): Promise<string | undefined> {
    const hit = this.mem.get(ref)
    if (hit !== undefined) return hit
    const png = await this.index.plane(ref)
    if (png !== undefined) this.remember(ref, png)
    return png
  }

  private remember(ref: string, png: string): void {
    this.mem.set(ref, png)
    if (this.mem.size > KEEP) this.mem.delete(this.mem.keys().next().value as string)
  }

  /** Going out: planes by reference (and kept, so they can come back). */
  slim(recipe: Recipe): Recipe {
    return slimRecipe(recipe, (ref, png) => this.put(ref, png))
  }

  /** Coming in: every referenced plane filled in, the references dropped. */
  async hydrate(recipe: Recipe): Promise<Recipe> {
    const wants = recipe.layers.some((l) =>
      l.components.some((c) => c.kind === 'brush' && !c.png && c.ref)
    )
    if (!wants) return recipe
    return {
      ...recipe,
      layers: await Promise.all(
        recipe.layers.map(async (l) => ({
          ...l,
          components: await Promise.all(
            l.components.map(async (c) => {
              if (c.kind !== 'brush' || c.png || !c.ref) return c
              const png = await this.get(c.ref)
              if (png === undefined)
                throw new Error('a painted mask is missing from the plane store')
              const { ref: _ref, ...rest } = c
              void _ref
              return { ...rest, png }
            })
          )
        }))
      )
    }
  }
}
