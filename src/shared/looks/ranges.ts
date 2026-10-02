/**
 * What a look may set, and within what. The sliders' ranges live in the
 * panels' JSX; these are the same numbers, kept here so a look (ours, or
 * one read from a file) can be checked and clamped without the UI.
 */

/** Recipe roots a look may set: colour and tone, never the photo's own facts. */
export const LOOK_ALLOWED_ROOTS = [
  'basic',
  'presence',
  'toneCurve',
  'hsl',
  'bwMix',
  'colorGrade',
  'effects',
  'calibration',
  'treatment'
] as const

/**
 * Paths a look never sets even under an allowed root: exposure is the
 * photo's (a look that needs a darker picture says so with tone and curve).
 */
export const LOOK_FORBIDDEN_PATHS = ['basic.exposure']

const BIPOLAR: [number, number] = [-100, 100]
const UNIT: [number, number] = [0, 100]
const HUE: [number, number] = [0, 360]

/** Dotted path patterns (`*` is one segment) to [min, max]; the first match wins. */
export const LOOK_RANGES: [string, [number, number]][] = [
  ['basic.*', BIPOLAR],
  ['presence.*', BIPOLAR],
  ['toneCurve.highlights', BIPOLAR],
  ['toneCurve.lights', BIPOLAR],
  ['toneCurve.darks', BIPOLAR],
  ['toneCurve.shadows', BIPOLAR],
  ['toneCurve.refineSaturation', UNIT],
  ['hsl.*.*', BIPOLAR],
  ['bwMix.*', BIPOLAR],
  ['colorGrade.*.hue', HUE],
  ['colorGrade.*.saturation', UNIT],
  ['colorGrade.*.luminance', BIPOLAR],
  ['colorGrade.add.amount', UNIT],
  ['colorGrade.blending', UNIT],
  ['colorGrade.balance', BIPOLAR],
  ['effects.vignetteAmount', BIPOLAR],
  ['effects.vignetteRoundness', BIPOLAR],
  ['effects.vignetteMidpoint', UNIT],
  ['effects.vignetteFeather', UNIT],
  ['effects.vignetteHighlights', UNIT],
  ['effects.wash.hue', HUE],
  ['effects.wash.saturation', UNIT],
  ['effects.wash.amount', UNIT],
  ['effects.grainAmount', UNIT],
  ['effects.grainSize', UNIT],
  ['effects.grainRoughness', UNIT],
  ['calibration.*', BIPOLAR]
]

function matches(pattern: string, path: string[]): boolean {
  const parts = pattern.split('.')
  return parts.length === path.length && parts.every((p, i) => p === '*' || p === path[i])
}

/** The range a numeric field of a look must be in, or null when it is not a number we know. */
export function rangeOf(path: string[]): [number, number] | null {
  for (const [pattern, range] of LOOK_RANGES) if (matches(pattern, path)) return range
  return null
}

/** Whether a look may set this field at all. */
export function allowedPath(path: string[]): boolean {
  if (!(LOOK_ALLOWED_ROOTS as readonly string[]).includes(path[0])) return false
  return !LOOK_FORBIDDEN_PATHS.includes(path.join('.'))
}

/** The point curves a look may shape (whole arrays, as `changedFields` gives them). */
export const CURVE_PATHS = [
  'toneCurve.master',
  'toneCurve.red',
  'toneCurve.green',
  'toneCurve.blue'
]

/**
 * Words that belong to someone else: a camera maker, a film stock, a film.
 * A look's name never carries one; its `inspiredBy` and tags may. Plain
 * words that are also names (red, delta, venice) are left out: the test
 * reads whole words.
 */
export const BRAND_WORDS = [
  'fuji',
  'fujifilm',
  'fujicolor',
  'provia',
  'velvia',
  'astia',
  'acros',
  'eterna',
  'reala',
  'superia',
  'instax',
  'kodak',
  'kodachrome',
  'ektachrome',
  'ektar',
  'portra',
  'tri-x',
  'tmax',
  't-max',
  'vision3',
  'ilford',
  'hp5',
  'cinestill',
  'lomo',
  'lomography',
  'lomochrome',
  'agfa',
  'polaroid',
  'leica',
  'hasselblad',
  'canon',
  'nikon',
  'sony',
  'ricoh',
  'lumix',
  'panasonic',
  'olympus',
  'pentax',
  'iphone',
  'arri',
  'alexa',
  'blackmagic',
  'panavision',
  'technicolor',
  'batman',
  'gotham',
  'dune',
  'arrakis',
  'matrix',
  'odyssey',
  'joker',
  'barbie',
  'oppenheimer'
]
