/**
 * Slide, negative and cinema colour in the spirit of Fujifilm's film
 * simulations, written with our own sliders from their published character.
 */
import {
  collection,
  fade,
  foliage,
  grain,
  hsl,
  look,
  mono,
  presence,
  rgb,
  rolloff,
  sCurve,
  split,
  tone,
  wheel
} from './dsl'

const insp = (sim: string): string => `Fujifilm ${sim} film simulation`

export const FUJIFILM = collection('camera/fujifilm', [
  look(
    'standard-slide',
    'Standard Slide',
    {
      tags: ['slide', 'standard', 'everyday', 'provia', 'fujifilm'],
      inspiredBy: insp('PROVIA/Standard'),
      description: 'Balanced slide-film colour with a firm, clean curve.'
    },
    sCurve(22),
    tone({ contrast: 6, blacks: -6 }),
    presence({ saturation: 8 }),
    wheel('shadows', 220, 5),
    hsl({ red: [0, 8, 0], green: [5, 6, 0], blue: [-4, 14, -10] })
  ),
  look(
    'vivid-slide',
    'Vivid Slide',
    {
      tags: ['slide', 'vivid', 'saturated', 'landscape', 'velvia', 'fujifilm'],
      inspiredBy: insp('Velvia/Vivid'),
      description: 'Dense, saturated slide colour for landscapes; skin is held back.'
    },
    sCurve(35),
    tone({ contrast: 15, blacks: -8 }),
    presence({ saturation: 25, vibrance: 15 }),
    wheel('shadows', 290, 6),
    hsl({
      red: [-5, 15, 0],
      orange: [0, -5, 0],
      blue: [0, 20, -15],
      purple: [0, 15, 0],
      magenta: [0, 15, 0]
    }),
    foliage(0, 25, -5)
  ),
  look(
    'soft-slide',
    'Soft Slide',
    {
      tags: ['slide', 'soft', 'portrait', 'astia', 'fujifilm'],
      inspiredBy: insp('ASTIA/Soft'),
      description: 'Slide colour with gentle highlights and kind skin.'
    },
    sCurve(15),
    tone({ highlights: -22, shadows: 8 }),
    rolloff(0.02),
    presence({ saturation: 10 }),
    wheel('highlights', 30, 6),
    hsl({ orange: [-3, -8, 8], green: [5, 14, 0], blue: [0, 16, -6], aqua: [0, 10, 0] })
  ),
  look(
    'documentary-chrome',
    'Documentary Chrome',
    {
      tags: ['chrome', 'documentary', 'muted', 'street', 'classic chrome', 'fujifilm'],
      inspiredBy: insp('Classic Chrome'),
      description: 'Muted, hard-shadowed reportage colour with olive greens.'
    },
    tone({ contrast: 15, shadows: -10, highlights: -8 }),
    presence({ saturation: -20 }),
    split(200, 8, 50, 8),
    hsl({
      red: [5, -15, 0],
      yellow: [0, -20, 0],
      green: [-10, -25, 0],
      blue: [-8, -10, -10]
    }),
    grain(10, 20, 40)
  ),
  look(
    'classic-negative',
    'Classic Negative',
    {
      tags: ['negative', 'film', 'street', 'nostalgic', 'classic neg', 'fujifilm'],
      inspiredBy: insp('Classic Neg.'),
      description: 'Hard tonality and a crossover cast: teal shadows, warm highlights.'
    },
    sCurve(40),
    fade(0.02),
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
    split(180, 15, 40, 10),
    hsl({
      red: [-5, 0, 0],
      orange: [-3, 0, 0],
      yellow: [0, -15, 0],
      green: [15, -15, 0],
      blue: [-10, 0, 0]
    }),
    grain(15, 20, 40)
  ),
  look(
    'amber-nostalgia',
    'Amber Nostalgia',
    {
      tags: ['negative', 'amber', 'warm', 'nostalgic', 'nostalgic neg', 'fujifilm'],
      inspiredBy: insp('Nostalgic Neg.'),
      description: 'Amber highlights, open shadows and rosy skin, like an old print.'
    },
    tone({ contrast: -5, shadows: 15 }),
    fade(0.03),
    rolloff(0.02),
    presence({ saturation: 5 }),
    split(35, 8, 42, 20),
    wheel('global', 40, 4),
    hsl({ orange: [-3, 5, 0], blue: [10, 0, 0] }),
    foliage(-15, 0, 0),
    grain(10, 20, 40)
  ),
  look(
    'natural-negative',
    'Natural Negative',
    {
      tags: ['negative', 'natural', 'true colour', 'reala', 'fujifilm'],
      inspiredBy: insp('REALA ACE'),
      description: 'Faithful colour with a crisp top and soft shadows.'
    },
    sCurve(15),
    tone({ highlights: 6, shadows: 14 }),
    fade(0.02),
    presence({ saturation: -6 }),
    split(195, 8, 50, 5),
    hsl({ red: [0, -12, 0], yellow: [-5, -6, 0], green: [6, -8, 0] })
  ),
  look(
    'studio-portrait-hi',
    'Studio Portrait Hi',
    {
      tags: ['portrait', 'studio', 'skin', 'pro neg', 'fujifilm'],
      inspiredBy: insp('PRO Neg. Hi'),
      description: 'Portrait negative with a little more bite for flat light.'
    },
    sCurve(25),
    tone({ highlights: -14 }),
    presence({ saturation: -12 }),
    split(200, 10, 40, 6),
    hsl({ orange: [0, -6, 6], green: [6, -12, 0], blue: [0, -8, 0] })
  ),
  look(
    'studio-portrait-soft',
    'Studio Portrait Soft',
    {
      tags: ['portrait', 'studio', 'soft', 'skin', 'pro neg', 'fujifilm'],
      inspiredBy: insp('PRO Neg. Std'),
      description: 'Low-contrast portrait negative with quiet greens and blues.'
    },
    tone({ contrast: -20, shadows: 10 }),
    presence({ saturation: -15 }),
    split(185, 8, 35, 6),
    hsl({ orange: [0, -4, 6], green: [5, -10, 0], blue: [0, -10, 0] })
  ),
  look(
    'cinema-flat',
    'Cinema Flat',
    {
      tags: ['cinema', 'flat', 'muted', 'film', 'eterna', 'fujifilm'],
      inspiredBy: insp('ETERNA/Cinema'),
      description: 'Low contrast, low saturation cinema stock with teal shadows.'
    },
    tone({ contrast: -30, highlights: -15 }),
    fade(0.03),
    rolloff(0.02),
    presence({ saturation: -35 }),
    split(185, 15, 55, 6),
    hsl({ red: [0, -20, 0], orange: [0, -10, 0], blue: [0, -10, 0] }),
    foliage(12, -20, 0)
  ),
  look(
    'cinema-bleach',
    'Cinema Bleach',
    {
      tags: ['bleach bypass', 'gritty', 'desaturated', 'cinema', 'eterna', 'fujifilm'],
      inspiredBy: insp('ETERNA Bleach Bypass'),
      description: 'Silver-retained contrast with the colour drained out.'
    },
    sCurve(45),
    tone({ contrast: 25 }),
    presence({ clarity: 15, saturation: -55 }),
    wheel('shadows', 170, 8)
  ),
  look(
    'fine-grain-mono',
    'Fine-Grain Mono',
    {
      tags: ['bw', 'mono', 'fine grain', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS'),
      description: 'Rich blacks, smooth highlights and a fine, tight grain.'
    },
    mono({ red: 4, blue: -4 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'fine-grain-mono-yellow',
    'Fine-Grain Mono Yellow',
    {
      tags: ['bw', 'mono', 'yellow filter', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS + Ye filter'),
      description: 'A yellow filter: skies a touch deeper, skin a touch lighter.'
    },
    mono({ yellow: 20, orange: 15, blue: -20 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'fine-grain-mono-red',
    'Fine-Grain Mono Red',
    {
      tags: ['bw', 'mono', 'red filter', 'dramatic sky', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS + R filter'),
      description: 'A red filter: dark, dramatic skies and glowing skin.'
    },
    mono({ red: 40, orange: 30, blue: -45, aqua: -20 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'fine-grain-mono-green',
    'Fine-Grain Mono Green',
    {
      tags: ['bw', 'mono', 'green filter', 'foliage', 'acros', 'fujifilm'],
      inspiredBy: insp('ACROS + G filter'),
      description: 'A green filter: bright foliage, deeper lips and skin.'
    },
    mono({ green: 30, yellow: 10, red: -15 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    'clean-mono',
    'Clean Mono',
    {
      tags: ['bw', 'mono', 'clean', 'monochrome', 'fujifilm'],
      inspiredBy: insp('Monochrome'),
      description: 'A plain, grainless black and white.'
    },
    mono({ green: 8, yellow: 6, red: -4 }),
    tone({ contrast: -6, highlights: -8, shadows: 10 })
  ),
  look(
    'sepia-print',
    'Sepia Print',
    {
      tags: ['bw', 'sepia', 'toned', 'vintage', 'fujifilm'],
      inspiredBy: insp('Sepia'),
      description: 'A warm brown-toned print.'
    },
    mono(),
    tone({ contrast: -5 }),
    fade(0.02),
    split(30, 30, 45, 25)
  )
])
