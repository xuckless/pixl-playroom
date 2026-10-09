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
import { tk } from '../i18n'

export const BW = collection('bw', [
  look(
    'film-noir',
    tk('Film Noir'),
    {
      tags: ['bw', 'mono', 'noir', 'dark', 'dramatic'],
      description: tk('Hard key light and deep, falling-off shadows.')
    },
    mono({ red: 10, orange: 10 }),
    sCurve(50),
    tone({ contrast: 20, shadows: -20, blacks: -10 }),
    vignette(-30, { feather: 60 }),
    grain(15, 22, 45)
  ),
  look(
    'high-key-mono',
    tk('High-Key Mono'),
    {
      tags: ['bw', 'mono', 'high key', 'bright', 'airy'],
      description: tk('Bright, light and soft.')
    },
    mono({ orange: 15, red: 10 }),
    tone({ contrast: -15, whites: 25, shadows: 30, highlights: 10 })
  ),
  look(
    'low-key-mono',
    tk('Low-Key Mono'),
    {
      tags: ['bw', 'mono', 'low key', 'dark', 'moody'],
      description: tk('Dark, brooding and heavy.')
    },
    mono(),
    tone({ contrast: 20, whites: -20, highlights: -20, shadows: -25, blacks: -10 })
  ),
  look(
    'red-filter-drama',
    tk('Red Filter Drama'),
    {
      tags: ['bw', 'mono', 'red filter', 'sky', 'landscape'],
      description: tk('Black skies and bright clouds, as through a red filter.')
    },
    mono({ red: 55, orange: 40, yellow: 15, green: -25, aqua: -50, blue: -75 }),
    tone({ contrast: 30, whites: 10 }),
    presence({ clarity: 15 })
  ),
  look(
    'yellow-filter-classic',
    tk('Yellow Filter Classic'),
    {
      tags: ['bw', 'mono', 'yellow filter', 'classic'],
      description: tk('The everyday yellow filter: slightly deeper skies.')
    },
    mono({ yellow: 25, orange: 18, red: 8, blue: -30, aqua: -10 }),
    tone({ contrast: 10, shadows: 10, whites: 10 }),
    fade(0.015)
  ),
  look(
    'green-filter-portrait',
    tk('Green Filter Portrait'),
    {
      tags: ['bw', 'mono', 'green filter', 'portrait', 'skin'],
      description: tk('Fuller skin tones and bright foliage.')
    },
    mono({ green: 40, yellow: 20, red: -28, orange: -18 }),
    tone({ contrast: 8, highlights: -10, shadows: 10 }),
    fade(0.015)
  ),
  look(
    'infrared-mono',
    tk('Infrared Mono'),
    {
      tags: ['bw', 'mono', 'infrared', 'surreal', 'landscape'],
      description: tk('White foliage, black skies and a faint glow.')
    },
    mono({ green: 90, yellow: 70, aqua: -40, blue: -80 }),
    tone({ contrast: 30 }),
    bloomApprox(25),
    grain(15, 22, 45)
  ),
  look(
    'matte-mono',
    tk('Matte Mono'),
    {
      tags: ['bw', 'mono', 'matte', 'faded', 'soft'],
      description: tk('Faded blacks and a soft, printed top end.')
    },
    mono(),
    sCurve(30),
    fade(0.1),
    rolloff(0.06)
  ),
  look(
    'silver-gelatin',
    tk('Silver Gelatin'),
    {
      tags: ['bw', 'mono', 'darkroom', 'print', 'classic'],
      description: tk('A rich darkroom print with a hint of warmth.')
    },
    mono({ orange: 8, red: 4 }),
    sCurve(36),
    tone({ blacks: -10, highlights: -8 }),
    wheel('global', 40, 9),
    grain(12, 20, 40)
  ),
  look(
    'cyanotype',
    tk('Cyanotype'),
    {
      tags: ['bw', 'cyanotype', 'blue', 'alternative process', 'toned'],
      description: tk('Prussian-blue alternative print.')
    },
    mono(),
    tone({ contrast: 10 }),
    fade(0.03),
    split(215, 55, 200, 30)
  ),
  look(
    'platinum-print',
    tk('Platinum Print'),
    {
      tags: ['bw', 'platinum', 'warm', 'alternative process', 'toned'],
      description: tk('Long, soft scale with warm, neutral-brown tones.')
    },
    mono(),
    tone({ contrast: -10, highlights: -10 }),
    fade(0.03),
    split(30, 15, 40, 8)
  ),
  look(
    'split-tone-mono',
    tk('Split-Tone Mono'),
    {
      tags: ['bw', 'split tone', 'toned', 'cool', 'warm'],
      description: tk('Cool shadows, warm highlights.')
    },
    mono(),
    tone({ contrast: 15 }),
    split(220, 20, 40, 20)
  ),
  look(
    'lith-print',
    tk('Lith Print'),
    {
      tags: ['bw', 'lith', 'grain', 'warm', 'alternative process'],
      description: tk('Hard, gritty shadows and creamy, peach highlights.')
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
    tk('Tintype'),
    {
      tags: ['bw', 'tintype', 'vintage', 'wet plate', 'portrait'],
      description: tk('Wet-plate feel: dark edges, cool metal tone, dark reds.')
    },
    mono({ red: -40, orange: -25, blue: 30, aqua: 20 }),
    tone({ contrast: 25 }),
    wheel('global', 50, 6),
    vignette(-40, { feather: 40 }),
    grain(20, 30, 70)
  )
])
