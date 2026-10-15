/** OM, Pentax and phone photographic styles. */
import {
  collection,
  density,
  gain,
  grain,
  hsl,
  hueCurve,
  lift,
  look,
  lumSat,
  matte,
  mono,
  offset,
  presence,
  prim,
  tone
} from './dsl'
import { tk } from '../i18n'

const om = (name: string): string => `OM System / Olympus ${name}`
const px = (name: string): string => `Pentax Custom Image ${name}`
const ph = (name: string): string => `iPhone Photographic Style ${name}`

export const OTHER_CAMERAS = collection('camera/other', [
  look(
    'vintage-one',
    tk('Vintage One'),
    {
      tags: ['vintage', 'warm', 'faded', 'om', 'olympus'],
      inspiredBy: om('Vintage I'),
      description: tk('Faded with a warm, gentle cast.'),
      version: 2
    },
    prim({ contrast: 0.97 }),
    matte(0.04),
    presence({ saturation: -15 }),
    offset(40, 15)
  ),
  look(
    'vintage-olive',
    tk('Vintage Olive'),
    {
      tags: ['vintage', 'olive', 'faded', 'om', 'olympus'],
      inspiredBy: om('Vintage II'),
      description: tk('Faded with an olive tint.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    matte(0.05),
    presence({ saturation: -20 }),
    offset(100, 10)
  ),
  look(
    'vintage-rose',
    tk('Vintage Rose'),
    {
      tags: ['vintage', 'rose', 'magenta', 'om', 'olympus'],
      inspiredBy: om('Vintage III'),
      description: tk('Faded with a rosy cast.'),
      version: 2
    },
    matte(0.04),
    presence({ saturation: -10 }),
    offset(330, 10)
  ),
  look(
    'colour-creator-teal',
    tk('Colour Creator Teal'),
    {
      tags: ['teal', 'tinted', 'creative', 'om', 'olympus'],
      inspiredBy: om('Color Creator'),
      description: tk('One hue for the whole picture: teal.'),
      version: 2
    },
    presence({ saturation: -20 }),
    offset(185, 20)
  ),
  look(
    'pale-and-light',
    tk('Pale & Light'),
    {
      tags: ['pale', 'airy', 'bright', 'pastel', 'om', 'olympus'],
      inspiredBy: om('Art Filter Pale & Light Color'),
      description: tk('Bright, pale and faintly blue.'),
      version: 2
    },
    prim({ contrast: 0.85 }),
    tone({ shadows: 25, whites: 15 }),
    matte(0.06),
    presence({ saturation: -20 }),
    gain(210, 10)
  ),
  look(
    'grainy-film',
    tk('Grainy Film'),
    {
      tags: ['bw', 'mono', 'grain', 'gritty', 'om', 'olympus'],
      inspiredBy: om('Art Filter Grainy Film'),
      description: tk('Hard mono with coarse grain.'),
      version: 2
    },
    mono({ blue: 10, red: -10 }),
    prim({ contrast: 1.36 }),
    tone({ highlights: 10, shadows: 10 }),
    matte(0.02),
    grain(70, 50, 80)
  ),
  look(
    'reversal-slide',
    tk('Reversal Slide'),
    {
      tags: ['slide', 'reversal', 'saturated', 'pentax'],
      inspiredBy: px('Reversal Film'),
      description: tk('Saturated slide colour with deep blues.'),
      version: 3
    },
    prim({ contrast: 1.15 }),
    tone({ blacks: -10 }),
    presence({ saturation: 15 }),
    lift(230, 10),
    hueCurve('hueHue', [[240, -1.8]]),
    hueCurve('hueSat', [
      [240, 1.3],
      [180, 1.15],
      [0, 1.1]
    ]),
    hsl({ blue: [0, 0, -20], aqua: [0, 0, -10], red: [0, 0, -5] }),
    density(35)
  ),
  look(
    'silver-bleach',
    tk('Silver Bleach'),
    {
      tags: ['bleach bypass', 'desaturated', 'contrast', 'pentax'],
      inspiredBy: px('Bleach Bypass'),
      description: tk('Hard contrast with most colour gone.'),
      version: 2
    },
    prim({ contrast: 1.24, sat: -55 }),
    // Silver left in: the ends lose colour first.
    lumSat([
      [0, 0.7],
      [0.35, 1],
      [0.65, 1],
      [1, 0.7]
    ])
  ),
  look(
    'muted-colour',
    tk('Muted Colour'),
    {
      tags: ['muted', 'calm', 'pentax'],
      inspiredBy: px('Muted'),
      description: tk('Calm, quiet colour.'),
      version: 2
    },
    prim({ contrast: 0.97, sat: -30 })
  ),
  look(
    'radiant',
    tk('Radiant'),
    {
      tags: ['radiant', 'bright', 'warm', 'pentax'],
      inspiredBy: px('Radiant'),
      description: tk('Bright and glowing with warmth.'),
      version: 2
    },
    tone({ whites: 10 }),
    presence({ saturation: 15 }),
    offset(40, 8)
  ),
  look(
    'amber-style',
    tk('Amber Style'),
    {
      tags: ['amber', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Amber'),
      description: tk('Amber warmth through the whole picture.'),
      version: 2
    },
    offset(35, 20),
    lift(25, 10),
    prim({ contrast: 1.05 })
  ),
  look(
    'gold-style',
    tk('Gold Style'),
    {
      tags: ['gold', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Gold'),
      description: tk('Golden light, colour lifted a touch.'),
      version: 2
    },
    offset(52, 18),
    gain(55, 12),
    tone({ shadows: 10, whites: 6 }),
    presence({ vibrance: 8 })
  ),
  look(
    'rose-gold',
    tk('Rose Gold'),
    {
      tags: ['rose', 'pink', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Rose Gold'),
      description: tk('A warm pink glow.'),
      version: 2
    },
    offset(15, 14)
  ),
  look(
    'cool-rose',
    tk('Cool Rose'),
    {
      tags: ['rose', 'cool', 'pink', 'phone', 'iphone'],
      inspiredBy: ph('Cool Rose'),
      description: tk('Cool with a rosy tint.'),
      version: 2
    },
    offset(290, 12)
  ),
  look(
    'vibrant-style',
    tk('Vibrant Style'),
    {
      tags: ['vibrant', 'saturated', 'phone', 'iphone'],
      inspiredBy: ph('Vibrant'),
      description: tk('Brighter, more vibrant colour.'),
      version: 2
    },
    tone({ shadows: 8, whites: 6 }),
    prim({ sat: 18 }),
    presence({ vibrance: 25 })
  ),
  look(
    'natural-style',
    tk('Natural Style'),
    {
      tags: ['natural', 'subtle', 'phone', 'iphone'],
      inspiredBy: ph('Natural'),
      description: tk('Less processed, softer colour.'),
      version: 2
    },
    prim({ contrast: 0.94, sat: -12 }),
    tone({ highlights: -15, shadows: 12 }),
    presence({ clarity: -5 }),
    hueCurve('hueSat', [
      [30, 0.95],
      [120, 0.9]
    ]),
    hsl({ orange: [0, 0, 4] })
  ),
  look(
    'luminous',
    tk('Luminous'),
    {
      tags: ['luminous', 'bright', 'airy', 'phone', 'iphone'],
      inspiredBy: ph('Luminous'),
      description: tk('Bright shadows and gentle glow.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    tone({ shadows: 30, whites: 15, highlights: -10 }),
    presence({ vibrance: 15, clarity: -8 }),
    gain(45, 6)
  ),
  look(
    'dramatic-style',
    tk('Dramatic Style'),
    {
      tags: ['dramatic', 'contrast', 'dark', 'phone', 'iphone'],
      inspiredBy: ph('Dramatic'),
      description: tk('Deep shadows and strong contrast.'),
      version: 2
    },
    prim({ contrast: 1.15, sat: 5 }),
    tone({ shadows: -20 })
  ),
  look(
    'quiet',
    tk('Quiet'),
    {
      tags: ['quiet', 'faded', 'muted', 'phone', 'iphone'],
      inspiredBy: ph('Quiet'),
      description: tk('Faded, muted and warm.'),
      version: 2
    },
    prim({ contrast: 0.91 }),
    matte(0.05),
    presence({ saturation: -25 }),
    offset(40, 8)
  ),
  look(
    'cozy',
    tk('Cozy'),
    {
      tags: ['cozy', 'warm', 'dim', 'phone', 'iphone'],
      inspiredBy: ph('Cozy'),
      description: tk('Dim, warm and close.'),
      version: 2
    },
    tone({ whites: -10, highlights: -10 }),
    offset(35, 15)
  ),
  look(
    'ethereal',
    tk('Ethereal'),
    {
      tags: ['ethereal', 'dreamy', 'pastel', 'phone', 'iphone'],
      inspiredBy: ph('Ethereal'),
      description: tk('Soft, light and faintly violet.'),
      version: 2
    },
    prim({ contrast: 0.88 }),
    tone({ whites: 10 }),
    matte(0.04),
    offset(260, 8)
  ),
  look(
    'muted-bw',
    tk('Muted B&W'),
    {
      tags: ['bw', 'mono', 'soft', 'phone', 'iphone'],
      inspiredBy: ph('Muted B&W'),
      description: tk('A soft, faded black and white.'),
      version: 2
    },
    mono({ yellow: 6, blue: 6 }),
    prim({ contrast: 0.91 }),
    tone({ whites: -12, highlights: -10 }),
    matte(0.05, 0.04)
  ),
  look(
    'stark-bw',
    tk('Stark B&W'),
    {
      tags: ['bw', 'mono', 'stark', 'contrast', 'phone', 'iphone'],
      inspiredBy: ph('Stark B&W'),
      description: tk('A hard, deep black and white.'),
      version: 2
    },
    mono({ red: 8, orange: 8 }),
    prim({ contrast: 1.27 }),
    tone({ blacks: -25, shadows: -15, whites: 10 })
  ),
  look(
    'polar-split',
    tk('Polar Split'),
    {
      tags: ['cool', 'split', 'clean', 'phone', 'iphone'],
      inspiredBy: ph('Cool'),
      description: tk('Cool shadows and clean whites.'),
      version: 2
    },
    lift(210, 25),
    gain(200, 8),
    prim({ contrast: 1.06 }),
    tone({ whites: 10 }),
    presence({ saturation: -10 })
  )
])
