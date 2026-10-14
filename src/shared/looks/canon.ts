/** Warm, friendly colour and flattering skin, in the spirit of Canon's Picture Styles. */
import { collection, gain, hsl, hueCurve, look, mono, offset, presence, prim, tone } from './dsl'
import { tk } from '../i18n'

const insp = (style: string): string => `Canon Picture Style ${style}`

export const CANON = collection('camera/canon', [
  look(
    'friendly-standard',
    tk('Friendly Standard'),
    {
      tags: ['standard', 'warm', 'everyday', 'canon'],
      inspiredBy: insp('Standard'),
      description: tk('Warm, punchy everyday colour with rich reds.'),
      version: 2
    },
    prim({ contrast: 1.07 }),
    presence({ saturation: 10, texture: 10 }),
    offset(40, 3),
    hueCurve('hueSat', [
      [0, 1.1],
      [30, 1.1]
    ])
  ),
  look(
    'gentle-portrait',
    tk('Gentle Portrait'),
    {
      tags: ['portrait', 'skin', 'soft', 'warm', 'canon'],
      inspiredBy: insp('Portrait'),
      description: tk('Rosy, smooth skin and a soft touch.'),
      version: 2
    },
    prim({ contrast: 0.95 }),
    tone({ highlights: -12, shadows: 8 }),
    presence({ texture: -18, clarity: -6 }),
    offset(15, 7),
    gain(25, 10),
    hueCurve('hueHue', [[30, -1.8]]),
    hueCurve('hueSat', [
      [30, 0.92],
      [0, 0.94]
    ]),
    hsl({ orange: [0, 0, 12], red: [0, 0, 6] })
  ),
  look(
    'lush-landscape',
    tk('Lush Landscape'),
    {
      tags: ['landscape', 'nature', 'green', 'blue sky', 'canon'],
      inspiredBy: insp('Landscape'),
      description: tk('Vivid greens and blues with crisp detail.'),
      version: 2
    },
    prim({ contrast: 1.09, sat: 15 }),
    presence({ clarity: 10 }),
    hueCurve('hueHue', [
      [120, -1.5],
      [60, -0.9]
    ]),
    hueCurve('hueSat', [
      [240, 1.25],
      [120, 1.25],
      [60, 1.15]
    ]),
    hsl({ blue: [0, 0, -10] })
  ),
  look(
    'faithful-colour',
    tk('Faithful Colour'),
    {
      tags: ['faithful', 'accurate', 'colorimetric', 'product', 'canon'],
      inspiredBy: insp('Faithful'),
      description: tk('Colour as measured, contrast held low.'),
      version: 2
    },
    prim({ contrast: 0.91, sat: -6 }),
    tone({ highlights: -12, shadows: 10 }),
    hueCurve('hueSat', [
      [0, 0.94],
      [60, 0.94]
    ])
  ),
  look(
    'neutral-base',
    tk('Neutral Base'),
    {
      tags: ['neutral', 'flat', 'grading', 'canon'],
      inspiredBy: insp('Neutral'),
      description: tk('A low-contrast, low-saturation base to grade from.'),
      version: 2
    },
    prim({ contrast: 0.85 }),
    tone({ shadows: 10 }),
    presence({ saturation: -15 }),
    offset(35, 4)
  ),
  look(
    'fine-detail',
    tk('Fine Detail'),
    {
      tags: ['detail', 'texture', 'sharp', 'canon'],
      inspiredBy: insp('Fine Detail'),
      description: tk('Fine texture brought forward, colour as standard.'),
      version: 2
    },
    prim({ contrast: 1.07 }),
    tone({ whites: 8, blacks: -8 }),
    presence({ saturation: 6, texture: 45, clarity: 15 }),
    offset(40, 3),
    hueCurve('hueSat', [[240, 1.08]]),
    hsl({ blue: [0, 0, -5] })
  ),
  look(
    'plain-mono',
    tk('Plain Mono'),
    {
      tags: ['bw', 'mono', 'canon'],
      inspiredBy: insp('Monochrome'),
      description: tk('A straightforward black and white.'),
      version: 2
    },
    mono({ red: 12, orange: 18, yellow: 8, blue: -12 }),
    prim({ contrast: 1.09 }),
    tone({ blacks: -6 })
  )
])
