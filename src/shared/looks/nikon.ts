/**
 * Picture Control looks, from neutral to the creative set, in the spirit of
 * Nikon's in-camera styles.
 */
import {
  bloom,
  collection,
  curve,
  gamma,
  grain,
  hsl,
  hueCurve,
  look,
  lumSat,
  matte,
  mono,
  offset,
  presence,
  prim,
  tone,
  vignette
} from './dsl'
import { tk } from '../i18n'

const pc = (name: string): string => `Nikon Picture Control ${name}`
const cpc = (name: string): string => `Nikon Creative Picture Control ${name}`

export const NIKON = collection('camera/nikon', [
  look(
    'crisp-standard',
    tk('Crisp Standard'),
    {
      tags: ['standard', 'everyday', 'nikon'],
      inspiredBy: pc('Standard'),
      description: tk('Balanced contrast with slightly yellow greens.'),
      version: 2
    },
    prim({ contrast: 1.08 }),
    tone({ blacks: -5 }),
    presence({ saturation: 10 }),
    offset(55, 4),
    hueCurve('hueHue', [
      [60, -2.4],
      [120, -3.6]
    ]),
    hueCurve('hueSat', [
      [60, 1.12],
      [120, 1.08]
    ]),
    hsl({ blue: [0, 0, -6] })
  ),
  look(
    'even-neutral',
    tk('Even Neutral'),
    {
      tags: ['neutral', 'flat', 'grading', 'nikon'],
      inspiredBy: pc('Neutral'),
      description: tk('Gentle contrast and colour to build on.'),
      version: 2
    },
    prim({ contrast: 0.91, sat: -10 })
  ),
  look(
    'bold-vivid',
    tk('Bold Vivid'),
    {
      tags: ['vivid', 'saturated', 'punchy', 'nikon'],
      inspiredBy: pc('Vivid'),
      description: tk('Strong contrast and saturated blues and greens.'),
      version: 2
    },
    prim({ contrast: 1.13, sat: 20 }),
    hueCurve('hueHue', [[60, -2.4]]),
    hueCurve('hueSat', [
      [60, 1.15],
      [120, 1.25],
      [240, 1.25]
    ]),
    hsl({ blue: [0, 0, -8] })
  ),
  look(
    'smooth-portrait',
    tk('Smooth Portrait'),
    {
      tags: ['portrait', 'skin', 'soft', 'nikon'],
      inspiredBy: pc('Portrait'),
      description: tk('Soft contrast and smooth, bright skin.'),
      version: 2
    },
    prim({ contrast: 0.95 }),
    tone({ shadows: 10 }),
    presence({ texture: -14, clarity: -6 }),
    offset(45, 7),
    hueCurve('hueHue', [[30, 1.2]]),
    hueCurve('hueSat', [
      [30, 0.94],
      [0, 0.92],
      [60, 0.94]
    ]),
    hsl({ orange: [0, 0, 9] })
  ),
  look(
    'open-landscape',
    tk('Open Landscape'),
    {
      tags: ['landscape', 'nature', 'green', 'blue', 'nikon'],
      inspiredBy: pc('Landscape'),
      description: tk('Rich greens and blues with extra punch.'),
      version: 2
    },
    prim({ contrast: 1.11 }),
    tone({ highlights: -10 }),
    presence({ vibrance: 15, clarity: 10 }),
    hueCurve('hueHue', [[60, -3]]),
    hueCurve('hueSat', [
      [60, 1.2],
      [120, 1.3],
      [240, 1.3],
      [180, 1.2]
    ]),
    hsl({ green: [0, 0, -5], blue: [0, 0, -12] })
  ),
  look(
    'log-flat',
    tk('Log Flat'),
    {
      tags: ['flat', 'log', 'grading', 'dynamic range', 'nikon'],
      inspiredBy: pc('Flat'),
      description: tk('As much range as possible, ready to grade.'),
      version: 2
    },
    prim({ contrast: 0.76, sat: -20 }),
    tone({ shadows: 30, highlights: -30 })
  ),
  look(
    'rich-tone-portrait',
    tk('Rich Tone Portrait'),
    {
      tags: ['portrait', 'skin', 'rich', 'zf', 'nikon'],
      inspiredBy: pc('Rich Tone Portrait'),
      description: tk('Deep, saturated skin with soft highlights.'),
      version: 2
    },
    prim({ contrast: 1.05 }),
    tone({ highlights: -20, shadows: 6 }),
    presence({ vibrance: 14, texture: -8 }),
    gamma(25, 8),
    hueCurve('hueHue', [[30, -0.9]]),
    hueCurve('hueSat', [
      [30, 1.14],
      [0, 1.1],
      [60, 0.94]
    ]),
    hsl({ orange: [0, 0, -6], red: [0, 0, -4] })
  ),
  look(
    'soft-gradation-mono',
    tk('Soft Gradation Mono'),
    {
      tags: ['bw', 'mono', 'soft', 'flat', 'warm', 'nikon'],
      inspiredBy: pc('Flat Monochrome'),
      description: tk('A gentle, slightly warm monochrome with open tones.'),
      version: 2
    },
    mono(),
    prim({ contrast: 0.85 }),
    tone({ shadows: 10 }),
    matte(0.03),
    offset(40, 8)
  ),
  look(
    'deep-tone-mono',
    tk('Deep Tone Mono'),
    {
      tags: ['bw', 'mono', 'deep', 'dramatic', 'nikon'],
      inspiredBy: pc('Deep Tone Monochrome'),
      description: tk('Heavy shadows and strong contrast.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.21 }),
    tone({ shadows: -25 }),
    presence({ clarity: 10 })
  ),
  look(
    'simple-mono',
    tk('Simple Mono'),
    {
      tags: ['bw', 'mono', 'nikon'],
      inspiredBy: pc('Monochrome'),
      description: tk('A plain black and white with a little bite.')
    },
    // Open mids and a yellow lean, the plain Monochrome control.
    mono({ yellow: 12, orange: 6, blue: -6 }),
    tone({ highlights: -18, shadows: 14 })
  ),
  look(
    'dream',
    tk('Dream'),
    {
      tags: ['dreamy', 'soft', 'pastel', 'creative', 'nikon'],
      inspiredBy: cpc('Dream'),
      description: tk('Pale orange haze and softened detail.'),
      version: 3
    },
    prim({ contrast: 0.91 }),
    tone({ shadows: 24 }),
    offset(35, 15),
    bloom(45, { warmth: 30 })
  ),
  look(
    'morning',
    tk('Morning'),
    {
      tags: ['morning', 'cool', 'fresh', 'creative', 'nikon'],
      inspiredBy: cpc('Morning'),
      description: tk('Fresh, cool and bright, like early light.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    tone({ shadows: 20, whites: 10 }),
    presence({ saturation: -5 }),
    offset(210, 12)
  ),
  look(
    'pop',
    tk('Pop'),
    {
      tags: ['pop', 'saturated', 'bright', 'creative', 'nikon'],
      inspiredBy: cpc('Pop'),
      description: tk('Bright and loudly colourful.'),
      version: 2
    },
    prim({ contrast: 1.06, sat: 45 }),
    tone({ whites: 10 })
  ),
  look(
    'sunday',
    tk('Sunday'),
    {
      tags: ['warm', 'relaxed', 'bright', 'creative', 'nikon'],
      inspiredBy: cpc('Sunday'),
      description: tk('Warm, bright and easy-going.'),
      version: 2
    },
    tone({ shadows: 15, whites: 10 }),
    presence({ saturation: 10 }),
    offset(45, 10)
  ),
  look(
    'somber',
    tk('Somber'),
    {
      tags: ['somber', 'muted', 'dark', 'cool', 'creative', 'nikon'],
      inspiredBy: cpc('Somber'),
      description: tk('Dim, muted and cool.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    tone({ whites: -15, highlights: -10 }),
    presence({ saturation: -35 }),
    offset(210, 10)
  ),
  look(
    'dramatic',
    tk('Dramatic'),
    {
      tags: ['dramatic', 'contrast', 'clarity', 'creative', 'nikon'],
      inspiredBy: cpc('Dramatic'),
      description: tk('Hard local contrast and drained colour.'),
      version: 2
    },
    prim({ contrast: 1.18, sat: -15 }),
    tone({ whites: 20 }),
    presence({ clarity: 35 })
  ),
  look(
    'silence',
    tk('Silence'),
    {
      tags: ['quiet', 'muted', 'faded', 'cool', 'creative', 'nikon'],
      inspiredBy: cpc('Silence'),
      description: tk('Faded, cool and nearly colourless.'),
      version: 2
    },
    prim({ contrast: 0.91 }),
    matte(0.04),
    presence({ saturation: -45 }),
    offset(195, 10)
  ),
  look(
    'bleached',
    tk('Bleached'),
    {
      tags: ['bleached', 'desaturated', 'gritty', 'creative', 'nikon'],
      inspiredBy: cpc('Bleached'),
      description: tk('Hard contrast, washed colour and a faint green.'),
      version: 2
    },
    prim({ contrast: 1.18 }),
    presence({ saturation: -50, clarity: 15 }),
    offset(130, 12),
    // Silver left in: the ends lose colour first.
    lumSat([
      [0, 0.7],
      [0.35, 1],
      [0.65, 1],
      [1, 0.7]
    ])
  ),
  look(
    'melancholic',
    tk('Melancholic'),
    {
      tags: ['melancholy', 'faded', 'magenta', 'mood', 'creative', 'nikon'],
      inspiredBy: cpc('Melancholic'),
      description: tk('Faded, muted colour with a magenta sigh.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    matte(0.04),
    presence({ saturation: -25 }),
    offset(320, 12)
  ),
  look(
    'pure',
    tk('Pure'),
    {
      tags: ['pure', 'bright', 'airy', 'soft', 'creative', 'nikon'],
      inspiredBy: cpc('Pure'),
      description: tk('Bright, airy and veiled.'),
      version: 3
    },
    prim({ contrast: 0.85, sat: -10 }),
    tone({ shadows: 26, whites: 15 }),
    matte(0.05),
    bloom(35)
  ),
  look(
    'denim',
    tk('Denim'),
    {
      tags: ['denim', 'blue', 'cool', 'creative', 'nikon'],
      inspiredBy: cpc('Denim'),
      description: tk('Washed indigo over everything.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -20 }),
    offset(225, 35),
    hueCurve('hueSat', [[240, 1.2]])
  ),
  look(
    'toy',
    tk('Toy'),
    {
      tags: ['toy camera', 'lomo', 'vignette', 'saturated', 'creative', 'nikon'],
      inspiredBy: cpc('Toy'),
      description: tk('Heavy corners and loud, yellowed colour.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    presence({ saturation: 20 }),
    offset(55, 12),
    vignette(-50, { feather: 45 })
  ),
  look(
    'sepia-colour',
    tk('Sepia Colour'),
    {
      tags: ['sepia', 'faded', 'vintage', 'creative', 'nikon'],
      inspiredBy: cpc('Sepia'),
      description: tk('A trace of colour under a brown tone.'),
      version: 2
    },
    matte(0.03),
    presence({ saturation: -70 }),
    offset(35, 25)
  ),
  look(
    'blue-wash',
    tk('Blue Wash'),
    {
      tags: ['blue', 'tinted', 'monochromatic', 'creative', 'nikon'],
      inspiredBy: cpc('Blue'),
      description: tk('Colour drained, then tinted blue.'),
      version: 2
    },
    presence({ saturation: -60 }),
    offset(215, 30)
  ),
  look(
    'red-wash',
    tk('Red Wash'),
    {
      tags: ['red', 'tinted', 'monochromatic', 'creative', 'nikon'],
      inspiredBy: cpc('Red'),
      description: tk('Colour drained, then tinted red.'),
      version: 2
    },
    presence({ saturation: -60 }),
    offset(5, 30)
  ),
  look(
    'pink-wash',
    tk('Pink Wash'),
    {
      tags: ['pink', 'tinted', 'monochromatic', 'creative', 'nikon'],
      inspiredBy: cpc('Pink'),
      description: tk('Colour drained, then tinted pink.'),
      version: 2
    },
    presence({ saturation: -55 }),
    offset(335, 25)
  ),
  look(
    'charcoal',
    tk('Charcoal'),
    {
      tags: ['bw', 'mono', 'charcoal', 'textured', 'creative', 'nikon'],
      inspiredBy: cpc('Charcoal'),
      description: tk('A smudged, textured mono like a charcoal drawing.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.06 }),
    tone({ whites: -20, highlights: -15, shadows: -15 }),
    matte(0.07),
    presence({ texture: 25, clarity: -10 }),
    grain(20, 35, 70)
  ),
  look(
    'graphite',
    tk('Graphite'),
    {
      tags: ['bw', 'mono', 'graphite', 'crisp', 'creative', 'nikon'],
      inspiredBy: cpc('Graphite'),
      description: tk('A hard, cool pencil-sharp mono.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.15 }),
    presence({ clarity: 30 }),
    offset(220, 5)
  ),
  look(
    'binary',
    tk('Binary'),
    {
      tags: ['bw', 'mono', 'graphic', 'two tone', 'creative', 'nikon'],
      inspiredBy: cpc('Binary'),
      description: tk('Nearly pure black and pure white.')
    },
    mono(),
    curve('master', [
      [0, 0],
      [0.4, 0.06],
      [0.6, 0.94],
      [1, 1]
    ])
  ),
  look(
    'carbon',
    tk('Carbon'),
    {
      tags: ['bw', 'mono', 'low key', 'dark', 'creative', 'nikon'],
      inspiredBy: cpc('Carbon'),
      description: tk('A dark, low-key mono with deep blacks.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.18 }),
    tone({ whites: -20, shadows: -15, blacks: -10 })
  )
])
