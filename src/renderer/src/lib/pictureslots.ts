/**
 * The loupe's two picture slots (views/loupe/DecodedImage.tsx): the picture
 * shown, and the one fading out over it. Each slot is one element, kept
 * across swaps: a swap at once draws the next picture into the shown slot
 * (a drag's frames go to one canvas), and a fade hands the shown slot, as
 * it is, to the fading picture and puts the next in the other.
 */
export interface PictureSlots {
  shown: string
  /** The picture fading out, or null. */
  prev: string | null
  /** The slot (0 or 1) `shown` is in; `prev` is in the other. */
  slot: 0 | 1
}

/** `src` shown next: faded across from what shows (`fade`), or in its place at once. */
export function swapPicture(s: PictureSlots, src: string, fade: boolean): PictureSlots {
  if (src === s.shown) return s
  if (!fade) return { shown: src, prev: null, slot: s.slot }
  return { shown: src, prev: s.shown, slot: s.slot === 0 ? 1 : 0 }
}

/** The fade has ended: the fading picture goes. */
export const fadeDone = (s: PictureSlots): PictureSlots =>
  s.prev === null ? s : { ...s, prev: null }

/** The React key of each slot. */
export const slotKey = (slot: 0 | 1): string => `slot${slot}`
