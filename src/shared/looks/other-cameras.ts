/** OM, Pentax and phone photographic styles. */
import { collection, fade, grain, hsl, look, mono, presence, split, tone, wheel } from './dsl'

const om = (name: string): string => `OM System / Olympus ${name}`
const px = (name: string): string => `Pentax Custom Image ${name}`
const ph = (name: string): string => `iPhone Photographic Style ${name}`

export const OTHER_CAMERAS = collection('camera/other', [
  look(
    'vintage-one',
    'Vintage One',
    {
      tags: ['vintage', 'warm', 'faded', 'om', 'olympus'],
      inspiredBy: om('Vintage I'),
      description: 'Faded with a warm, gentle cast.'
    },
    tone({ contrast: -5 }),
    fade(0.04),
    presence({ saturation: -15 }),
    wheel('global', 40, 15)
  ),
  look(
    'vintage-olive',
    'Vintage Olive',
    {
      tags: ['vintage', 'olive', 'faded', 'om', 'olympus'],
      inspiredBy: om('Vintage II'),
      description: 'Faded with an olive tint.'
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -20 }),
    wheel('global', 100, 10)
  ),
  look(
    'vintage-rose',
    'Vintage Rose',
    {
      tags: ['vintage', 'rose', 'magenta', 'om', 'olympus'],
      inspiredBy: om('Vintage III'),
      description: 'Faded with a rosy cast.'
    },
    fade(0.04),
    presence({ saturation: -10 }),
    wheel('global', 330, 10)
  ),
  look(
    'colour-creator-teal',
    'Colour Creator Teal',
    {
      tags: ['teal', 'tinted', 'creative', 'om', 'olympus'],
      inspiredBy: om('Color Creator'),
      description: 'One hue for the whole picture: teal.'
    },
    presence({ saturation: -20 }),
    wheel('global', 185, 20)
  ),
  look(
    'pale-and-light',
    'Pale & Light',
    {
      tags: ['pale', 'airy', 'bright', 'pastel', 'om', 'olympus'],
      inspiredBy: om('Art Filter Pale & Light Color'),
      description: 'Bright, pale and faintly blue.'
    },
    tone({ contrast: -25, shadows: 25, whites: 15 }),
    fade(0.06),
    presence({ saturation: -20 }),
    wheel('highlights', 210, 10)
  ),
  look(
    'grainy-film',
    'Grainy Film',
    {
      tags: ['bw', 'mono', 'grain', 'gritty', 'om', 'olympus'],
      inspiredBy: om('Art Filter Grainy Film'),
      description: 'Hard mono with coarse grain.'
    },
    mono(),
    tone({ contrast: 60 }),
    grain(70, 50, 80)
  ),
  look(
    'reversal-slide',
    'Reversal Slide',
    {
      tags: ['slide', 'reversal', 'saturated', 'pentax'],
      inspiredBy: px('Reversal Film'),
      description: 'Saturated slide colour with deep blues.'
    },
    tone({ contrast: 25, blacks: -5 }),
    presence({ saturation: 20 }),
    hsl({ blue: [0, 20, -15] })
  ),
  look(
    'silver-bleach',
    'Silver Bleach',
    {
      tags: ['bleach bypass', 'desaturated', 'contrast', 'pentax'],
      inspiredBy: px('Bleach Bypass'),
      description: 'Hard contrast with most colour gone.'
    },
    tone({ contrast: 40 }),
    presence({ saturation: -55 })
  ),
  look(
    'muted-colour',
    'Muted Colour',
    {
      tags: ['muted', 'calm', 'pentax'],
      inspiredBy: px('Muted'),
      description: 'Calm, quiet colour.'
    },
    tone({ contrast: -5 }),
    presence({ saturation: -30 })
  ),
  look(
    'radiant',
    'Radiant',
    {
      tags: ['radiant', 'bright', 'warm', 'pentax'],
      inspiredBy: px('Radiant'),
      description: 'Bright and glowing with warmth.'
    },
    tone({ whites: 10 }),
    presence({ saturation: 15 }),
    wheel('global', 40, 8)
  ),
  look(
    'amber-style',
    'Amber Style',
    {
      tags: ['amber', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Amber'),
      description: 'Amber warmth through the whole picture.'
    },
    wheel('global', 40, 18)
  ),
  look(
    'gold-style',
    'Gold Style',
    {
      tags: ['gold', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Gold'),
      description: 'Golden light, colour lifted a touch.'
    },
    wheel('global', 50, 18),
    presence({ vibrance: 5 })
  ),
  look(
    'rose-gold',
    'Rose Gold',
    {
      tags: ['rose', 'pink', 'warm', 'phone', 'iphone'],
      inspiredBy: ph('Rose Gold'),
      description: 'A warm pink glow.'
    },
    wheel('global', 15, 14)
  ),
  look(
    'cool-rose',
    'Cool Rose',
    {
      tags: ['rose', 'cool', 'pink', 'phone', 'iphone'],
      inspiredBy: ph('Cool Rose'),
      description: 'Cool with a rosy tint.'
    },
    wheel('global', 290, 12)
  ),
  look(
    'vibrant-style',
    'Vibrant Style',
    {
      tags: ['vibrant', 'saturated', 'phone', 'iphone'],
      inspiredBy: ph('Vibrant'),
      description: 'Brighter, more vibrant colour.'
    },
    presence({ saturation: 20, vibrance: 15 })
  ),
  look(
    'natural-style',
    'Natural Style',
    {
      tags: ['natural', 'subtle', 'phone', 'iphone'],
      inspiredBy: ph('Natural'),
      description: 'Less processed, softer colour.'
    },
    tone({ contrast: -5 }),
    presence({ saturation: -10 })
  ),
  look(
    'luminous',
    'Luminous',
    {
      tags: ['luminous', 'bright', 'airy', 'phone', 'iphone'],
      inspiredBy: ph('Luminous'),
      description: 'Bright shadows and gentle glow.'
    },
    tone({ shadows: 20, whites: 10 }),
    presence({ vibrance: 10 })
  ),
  look(
    'dramatic-style',
    'Dramatic Style',
    {
      tags: ['dramatic', 'contrast', 'dark', 'phone', 'iphone'],
      inspiredBy: ph('Dramatic'),
      description: 'Deep shadows and strong contrast.'
    },
    tone({ contrast: 25, shadows: -20 }),
    presence({ saturation: 5 })
  ),
  look(
    'quiet',
    'Quiet',
    {
      tags: ['quiet', 'faded', 'muted', 'phone', 'iphone'],
      inspiredBy: ph('Quiet'),
      description: 'Faded, muted and warm.'
    },
    tone({ contrast: -15 }),
    fade(0.05),
    presence({ saturation: -25 }),
    wheel('global', 40, 8)
  ),
  look(
    'cozy',
    'Cozy',
    {
      tags: ['cozy', 'warm', 'dim', 'phone', 'iphone'],
      inspiredBy: ph('Cozy'),
      description: 'Dim, warm and close.'
    },
    tone({ whites: -10, highlights: -10 }),
    wheel('global', 35, 15)
  ),
  look(
    'ethereal',
    'Ethereal',
    {
      tags: ['ethereal', 'dreamy', 'pastel', 'phone', 'iphone'],
      inspiredBy: ph('Ethereal'),
      description: 'Soft, light and faintly violet.'
    },
    tone({ contrast: -20, whites: 10 }),
    fade(0.04),
    wheel('global', 260, 8)
  ),
  look(
    'muted-bw',
    'Muted B&W',
    {
      tags: ['bw', 'mono', 'soft', 'phone', 'iphone'],
      inspiredBy: ph('Muted B&W'),
      description: 'A soft, faded black and white.'
    },
    mono(),
    tone({ contrast: -20 }),
    fade(0.04)
  ),
  look(
    'stark-bw',
    'Stark B&W',
    {
      tags: ['bw', 'mono', 'stark', 'contrast', 'phone', 'iphone'],
      inspiredBy: ph('Stark B&W'),
      description: 'A hard, deep black and white.'
    },
    mono(),
    tone({ contrast: 45, blacks: -20 })
  ),
  look(
    'polar-split',
    'Polar Split',
    {
      tags: ['cool', 'split', 'clean', 'phone', 'iphone'],
      inspiredBy: ph('Cool'),
      description: 'Cool shadows and clean whites.'
    },
    split(210, 12, 200, 4),
    presence({ saturation: -5 })
  )
])
