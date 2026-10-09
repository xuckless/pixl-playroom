/** OM, Pentax and phone photographic styles. */
import {
  collection,
  fade,
  grain,
  hsl,
  look,
  mono,
  presence,
  rolloff,
  split,
  tone,
  wheel
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
      description: tk('Faded with a warm, gentle cast.')
    },
    tone({ contrast: -5 }),
    fade(0.04),
    presence({ saturation: -15 }),
    wheel('global', 40, 15)
  ),
  look(
    'vintage-olive',
    tk('Vintage Olive'),
    {
      tags: ['vintage', 'olive', 'faded', 'om', 'olympus'],
      inspiredBy: om('Vintage II'),
      description: tk('Faded with an olive tint.')
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -20 }),
    wheel('global', 100, 10)
  ),
  look(
    'vintage-rose',
    tk('Vintage Rose'),
    {
      tags: ['vintage', 'rose', 'magenta', 'om', 'olympus'],
      inspiredBy: om('Vintage III'),
      description: tk('Faded with a rosy cast.')
    },
    fade(0.04),
    presence({ saturation: -10 }),
    wheel('global', 330, 10)
  ),
  look(
    'colour-creator-teal',
    tk('Colour Creator Teal'),
    {
      tags: ['teal', 'tinted', 'creative', 'om', 'olympus'],
      inspiredBy: om('Color Creator'),
      description: tk('One hue for the whole picture: teal.')
    },
    presence({ saturation: -20 }),
    wheel('global', 185, 20)
  ),
  look(
    'pale-and-light',
    tk('Pale & Light'),
    {
      tags: ['pale', 'airy', 'bright', 'pastel', 'om', 'olympus'],
      inspiredBy: om('Art Filter Pale & Light Color'),
      description: tk('Bright, pale and faintly blue.')
    },
    tone({ contrast: -25, shadows: 25, whites: 15 }),
    fade(0.06),
    presence({ saturation: -20 }),
    wheel('highlights', 210, 10)
  ),
  look(
    'grainy-film',
    tk('Grainy Film'),
    {
      tags: ['bw', 'mono', 'grain', 'gritty', 'om', 'olympus'],
      inspiredBy: om('Art Filter Grainy Film'),
      description: tk('Hard mono with coarse grain.')
    },
    mono({ blue: 10, red: -10 }),
    tone({ contrast: 60, highlights: 10, shadows: 10 }),
    fade(0.02),
    grain(70, 50, 80)
  ),
  look(
    'reversal-slide',
    tk('Reversal Slide'),
    {
      tags: ['slide', 'reversal', 'saturated', 'pentax'],
      inspiredBy: px('Reversal Film'),
      description: tk('Saturated slide colour with deep blues.')
    },
    tone({ contrast: 25, blacks: -10 }),
    presence({ saturation: 15 }),
    wheel('shadows', 230, 10),
    hsl({ blue: [-6, 30, -20], aqua: [0, 15, -10], red: [0, 10, -5] })
  ),
  look(
    'silver-bleach',
    tk('Silver Bleach'),
    {
      tags: ['bleach bypass', 'desaturated', 'contrast', 'pentax'],
      inspiredBy: px('Bleach Bypass'),
      description: tk('Hard contrast with most colour gone.')
    },
    tone({ contrast: 40 }),
    presence({ saturation: -55 })
  ),
  look(
    'muted-colour',
    tk('Muted Colour'),
    {
      tags: ['muted', 'calm', 'pentax'],
      inspiredBy: px('Muted'),
      description: tk('Calm, quiet colour.')
    },
    tone({ contrast: -5 }),
    presence({ saturation: -30 })
  ),
  look(
    'radiant',
    tk('Radiant'),
    {
      tags: ['radiant', 'bright', 'warm', 'pentax'],
      inspiredBy: px('Radiant'),
      description: tk('Bright and glowing with warmth.')
    },
    tone({ whites: 10 }),
    presence({ saturation: 15 }),
    wheel('global', 40, 8)
  ),
  look(
    'amber-style',
    tk('Amber Style'),
    {
      tags: ['amber', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Amber'),
      description: tk('Amber warmth through the whole picture.')
    },
    wheel('global', 35, 20),
    wheel('shadows', 25, 10),
    tone({ contrast: 8 })
  ),
  look(
    'gold-style',
    tk('Gold Style'),
    {
      tags: ['gold', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Gold'),
      description: tk('Golden light, colour lifted a touch.')
    },
    wheel('global', 52, 18),
    wheel('highlights', 55, 12),
    tone({ shadows: 10, whites: 6 }),
    presence({ vibrance: 8 })
  ),
  look(
    'rose-gold',
    tk('Rose Gold'),
    {
      tags: ['rose', 'pink', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Rose Gold'),
      description: tk('A warm pink glow.')
    },
    wheel('global', 15, 14)
  ),
  look(
    'cool-rose',
    tk('Cool Rose'),
    {
      tags: ['rose', 'cool', 'pink', 'phone', 'iphone'],
      inspiredBy: ph('Cool Rose'),
      description: tk('Cool with a rosy tint.')
    },
    wheel('global', 290, 12)
  ),
  look(
    'vibrant-style',
    tk('Vibrant Style'),
    {
      tags: ['vibrant', 'saturated', 'phone', 'iphone'],
      inspiredBy: ph('Vibrant'),
      description: tk('Brighter, more vibrant colour.')
    },
    tone({ shadows: 8, whites: 6 }),
    presence({ saturation: 18, vibrance: 25 })
  ),
  look(
    'natural-style',
    tk('Natural Style'),
    {
      tags: ['natural', 'subtle', 'phone', 'iphone'],
      inspiredBy: ph('Natural'),
      description: tk('Less processed, softer colour.')
    },
    tone({ contrast: -10, highlights: -15, shadows: 12 }),
    presence({ saturation: -12, clarity: -5 }),
    hsl({ orange: [0, -5, 4], green: [0, -10, 0] })
  ),
  look(
    'luminous',
    tk('Luminous'),
    {
      tags: ['luminous', 'bright', 'airy', 'phone', 'iphone'],
      inspiredBy: ph('Luminous'),
      description: tk('Bright shadows and gentle glow.')
    },
    tone({ contrast: -10, shadows: 30, whites: 15, highlights: -10 }),
    presence({ vibrance: 15, clarity: -8 }),
    wheel('highlights', 45, 6)
  ),
  look(
    'dramatic-style',
    tk('Dramatic Style'),
    {
      tags: ['dramatic', 'contrast', 'dark', 'phone', 'iphone'],
      inspiredBy: ph('Dramatic'),
      description: tk('Deep shadows and strong contrast.')
    },
    tone({ contrast: 25, shadows: -20 }),
    presence({ saturation: 5 })
  ),
  look(
    'quiet',
    tk('Quiet'),
    {
      tags: ['quiet', 'faded', 'muted', 'phone', 'iphone'],
      inspiredBy: ph('Quiet'),
      description: tk('Faded, muted and warm.')
    },
    tone({ contrast: -15 }),
    fade(0.05),
    presence({ saturation: -25 }),
    wheel('global', 40, 8)
  ),
  look(
    'cozy',
    tk('Cozy'),
    {
      tags: ['cozy', 'warm', 'dim', 'phone', 'iphone'],
      inspiredBy: ph('Cozy'),
      description: tk('Dim, warm and close.')
    },
    tone({ whites: -10, highlights: -10 }),
    wheel('global', 35, 15)
  ),
  look(
    'ethereal',
    tk('Ethereal'),
    {
      tags: ['ethereal', 'dreamy', 'pastel', 'phone', 'iphone'],
      inspiredBy: ph('Ethereal'),
      description: tk('Soft, light and faintly violet.')
    },
    tone({ contrast: -20, whites: 10 }),
    fade(0.04),
    wheel('global', 260, 8)
  ),
  look(
    'muted-bw',
    tk('Muted B&W'),
    {
      tags: ['bw', 'mono', 'soft', 'phone', 'iphone'],
      inspiredBy: ph('Muted B&W'),
      description: tk('A soft, faded black and white.')
    },
    mono({ yellow: 6, blue: 6 }),
    tone({ contrast: -15, whites: -12, highlights: -10 }),
    fade(0.05),
    rolloff(0.04)
  ),
  look(
    'stark-bw',
    tk('Stark B&W'),
    {
      tags: ['bw', 'mono', 'stark', 'contrast', 'phone', 'iphone'],
      inspiredBy: ph('Stark B&W'),
      description: tk('A hard, deep black and white.')
    },
    mono({ red: 8, orange: 8 }),
    tone({ contrast: 45, blacks: -25, shadows: -15, whites: 10 })
  ),
  look(
    'polar-split',
    tk('Polar Split'),
    {
      tags: ['cool', 'split', 'clean', 'phone', 'iphone'],
      inspiredBy: ph('Cool'),
      description: tk('Cool shadows and clean whites.')
    },
    split(210, 25, 200, 8),
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: -10 })
  )
])
