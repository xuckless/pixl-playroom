/**
 * The display a picture is rendered for (engine 0.18, `Ceiling::Display`):
 * its SDR white and peak in cd/m², which the engine never reads itself.
 * Pure, for tests/hdrdisplay.test.ts; main/hdrdisplay.ts reads the screen.
 */

/** BT.2408's reference white: where `white_nits` sits when only the headroom is known. */
export const REFERENCE_WHITE = 203

/** Under this much headroom the screen shows SDR (the engine refuses peak ≤ white). */
export const MIN_HEADROOM = 1.05

export interface DisplayHdr {
  /** The screen can show light above SDR white now. */
  hdr: boolean
  whiteNits: number
  peakNits: number
  /** peak / white. */
  headroom: number
  /** The most this screen can reach (macOS's potential EDR), when known. */
  potential: number | null
  /** Where the numbers came from: the screen (macOS), the user, or nowhere (SDR assumed). */
  source: 'screen' | 'stated' | 'none'
}

/** What the user set in Preferences → Display. */
export interface DisplayHdrSetting {
  mode: 'auto' | 'stated'
  whiteNits: number
  peakNits: number
}

export const DEFAULT_DISPLAY_SETTING: DisplayHdrSetting = {
  mode: 'auto',
  whiteNits: REFERENCE_WHITE,
  peakNits: 1000
}

const num = (v: unknown, def: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def

/** A stored setting, held to what a display can be (white 80–500, peak 100–10 000). */
export function normaliseDisplaySetting(v: unknown): DisplayHdrSetting {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const whiteNits = num(o.whiteNits, REFERENCE_WHITE, 80, 500)
  return {
    mode: o.mode === 'stated' ? 'stated' : 'auto',
    whiteNits,
    peakNits: num(o.peakNits, 1000, 100, 10000)
  }
}

/**
 * The display's numbers: stated ones when the user set them; else the
 * screen's EDR headroom (`white 203, peak 203 · H`, the engine's recipe for
 * macOS); else SDR.
 */
export function resolveDisplay(
  setting: DisplayHdrSetting,
  screen: { current: number; potential: number } | null
): DisplayHdr {
  if (setting.mode === 'stated') {
    const headroom = setting.peakNits / setting.whiteNits
    return {
      hdr: headroom >= MIN_HEADROOM,
      whiteNits: setting.whiteNits,
      peakNits: setting.peakNits,
      headroom: round(headroom),
      potential: null,
      source: 'stated'
    }
  }
  if (screen && Number.isFinite(screen.current) && screen.current > 0) {
    const headroom = round(Math.max(1, screen.current))
    return {
      hdr: headroom >= MIN_HEADROOM,
      whiteNits: REFERENCE_WHITE,
      peakNits: round(REFERENCE_WHITE * headroom),
      headroom,
      potential: Number.isFinite(screen.potential) ? round(screen.potential) : null,
      source: 'screen'
    }
  }
  return {
    hdr: false,
    whiteNits: REFERENCE_WHITE,
    peakNits: REFERENCE_WHITE,
    headroom: 1,
    potential: null,
    source: 'none'
  }
}

const round = (v: number): number => Math.round(v * 100) / 100

/** Whether two readings differ enough to render again (the headroom moves in small steps). */
export function displayChanged(a: DisplayHdr | null, b: DisplayHdr): boolean {
  return (
    !a ||
    a.hdr !== b.hdr ||
    a.source !== b.source ||
    Math.abs(a.headroom - b.headroom) >= 0.05 ||
    a.whiteNits !== b.whiteNits
  )
}

/** Whether this display can show Full HDR at all: headroom now, or (a Mac) headroom it can reach. */
export function canShowHdr(display: DisplayHdr | null): boolean {
  return !!display && (display.hdr || (display.potential ?? 0) >= MIN_HEADROOM)
}

/**
 * Asked for while macOS has not raised the headroom yet: it does only while
 * a window shows extended-range content, so the first HDR frame asks for
 * this much (or the screen's potential, if less), and the next reading
 * (main/hdrdisplay.ts, every 2 s) brings the real number.
 */
export const BOOTSTRAP_HEADROOM = 2

/**
 * A read headroom in quarter stops, rounded down (never past what the screen
 * shows): macOS moves a MacBook's headroom with its brightness all the time,
 * and a render is made again only when it moves a step.
 */
export const HEADROOM_STEP_STOPS = 0.25

export function steppedHeadroom(h: number): number {
  const steps = Math.floor(Math.log2(Math.max(1, h)) / HEADROOM_STEP_STOPS + 1e-9)
  return 2 ** (steps * HEADROOM_STEP_STOPS)
}

/** What a render is made for: the display's numbers while Full HDR is on and it can show HDR. */
export function renderDisplay(
  fullHdr: boolean,
  display: DisplayHdr | null
): { whiteNits: number; peakNits: number } | null {
  if (!fullHdr || !display || !canShowHdr(display)) return null
  // Stated numbers are the owner's, as given; a screen's reading in steps.
  if (display.hdr && display.source === 'stated')
    return { whiteNits: display.whiteNits, peakNits: display.peakNits }
  if (display.hdr) {
    const h = steppedHeadroom(display.headroom)
    if (h >= MIN_HEADROOM)
      return { whiteNits: display.whiteNits, peakNits: Math.round(display.whiteNits * h) }
  }
  const h = Math.min(BOOTSTRAP_HEADROOM, display.potential ?? BOOTSTRAP_HEADROOM)
  return { whiteNits: display.whiteNits, peakNits: Math.round(display.whiteNits * h) }
}
