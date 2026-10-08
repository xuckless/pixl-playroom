/**
 * The inpainter a Remove bakes with (MI-GAN 512, engine 0.18), as a filled
 * ref, set once the model store is up (app.ts): null while it is not
 * downloaded. Pixel baking asks for it here rather than owning the store.
 */
export const INPAINTER_MODEL = 'migan-512'

let source: (() => Promise<Record<string, unknown> | null>) | null = null

export function setInpainter(f: () => Promise<Record<string, unknown> | null>): void {
  source = f
}

/** MI-GAN's ref, or null when it is not downloaded (or the store is not up yet). */
export async function inpainterRef(): Promise<Record<string, unknown> | null> {
  return source ? source() : null
}
