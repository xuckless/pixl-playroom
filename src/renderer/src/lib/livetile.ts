/**
 * A drag keeps the zoomed loupe sharp (views/loupe/SharpTile.tsx), a tile
 * at a time, while one takes no longer than this to make: a few sharp
 * pictures a second, a little behind the slider, rather than the draft
 * blown up (which shows no sharpening or noise reduction at 1:1). Slower,
 * the engine is left to the drag, and the tile comes back when it rests.
 */
export const LIVE_TILE_MS = 400

/** Whether a drag may ask for a tile now: the last one came quickly, and none is on its way. */
export const liveTiles = (lastMs: number, inFlight: boolean): boolean =>
  !inFlight && lastMs <= LIVE_TILE_MS
