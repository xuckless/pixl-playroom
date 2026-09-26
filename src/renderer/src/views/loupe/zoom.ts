/**
 * The loupe's zoom for callers outside it: the keys, the toolbar. The loupe
 * registers what turns a zoom into a view (its box and the picture's size)
 * and where the pointer last was; these act on the develop store.
 */
import { FIT, zoomAt, zoomTo, type P, type Viewport } from '../../../../shared/view'
import { useDevelop } from '../../state/develop'

/** One press of ⌘+ / ⌘−. */
const STEP = 1.5

let viewport: Viewport | null = null
let pointer: P | null = null
let loupe: HTMLElement | null = null
let space = false

export function setViewport(v: Viewport | null): void {
  viewport = v
}

export function setPointer(p: P | null): void {
  pointer = p
}

export function setLoupeElement(el: HTMLElement | null): void {
  loupe = el
  if (loupe) loupe.toggleAttribute('data-pan', space)
}

/** Space held: a drag anywhere on the picture pans. */
export function setSpace(down: boolean): void {
  space = down
  loupe?.toggleAttribute('data-pan', down)
}

export function spaceHeld(): boolean {
  return space
}

const centre = (v: Viewport): P => ({ x: v.box.w / 2, y: v.box.h / 2 })

function apply(make: (v: Viewport) => ReturnType<typeof zoomAt>): void {
  const d = useDevelop.getState()
  if (!viewport || !d.session || d.tool === 'crop') return
  d.setZoom(make(viewport))
}

export const loupeZoom = {
  /** Fit ↔ 100%, about a point of the loupe (default: where the pointer was). */
  toggle(at?: P): void {
    apply((v) =>
      useDevelop.getState().zoom.scale === 'fit'
        ? zoomTo(v, FIT, 1, at ?? pointer ?? centre(v))
        : FIT
    )
  },
  in(): void {
    apply((v) => zoomAt(v, useDevelop.getState().zoom, STEP, pointer ?? centre(v)))
  },
  out(): void {
    apply((v) => zoomAt(v, useDevelop.getState().zoom, 1 / STEP, pointer ?? centre(v)))
  },
  fit(): void {
    apply(() => FIT)
  }
}
