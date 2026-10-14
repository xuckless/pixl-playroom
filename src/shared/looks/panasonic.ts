/** Classic-neo colour, cine gammas and dynamic monochromes, in the spirit of LUMIX. */
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
  sCurve,
  tone
} from './dsl'
import { tk } from '../i18n'

const lx = (name: string): string => `Panasonic LUMIX ${name}`

export const PANASONIC = collection('camera/panasonic', [
  look(
    'classic-neo',
    tk('Classic Neo'),
    {
      tags: ['classic', 'soft', 'nostalgic', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Classic Neo'),
      description: tk('Soft blacks and gently nostalgic colour.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    matte(0.03),
    presence({ saturation: -10 }),
    gain(45, 14),
    hueCurve('hueHue', [
      [120, 3],
      [60, 1.8]
    ]),
    hueCurve('hueSat', [
      [30, 0.95],
      [240, 0.9],
      [120, 0.85],
      [60, 0.91]
    ]),
    hsl({ orange: [0, 0, 6], blue: [0, 0, 10] }),
    grain(12, 20, 40)
  ),
  look(
    'classic-shift',
    tk('Classic Shift'),
    {
      tags: ['classic', 'cinematic', 'split', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Classic'),
      description: tk('Colour that shifts with brightness: teal low, warm high.'),
      version: 2
    },
    prim({ contrast: 1.03 }),
    presence({ saturation: -15 }),
    lift(190, 12),
    gain(45, 12)
  ),
  look(
    'gentle-mono',
    tk('Gentle Mono'),
    {
      tags: ['bw', 'mono', 'warm', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Monochrome'),
      description: tk('A faintly warm, even mono.'),
      version: 2
    },
    mono({ orange: 5 }),
    sCurve(12),
    tone({ shadows: 6 }),
    offset(40, 9)
  ),
  look(
    'dynamic-mono',
    tk('Dynamic Mono'),
    {
      tags: ['bw', 'mono', 'dramatic', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Monochrome D'),
      description: tk('Dramatic mono with bright whites and deep blacks.'),
      version: 2
    },
    mono({ red: 10, orange: 10, blue: -15 }),
    sCurve(30),
    prim({ contrast: 1.15 }),
    tone({ whites: 18, blacks: -18 }),
    presence({ clarity: 18 })
  ),
  look(
    'soft-mono',
    tk('Soft Mono'),
    {
      tags: ['bw', 'mono', 'soft', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Monochrome S'),
      description: tk('A soft, low-contrast mono.'),
      version: 2
    },
    mono({ orange: 6, green: 6 }),
    prim({ contrast: 0.87 }),
    tone({ highlights: -15, shadows: 15 }),
    matte(0.02),
    offset(220, 3)
  ),
  look(
    'cine-wide',
    tk('Cine Wide'),
    {
      tags: ['cinema', 'flat', 'dynamic range', 'video', 'lumix', 'panasonic'],
      inspiredBy: lx('Cinelike D2'),
      description: tk('Wide, flat cine gamma to grade from.'),
      version: 2
    },
    prim({ contrast: 0.79, sat: -15 }),
    tone({ highlights: -30, shadows: 25 })
  ),
  look(
    'cine-contrast',
    tk('Cine Contrast'),
    {
      tags: ['cinema', 'contrast', 'video', 'lumix', 'panasonic'],
      inspiredBy: lx('Cinelike V2'),
      description: tk('Cinematic contrast with soft highlights.'),
      version: 2
    },
    prim({ contrast: 1.09, sat: 5 }),
    tone({ highlights: -15 }),
    hueCurve('hueSat', [[30, 1.05]])
  )
])
