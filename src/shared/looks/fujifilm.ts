/**
 * Slide, negative and cinema colour in the spirit of Fujifilm's film
 * simulations, written with our own sliders from their published character.
 */
import {
  collection,
  gain,
  grain,
  hsl,
  hueCurve,
  lift,
  look,
  matte,
  mono,
  offset,
  presence,
  prim,
  rgb,
  sCurve,
  tone,
  lumSat
} from './dsl'
import { tk } from '../i18n'

const insp = (sim: string): string => `Fujifilm ${sim} film simulation`

export const FUJIFILM = collection('camera/fujifilm', [
  look(
    'standard-slide',
    tk('Standard Slide'),
    {
      tags: ['slide', 'standard', 'everyday', 'provia', 'fujifilm'],
      inspiredBy: insp('PROVIA/Standard'),
      description: tk('Balanced slide-film colour with a firm, clean curve.'),
      version: 2
    },
    sCurve(22),
    prim({ contrast: 1.04 }),
    tone({ blacks: -6 }),
    presence({ saturation: 8 }),
    lift(220, 5),
    hueCurve('hueHue', [
      [120, 1.5],
      [240, -1.2]
    ]),
    hueCurve('hueSat', [
      [0, 1.08],
      [120, 1.06],
      [240, 1.14]
    ]),
    hsl({ blue: [0, 0, -10] })
  ),
  look(
    'vivid-slide',
    tk('Vivid Slide'),
    {
      tags: ['slide', 'vivid', 'saturated', 'landscape', 'velvia', 'fujifilm'],
      inspiredBy: insp('Velvia/Vivid'),
      description: tk('Dense, saturated slide colour for landscapes; skin is held back.'),
      version: 2
    },
    sCurve(35),
    prim({ contrast: 1.09 }),
    tone({ blacks: -8 }),
    presence({ saturation: 25, vibrance: 15 }),
    lift(290, 6),
    hueCurve('hueHue', [[0, -1.5]]),
    hueCurve('hueSat', [
      [0, 1.15],
      [30, 0.95],
      [240, 1.2],
      [275, 1.15],
      [315, 1.15],
      [120, 1.25],
      [60, 1.15]
    ]),
    hsl({ blue: [0, 0, -15], green: [0, 0, -5], yellow: [0, 0, -3] })
  ),
  look(
    'soft-slide',
    tk('Soft Slide'),
    {
      tags: ['slide', 'soft', 'portrait', 'astia', 'fujifilm'],
      inspiredBy: insp('ASTIA/Soft'),
      description: tk('Slide colour with gentle highlights and kind skin.'),
      version: 2
    },
    sCurve(15),
    tone({ highlights: -22, shadows: 8 }),
    matte(0, 0.02),
    presence({ saturation: 10 }),
    gain(30, 6),
    hueCurve('hueHue', [
      [30, -0.9],
      [120, 1.5]
    ]),
    hueCurve('hueSat', [
      [30, 0.92],
      [120, 1.14],
      [240, 1.16],
      [180, 1.1]
    ]),
    hsl({ orange: [0, 0, 8], blue: [0, 0, -6] })
  ),
  look(
    'documentary-chrome',
    tk('Documentary Chrome'),
    {
      tags: ['chrome', 'documentary', 'muted', 'street', 'classic chrome', 'fujifilm'],
      inspiredBy: insp('Classic Chrome'),
      description: tk('Muted, hard-shadowed reportage colour with olive greens.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    tone({ shadows: -10, highlights: -8 }),
    presence({ saturation: -20 }),
    lift(200, 8),
    gain(50, 8),
    hueCurve('hueHue', [
      [0, 1.5],
      [120, -3],
      [240, -2.4]
    ]),
    hueCurve('hueSat', [
      [0, 0.85],
      [60, 0.8],
      [120, 0.75],
      [240, 0.9]
    ]),
    hsl({ blue: [0, 0, -10] }),
    grain(10, 20, 40)
  ),
  look(
    'classic-negative',
    tk('Classic Negative'),
    {
      tags: ['negative', 'film', 'street', 'nostalgic', 'classic neg', 'fujifilm'],
      inspiredBy: insp('Classic Neg.'),
      description: tk('Hard tonality and a crossover cast: teal shadows, warm highlights.'),
      version: 2
    },
    sCurve(40),
    matte(0.02),
    presence({ saturation: -10 }),
    rgb({
      r: [
        [0, 0],
        [0.25, 0.22],
        [0.75, 0.79],
        [1, 1]
      ],
      b: [
        [0, 0.03],
        [0.25, 0.28],
        [0.75, 0.72],
        [1, 0.97]
      ]
    }),
    lift(180, 15),
    gain(40, 10),
    hueCurve('hueHue', [
      [0, -1.5],
      [30, -0.9],
      [120, 4.5],
      [240, -3]
    ]),
    hueCurve('hueSat', [
      [60, 0.85],
      [120, 0.85]
    ]),
    grain(15, 20, 40)
  ),
  look(
    'amber-nostalgia',
    tk('Amber Nostalgia'),
    {
      tags: ['negative', 'amber', 'warm', 'nostalgic', 'nostalgic neg', 'fujifilm'],
      inspiredBy: insp('Nostalgic Neg.'),
      description: tk('Amber highlights, open shadows and rosy skin, like an old print.'),
      version: 2
    },
    prim({ contrast: 0.97 }),
    tone({ shadows: 15 }),
    matte(0.03, 0.02),
    presence({ saturation: 5 }),
    lift(35, 8),
    gain(42, 20),
    offset(40, 4),
    hueCurve('hueHue', [
      [30, -0.9],
      [240, 3],
      [120, -4.5],
      [60, -2.7]
    ]),
    hueCurve('hueSat', [[30, 1.05]]),
    grain(10, 20, 40)
  ),
  look(
    'natural-negative',
    tk('Natural Negative'),
    {
      tags: ['negative', 'natural', 'true colour', 'reala', 'fujifilm'],
      inspiredBy: insp('REALA ACE'),
      description: tk('Faithful colour with a crisp top and soft shadows.'),
      version: 2
    },
    sCurve(15),
    tone({ highlights: 6, shadows: 14 }),
    matte(0.02),
    presence({ saturation: -6 }),
    lift(195, 8),
    gain(50, 5),
    hueCurve('hueHue', [
      [60, -1.5],
      [120, 1.8]
    ]),
    hueCurve('hueSat', [
      [0, 0.88],
      [60, 0.94],
      [120, 0.92]
    ])
  ),
  look(
    'studio-portrait-hi',
    tk('Studio Portrait Hi'),
    {
      tags: ['portrait', 'studio', 'skin', 'pro neg', 'fujifilm'],
      inspiredBy: insp('PRO Neg. Hi'),
      description: tk('Portrait negative with a little more bite for flat light.'),
      version: 2
    },
    sCurve(25),
    tone({ highlights: -14 }),
    presence({ saturation: -12 }),
    lift(200, 10),
    gain(40, 6),
    hueCurve('hueHue', [[120, 1.8]]),
    hueCurve('hueSat', [
      [30, 0.94],
      [120, 0.88],
      [240, 0.92]
    ]),
    hsl({ orange: [0, 0, 6] })
  ),
  look(
    'studio-portrait-soft',
    tk('Studio Portrait Soft'),
    {
      tags: ['portrait', 'studio', 'soft', 'skin', 'pro neg', 'fujifilm'],
      inspiredBy: insp('PRO Neg. Std'),
      description: tk('Low-contrast portrait negative with quiet greens and blues.'),
      version: 2
    },
    prim({ contrast: 0.88 }),
    tone({ shadows: 10 }),
    presence({ saturation: -15 }),
    lift(185, 8),
    gain(35, 6),
    hueCurve('hueHue', [[120, 1.5]]),
    hueCurve('hueSat', [
      [30, 0.96],
      [120, 0.9],
      [240, 0.9]
    ]),
    hsl({ orange: [0, 0, 6] })
  ),
  look(
    'cinema-flat',
    tk('Cinema Flat'),
    {
      tags: ['cinema', 'flat', 'muted', 'film', 'eterna', 'fujifilm'],
      inspiredBy: insp('ETERNA/Cinema'),
      description: tk('Low contrast, low saturation cinema stock with teal shadows.'),
      version: 2
    },
    prim({ contrast: 0.82 }),
    tone({ highlights: -15 }),
    matte(0.03, 0.02),
    presence({ saturation: -35 }),
    lift(185, 15),
    gain(55, 6),
    hueCurve('hueHue', [
      [120, 3.6],
      [60, 2.1]
    ]),
    hueCurve('hueSat', [
      [0, 0.8],
      [30, 0.9],
      [240, 0.9],
      [120, 0.8],
      [60, 0.88]
    ])
  ),
  look(
    'cinema-bleach',
    tk('Cinema Bleach'),
    {
      tags: ['bleach bypass', 'gritty', 'desaturated', 'cinema', 'eterna', 'fujifilm'],
      inspiredBy: insp('ETERNA Bleach Bypass'),
      description: tk('Silver-retained contrast with the colour drained out.'),
      version: 2
    },
    sCurve(45),
    prim({ contrast: 1.15 }),
    presence({ clarity: 15, saturation: -55 }),
    lift(170, 8),
    // Silver left in: the ends lose colour first.
    lumSat([
      [0, 0.7],
      [0.35, 1],
      [0.65, 1],
      [1, 0.7]
    ])
  ),
  look(
    'fine-grain-mono',
    tk('Fine-Grain Mono'),
    {
      tags: ['bw', 'mono', 'fine grain', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS'),
      description: tk('Rich blacks, smooth highlights and a fine, tight grain.')
    },
    mono({ red: 4, blue: -4 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'fine-grain-mono-yellow',
    tk('Fine-Grain Mono Yellow'),
    {
      tags: ['bw', 'mono', 'yellow filter', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS + Ye filter'),
      description: tk('A yellow filter: skies a touch deeper, skin a touch lighter.')
    },
    mono({ yellow: 20, orange: 15, blue: -20 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'fine-grain-mono-red',
    tk('Fine-Grain Mono Red'),
    {
      tags: ['bw', 'mono', 'red filter', 'dramatic sky', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS + R filter'),
      description: tk('A red filter: dark, dramatic skies and glowing skin.')
    },
    mono({ red: 40, orange: 30, blue: -45, aqua: -20 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'fine-grain-mono-green',
    tk('Fine-Grain Mono Green'),
    {
      tags: ['bw', 'mono', 'green filter', 'foliage', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS + G filter'),
      description: tk('A green filter: bright foliage, deeper lips and skin.')
    },
    mono({ green: 30, yellow: 10, red: -15 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'clean-mono',
    tk('Clean Mono'),
    {
      tags: ['bw', 'mono', 'clean', 'monochrome', 'fujifilm'],
      inspiredBy: insp('Monochrome'),
      description: tk('A plain, grainless black and white.'),
      version: 2
    },
    mono({ green: 8, yellow: 6, red: -4 }),
    prim({ contrast: 0.96 }),
    tone({ highlights: -8, shadows: 10 })
  ),
  look(
    'sepia-print',
    tk('Sepia Print'),
    {
      tags: ['bw', 'sepia', 'toned', 'vintage', 'fujifilm'],
      inspiredBy: insp('Sepia'),
      description: tk('A warm brown-toned print.'),
      version: 2
    },
    mono(),
    prim({ contrast: 0.97 }),
    matte(0.02),
    lift(30, 30),
    gain(45, 25)
  )
])
