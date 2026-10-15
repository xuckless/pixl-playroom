/**
 * What names things on disk, checked before a name read from a file a user
 * was given (a sidecar, a `.pixl` project, a collections file) goes into a
 * path. Recipes and projects travel with their folders and are readable by
 * anyone, so every name they carry is untrusted until it passes here.
 *
 * Pure, for tests/security.test.ts.
 */
const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Whether `s` is a SHA-256 digest in lower-case hex: how painted planes (a
 * brush component's `ref`) and blobs (an embedded original, a pixel step's
 * image) are named. Older builds named a plane by a 32-bit hash; those
 * names are rewritten when their store is opened, before a recipe is read.
 */
export const isPlaneHash = (s: unknown): s is string => typeof s === 'string' && SHA256_HEX.test(s)

/** A blob's name: the SHA-256 of its bytes, as a plane's is. */
export const isBlobHash = isPlaneHash

/** The ids Playroom makes (`newId`) and any it may meet: letters, digits, `_` and `-`. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isSafeId = (s: unknown): s is string => typeof s === 'string' && SAFE_ID.test(s)

/**
 * A layer's, component's or point colour's id as it may be used: as it is
 * when safe, else one made from it (the same every time it is read, so a
 * thumbnail's signature and the history keep still), else null for none.
 */
export function safeIdOf(v: unknown): string | null {
  if (isSafeId(v)) return v
  if (typeof v !== 'string' || v === '') return null
  // FNV-1a, as recipe.ts's hash32 (not imported: recipe.ts imports this).
  let h = 0x811c9dc5
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `id-${(h >>> 0).toString(36)}`
}

/**
 * A file's extension as the library keeps it (lower case, no dot) when it is
 * one that cannot reach outside a folder: letters and digits only.
 */
export const isPlainExt = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-z0-9]{1,5}$/.test(s)

/**
 * Whether `name` is a bare file name: no folder in it (either separator), not
 * `.` or `..`, no NUL, and not empty.
 */
export function isBareName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/\0]/.test(name)
  )
}
