/**
 * What names a painted plane: the SHA-256 of its PNG's bytes, hex. Planes are
 * kept by it (the index's `plane_blobs`, a project's `blobs`) and recipes name
 * them by it (a brush component's `ref`), so two different planes never
 * share a name. Older builds named a plane by a 32-bit hash and the length
 * of its base64 text; those names are rewritten when their store is opened.
 */
import { createHash } from 'crypto'
import { slimRecipe, type Recipe } from '../shared/recipe'

export function planeRef(png: string): string {
  return createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex')
}

/** Whether `ref` is a plane's name now (not an older build's). */
export const isPlaneHash = (ref: string): boolean => /^[0-9a-f]{64}$/.test(ref)

/** The recipe with its planes by reference (see `slimRecipe`), named by `planeRef`. */
export function slim(r: Recipe, known?: (ref: string, png: string) => void): Recipe {
  return slimRecipe(r, planeRef, known)
}

/** A PNG's pixel size from its header, or null when it is not one. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}

/**
 * `json` with every `"ref":"<old>"` the map names renamed: how stored
 * recipes, snapshots and history follow their planes to their new names.
 */
export function renameRefs(json: string, names: Map<string, string>): string {
  if (names.size === 0 || !json.includes('"ref":"')) return json
  return json.replace(/"ref":"([^"]+)"/g, (whole, ref: string) => {
    const to = names.get(ref)
    return to ? `"ref":"${to}"` : whole
  })
}
