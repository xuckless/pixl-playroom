/** Black and white: filters, toning and printing styles. */
import {
  bloomApprox,
  collection,
  curve,
  fade,
  grain,
  look,
  mono,
  presence,
  rolloff,
  sCurve,
  split,
  tone,
  vignette,
  wheel
} from './dsl'

export const BW = collection('bw', [
  look(
    'film-noir',
    'Film Noir',
    {
      tags: ['bw', 'mono', 'noir', 'dark', 'dramatic'],
      description: 'Hard key light and deep, falling-off shadows.'
    },
    mono({ red: 10, orange: 10 }),
    sCurve(50),
    tone({ contrast: 20, shadows: -20, blacks: -10 }),
    vignette(-30, { feather: 60 }),
    grain(15, 22, 45)
  ),
  look(
    'high-key-mono',
    'High-Key Mono',
    { tags: ['bw', 'mono', 'high key', 'bright', 'airy'], description: 'Bright, light and soft.' },
    mono({ orange: 15, red: 10 }),
    tone({ contrast: -15, whites: 25, shadows: 30, highlights: 10 })
  ),
  look(
    'low-key-mono',
    'Low-Key Mono',
    { tags: ['bw', 'mono', 'low key', 'dark', 'moody'], description: 'Dark, brooding and heavy.' },
    mono(),
    tone({ contrast: 20, whites: -20, highlights: -20, shadows: -25, blacks: -10 })
  ),
  look(
    'red-filter-drama',
    'Red Filter Drama',
    {
      tags: ['bw', 'mono', 'red filter', 'sky', 'landscape'],
      description: 'Black skies and bright clouds, as through a red filter.'
    },
    mono({ red: 55, orange: 40, yellow: 15, green: -25, aqua: -50, blue: -75 }),
    tone({ contrast: 30, whites: 10 }),
    presence({ clarity: 15 })
  ),
  look(
    'yellow-filter-classic',
    'Yellow Filter Classic',
    {
      tags: ['bw', 'mono', 'yellow filter', 'classic'],
      description: 'The everyday yellow filter: slightly deeper skies.'
    },
    mono({ yellow: 25, orange: 18, red: 8, blue: -30, aqua: -10 }),
    tone({ contrast: 10, shadows: 10, whites: 10 }),
    fade(0.015)
  ),
  look(
    'green-filter-portrait',
    'Green Filter Portrait',
    {
      tags: ['bw', 'mono', 'green filter', 'portrait', 'skin'],
      description: 'Fuller skin tones and bright foliage.'
    },
    mono({ green: 40, yellow: 20, red: -28, orange: -18 }),
    tone({ contrast: 8, highlights: -10, shadows: 10 }),
    fade(0.015)
  ),
  look(
    'infrared-mono',
    'Infrared Mono',
    {
      tags: ['bw', 'mono', 'infrared', 'surreal', 'landscape'],
      description: 'White foliage, black skies and a faint glow.'
    },
    mono({ green: 90, yellow: 70, aqua: -40, blue: -80 }),
    tone({ contrast: 30 }),
    bloomApprox(25),
    grain(15, 22, 45)
  ),
  look(
    'matte-mono',
    'Matte Mono',
    {
      tags: ['bw', 'mono', 'matte', 'faded', 'soft'],
      description: 'Faded blacks and a soft, printed top end.'
    },
    mono(),
    sCurve(30),
    fade(0.1),
    rolloff(0.06)
  ),
  look(
    'silver-gelatin',
    'Silver Gelatin',
    {
      tags: ['bw', 'mono', 'darkroom', 'print', 'classic'],
      description: 'A rich darkroom print with a hint of warmth.'
    },
    mono({ orange: 8, red: 4 }),
    sCurve(36),
    tone({ blacks: -10, highlights: -8 }),
    wheel('global', 40, 9),
    grain(12, 20, 40)
  ),
  look(
    'cyanotype',
    'Cyanotype',
    {
      tags: ['bw', 'cyanotype', 'blue', 'alternative process', 'toned'],
      description: 'Prussian-blue alternative print.'
    },
    mono(),
    tone({ contrast: 10 }),
    fade(0.03),
    split(215, 55, 200, 30)
  ),
  look(
    'platinum-print',
    'Platinum Print',
    {
      tags: ['bw', 'platinum', 'warm', 'alternative process', 'toned'],
      description: 'Long, soft scale with warm, neutral-brown tones.'
    },
    mono(),
    tone({ contrast: -10, highlights: -10 }),
    fade(0.03),
    split(30, 15, 40, 8)
  ),
  look(
    'split-tone-mono',
    'Split-Tone Mono',
    {
      tags: ['bw', 'split tone', 'toned', 'cool', 'warm'],
      description: 'Cool shadows, warm highlights.'
    },
    mono(),
    tone({ contrast: 15 }),
    split(220, 20, 40, 20)
  ),
  look(
    'lith-print',
    'Lith Print',
    {
      tags: ['bw', 'lith', 'grain', 'warm', 'alternative process'],
      description: 'Hard, gritty shadows and creamy, peach highlights.'
    },
    mono(),
    curve('master', [
      [0, 0],
      [0.3, 0.12],
      [0.6, 0.62],
      [1, 0.96]
    ]),
    split(30, 10, 25, 25),
    grain(35, 35, 70)
  ),
  look(
    'tintype',
    'Tintype',
    {
      tags: ['bw', 'tintype', 'vintage', 'wet plate', 'portrait'],
      description: 'Wet-plate feel: dark edges, cool metal tone, dark reds.'
    },
    mono({ red: -40, orange: -25, blue: 30, aqua: 20 }),
    tone({ contrast: 25 }),
    wheel('global', 50, 6),
    vignette(-40, { feather: 40 }),
    grain(20, 30, 70)
  )
])
