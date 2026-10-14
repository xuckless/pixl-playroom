/**
 * Black and white: filters, toning and printing styles. Version 2
 * (2026-10-14) tones on DaVinci Resolve's tools (Lift for the shadows' tone,
 * Gain for the highlights', Offset for the whole print), the matte base on
 * Lift and Gain's masters and the contrast on the Primaries; the filter is
 * the B&W mix.
 */
import {
  bloomApprox,
  collection,
  curve,
  gain,
  grain,
  lift,
  look,
  matte,
  mono,
  offset,
  presence,
  prim,
  sCurve,
  tone,
  vignette
} from './dsl'
import { tk } from '../i18n'

export const BW = collection('bw', [
  look(
    'film-noir',
    tk('Film Noir'),
    {
      tags: ['bw', 'mono', 'noir', 'dark', 'dramatic'],
      description: tk('Hard key light and deep, falling-off shadows.'),
      version: 2
    },
    mono({ red: 10, orange: 10 }),
    sCurve(50),
    prim({ contrast: 1.15 }),
    tone({ shadows: -20, blacks: -10 }),
    vignette(-30, { feather: 60 }),
    grain(15, 22, 45)
  ),
  look(
    'high-key-mono',
    tk('High-Key Mono'),
    {
      tags: ['bw', 'mono', 'high key', 'bright', 'airy'],
      description: tk('Bright, light and soft.'),
      version: 2
    },
    mono({ orange: 15, red: 10 }),
    prim({ contrast: 0.88 }),
    tone({ whites: 25, shadows: 30, highlights: 10 })
  ),
  look(
    'low-key-mono',
    tk('Low-Key Mono'),
    {
      tags: ['bw', 'mono', 'low key', 'dark', 'moody'],
      description: tk('Dark, brooding and heavy.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.15, pivot: 0.38 }),
    tone({ whites: -20, highlights: -20, shadows: -25, blacks: -10 })
  ),
  look(
    'red-filter-drama',
    tk('Red Filter Drama'),
    {
      tags: ['bw', 'mono', 'red filter', 'sky', 'landscape'],
      description: tk('Black skies and bright clouds, as through a red filter.'),
      version: 2
    },
    mono({ red: 55, orange: 40, yellow: 15, green: -25, aqua: -50, blue: -75 }),
    prim({ contrast: 1.22 }),
    tone({ whites: 10 }),
    presence({ clarity: 15 })
  ),
  look(
    'yellow-filter-classic',
    tk('Yellow Filter Classic'),
    {
      tags: ['bw', 'mono', 'yellow filter', 'classic'],
      description: tk('The everyday yellow filter: slightly deeper skies.'),
      version: 2
    },
    mono({ yellow: 25, orange: 18, red: 8, blue: -30, aqua: -10 }),
    prim({ contrast: 1.08 }),
    tone({ shadows: 10, whites: 10 }),
    matte(0.015)
  ),
  look(
    'green-filter-portrait',
    tk('Green Filter Portrait'),
    {
      tags: ['bw', 'mono', 'green filter', 'portrait', 'skin'],
      description: tk('Fuller skin tones and bright foliage.'),
      version: 2
    },
    mono({ green: 40, yellow: 20, red: -28, orange: -18 }),
    prim({ contrast: 1.06 }),
    tone({ highlights: -10, shadows: 10 }),
    matte(0.015)
  ),
  look(
    'infrared-mono',
    tk('Infrared Mono'),
    {
      tags: ['bw', 'mono', 'infrared', 'surreal', 'landscape'],
      description: tk('White foliage, black skies and a faint glow.'),
      version: 2
    },
    mono({ green: 90, yellow: 70, aqua: -40, blue: -80 }),
    prim({ contrast: 1.22 }),
    bloomApprox(25),
    grain(15, 22, 45)
  ),
  look(
    'matte-mono',
    tk('Matte Mono'),
    {
      tags: ['bw', 'mono', 'matte', 'faded', 'soft'],
      description: tk('Faded blacks and a soft, printed top end.'),
      version: 2
    },
    mono(),
    sCurve(30),
    matte(0.1, 0.06)
  ),
  look(
    'silver-gelatin',
    tk('Silver Gelatin'),
    {
      tags: ['bw', 'mono', 'darkroom', 'print', 'classic'],
      description: tk('A rich darkroom print with a hint of warmth.'),
      version: 2
    },
    mono({ orange: 8, red: 4 }),
    sCurve(36),
    tone({ blacks: -10, highlights: -8 }),
    offset(40, 9),
    grain(12, 20, 40)
  ),
  look(
    'cyanotype',
    tk('Cyanotype'),
    {
      tags: ['bw', 'cyanotype', 'blue', 'alternative process', 'toned'],
      description: tk('Prussian-blue alternative print.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.08 }),
    matte(0.03),
    lift(215, 55),
    gain(200, 30)
  ),
  look(
    'platinum-print',
    tk('Platinum Print'),
    {
      tags: ['bw', 'platinum', 'warm', 'alternative process', 'toned'],
      description: tk('Long, soft scale with warm, neutral-brown tones.'),
      version: 2
    },
    mono(),
    prim({ contrast: 0.92 }),
    tone({ highlights: -10 }),
    matte(0.03),
    lift(30, 15),
    gain(40, 8)
  ),
  look(
    'split-tone-mono',
    tk('Split-Tone Mono'),
    {
      tags: ['bw', 'split tone', 'toned', 'cool', 'warm'],
      description: tk('Cool shadows, warm highlights.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.12 }),
    lift(220, 20),
    gain(40, 20)
  ),
  look(
    'lith-print',
    tk('Lith Print'),
    {
      tags: ['bw', 'lith', 'grain', 'warm', 'alternative process'],
      description: tk('Hard, gritty shadows and creamy, peach highlights.'),
      version: 2
    },
    mono(),
    curve('master', [
      [0, 0],
      [0.3, 0.12],
      [0.6, 0.62],
      [1, 0.96]
    ]),
    lift(30, 10),
    gain(25, 25),
    grain(35, 35, 70)
  ),
  look(
    'tintype',
    tk('Tintype'),
    {
      tags: ['bw', 'tintype', 'vintage', 'wet plate', 'portrait'],
      description: tk('Wet-plate feel: dark edges, cool metal tone, dark reds.'),
      version: 2
    },
    mono({ red: -40, orange: -25, blue: 30, aqua: 20 }),
    prim({ contrast: 1.2 }),
    offset(50, 6),
    vignette(-40, { feather: 40 }),
    grain(20, 30, 70)
  )
])
