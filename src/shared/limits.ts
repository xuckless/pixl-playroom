import type { Limits } from './engine-types'

/**
 * What a decode may allocate (engine 0.17): without it a forged header can ask
 * for tens of gigabytes. Set on every request that reads a user's file; a
 * picture past it is refused from its header, before its pixels exist. Roomy
 * enough for medium-format RAW (150 MP) and big stitched panoramas.
 */
export const READ_LIMITS: Limits = { max_pixels: 600_000_000, max_side: 65_535 }
