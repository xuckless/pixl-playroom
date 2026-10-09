/**
 * Picture Control looks, from neutral to the creative set, in the spirit of
 * Nikon's in-camera styles.
 */
import {
  bloomApprox,
  collection,
  curve,
  fade,
  grain,
  hsl,
  look,
  mono,
  presence,
  tone,
  vignette,
  wheel
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
      description: tk('Balanced contrast with slightly yellow greens.')
    },
    tone({ contrast: 14, blacks: -5 }),
    presence({ saturation: 10 }),
    wheel('global', 55, 4),
    hsl({ yellow: [-8, 12, 0], green: [-12, 8, 0], blue: [0, 0, -6] })
  ),
  look(
    'even-neutral',
    tk('Even Neutral'),
    {
      tags: ['neutral', 'flat', 'grading', 'nikon'],
      inspiredBy: pc('Neutral'),
      description: tk('Gentle contrast and colour to build on.')
    },
    tone({ contrast: -15 }),
    presence({ saturation: -10 })
  ),
  look(
    'bold-vivid',
    tk('Bold Vivid'),
    {
      tags: ['vivid', 'saturated', 'punchy', 'nikon'],
      inspiredBy: pc('Vivid'),
      description: tk('Strong contrast and saturated blues and greens.')
    },
    tone({ contrast: 22 }),
    presence({ saturation: 20 }),
    hsl({ yellow: [-8, 15, 0], green: [0, 25, 0], blue: [0, 25, -8] })
  ),
  look(
    'smooth-portrait',
    tk('Smooth Portrait'),
    {
      tags: ['portrait', 'skin', 'soft', 'nikon'],
      inspiredBy: pc('Portrait'),
      description: tk('Soft contrast and smooth, bright skin.')
    },
    tone({ contrast: -8, shadows: 10 }),
    presence({ texture: -14, clarity: -6 }),
    wheel('global', 45, 7),
    hsl({ orange: [4, -6, 9], red: [0, -8, 0], yellow: [0, -6, 0] })
  ),
  look(
    'open-landscape',
    tk('Open Landscape'),
    {
      tags: ['landscape', 'nature', 'green', 'blue', 'nikon'],
      inspiredBy: pc('Landscape'),
      description: tk('Rich greens and blues with extra punch.')
    },
    tone({ contrast: 18, highlights: -10 }),
    presence({ vibrance: 15, clarity: 10 }),
    hsl({ yellow: [-10, 20, 0], green: [0, 30, -5], blue: [0, 30, -12], aqua: [0, 20, 0] })
  ),
  look(
    'log-flat',
    tk('Log Flat'),
    {
      tags: ['flat', 'log', 'grading', 'dynamic range', 'nikon'],
      inspiredBy: pc('Flat'),
      description: tk('As much range as possible, ready to grade.')
    },
    tone({ contrast: -40, shadows: 30, highlights: -30 }),
    presence({ saturation: -20 })
  ),
  look(
    'rich-tone-portrait',
    tk('Rich Tone Portrait'),
    {
      tags: ['portrait', 'skin', 'rich', 'zf', 'nikon'],
      inspiredBy: pc('Rich Tone Portrait'),
      description: tk('Deep, saturated skin with soft highlights.')
    },
    tone({ contrast: 8, highlights: -20, shadows: 6 }),
    presence({ vibrance: 14, texture: -8 }),
    wheel('midtones', 25, 8),
    hsl({ orange: [-3, 14, -6], red: [0, 10, -4], yellow: [0, -6, 0] })
  ),
  look(
    'soft-gradation-mono',
    tk('Soft Gradation Mono'),
    {
      tags: ['bw', 'mono', 'soft', 'flat', 'warm', 'nikon'],
      inspiredBy: pc('Flat Monochrome'),
      description: tk('A gentle, slightly warm monochrome with open tones.')
    },
    mono(),
    tone({ contrast: -25, shadows: 10 }),
    fade(0.03),
    wheel('global', 40, 8)
  ),
  look(
    'deep-tone-mono',
    tk('Deep Tone Mono'),
    {
      tags: ['bw', 'mono', 'deep', 'dramatic', 'nikon'],
      inspiredBy: pc('Deep Tone Monochrome'),
      description: tk('Heavy shadows and strong contrast.')
    },
    mono(),
    tone({ contrast: 35, shadows: -25 }),
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
      description: tk('Pale orange haze and softened detail.')
    },
    tone({ contrast: -15, shadows: 15 }),
    wheel('global', 35, 15),
    bloomApprox(60)
  ),
  look(
    'morning',
    tk('Morning'),
    {
      tags: ['morning', 'cool', 'fresh', 'creative', 'nikon'],
      inspiredBy: cpc('Morning'),
      description: tk('Fresh, cool and bright, like early light.')
    },
    tone({ contrast: -10, shadows: 20, whites: 10 }),
    presence({ saturation: -5 }),
    wheel('global', 210, 12)
  ),
  look(
    'pop',
    tk('Pop'),
    {
      tags: ['pop', 'saturated', 'bright', 'creative', 'nikon'],
      inspiredBy: cpc('Pop'),
      description: tk('Bright and loudly colourful.')
    },
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: 45 })
  ),
  look(
    'sunday',
    tk('Sunday'),
    {
      tags: ['warm', 'relaxed', 'bright', 'creative', 'nikon'],
      inspiredBy: cpc('Sunday'),
      description: tk('Warm, bright and easy-going.')
    },
    tone({ shadows: 15, whites: 10 }),
    presence({ saturation: 10 }),
    wheel('global', 45, 10)
  ),
  look(
    'somber',
    tk('Somber'),
    {
      tags: ['somber', 'muted', 'dark', 'cool', 'creative', 'nikon'],
      inspiredBy: cpc('Somber'),
      description: tk('Dim, muted and cool.')
    },
    tone({ contrast: -10, whites: -15, highlights: -10 }),
    presence({ saturation: -35 }),
    wheel('global', 210, 10)
  ),
  look(
    'dramatic',
    tk('Dramatic'),
    {
      tags: ['dramatic', 'contrast', 'clarity', 'creative', 'nikon'],
      inspiredBy: cpc('Dramatic'),
      description: tk('Hard local contrast and drained colour.')
    },
    tone({ contrast: 30, whites: 20 }),
    presence({ clarity: 35, saturation: -15 })
  ),
  look(
    'silence',
    tk('Silence'),
    {
      tags: ['quiet', 'muted', 'faded', 'cool', 'creative', 'nikon'],
      inspiredBy: cpc('Silence'),
      description: tk('Faded, cool and nearly colourless.')
    },
    tone({ contrast: -15 }),
    fade(0.04),
    presence({ saturation: -45 }),
    wheel('global', 195, 10)
  ),
  look(
    'bleached',
    tk('Bleached'),
    {
      tags: ['bleached', 'desaturated', 'gritty', 'creative', 'nikon'],
      inspiredBy: cpc('Bleached'),
      description: tk('Hard contrast, washed colour and a faint green.')
    },
    tone({ contrast: 30 }),
    presence({ saturation: -50, clarity: 15 }),
    wheel('global', 130, 12)
  ),
  look(
    'melancholic',
    tk('Melancholic'),
    {
      tags: ['melancholy', 'faded', 'magenta', 'mood', 'creative', 'nikon'],
      inspiredBy: cpc('Melancholic'),
      description: tk('Faded, muted colour with a magenta sigh.')
    },
    tone({ contrast: -10 }),
    fade(0.04),
    presence({ saturation: -25 }),
    wheel('global', 320, 12)
  ),
  look(
    'pure',
    tk('Pure'),
    {
      tags: ['pure', 'bright', 'airy', 'soft', 'creative', 'nikon'],
      inspiredBy: cpc('Pure'),
      description: tk('Bright, airy and veiled.')
    },
    tone({ contrast: -25, shadows: 20, whites: 15 }),
    fade(0.05),
    presence({ saturation: -10 }),
    bloomApprox(40)
  ),
  look(
    'denim',
    tk('Denim'),
    {
      tags: ['denim', 'blue', 'cool', 'creative', 'nikon'],
      inspiredBy: cpc('Denim'),
      description: tk('Washed indigo over everything.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: -20 }),
    wheel('global', 225, 35),
    hsl({ blue: [0, 20, 0] })
  ),
  look(
    'toy',
    tk('Toy'),
    {
      tags: ['toy camera', 'lomo', 'vignette', 'saturated', 'creative', 'nikon'],
      inspiredBy: cpc('Toy'),
      description: tk('Heavy corners and loud, yellowed colour.')
    },
    tone({ contrast: 20 }),
    presence({ saturation: 20 }),
    wheel('global', 55, 12),
    vignette(-50, { feather: 45 })
  ),
  look(
    'sepia-colour',
    tk('Sepia Colour'),
    {
      tags: ['sepia', 'faded', 'vintage', 'creative', 'nikon'],
      inspiredBy: cpc('Sepia'),
      description: tk('A trace of colour under a brown tone.')
    },
    fade(0.03),
    presence({ saturation: -70 }),
    wheel('global', 35, 25)
  ),
  look(
    'blue-wash',
    tk('Blue Wash'),
    {
      tags: ['blue', 'tinted', 'monochromatic', 'creative', 'nikon'],
      inspiredBy: cpc('Blue'),
      description: tk('Colour drained, then tinted blue.')
    },
    presence({ saturation: -60 }),
    wheel('global', 215, 30)
  ),
  look(
    'red-wash',
    tk('Red Wash'),
    {
      tags: ['red', 'tinted', 'monochromatic', 'creative', 'nikon'],
      inspiredBy: cpc('Red'),
      description: tk('Colour drained, then tinted red.')
    },
    presence({ saturation: -60 }),
    wheel('global', 5, 30)
  ),
  look(
    'pink-wash',
    tk('Pink Wash'),
    {
      tags: ['pink', 'tinted', 'monochromatic', 'creative', 'nikon'],
      inspiredBy: cpc('Pink'),
      description: tk('Colour drained, then tinted pink.')
    },
    presence({ saturation: -55 }),
    wheel('global', 335, 25)
  ),
  look(
    'charcoal',
    tk('Charcoal'),
    {
      tags: ['bw', 'mono', 'charcoal', 'textured', 'creative', 'nikon'],
      inspiredBy: cpc('Charcoal'),
      description: tk('A smudged, textured mono like a charcoal drawing.')
    },
    mono(),
    tone({ contrast: 10, whites: -20, highlights: -15, shadows: -15 }),
    fade(0.07),
    presence({ texture: 25, clarity: -10 }),
    grain(20, 35, 70)
  ),
  look(
    'graphite',
    tk('Graphite'),
    {
      tags: ['bw', 'mono', 'graphite', 'crisp', 'creative', 'nikon'],
      inspiredBy: cpc('Graphite'),
      description: tk('A hard, cool pencil-sharp mono.')
    },
    mono(),
    tone({ contrast: 25 }),
    presence({ clarity: 30 }),
    wheel('global', 220, 5)
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
      description: tk('A dark, low-key mono with deep blacks.')
    },
    mono(),
    tone({ contrast: 30, whites: -20, shadows: -15, blacks: -10 })
  )
])
