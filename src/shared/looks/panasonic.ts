/** Classic-neo colour, cine gammas and dynamic monochromes, in the spirit of LUMIX. */
import {
  collection,
  fade,
  foliage,
  grain,
  hsl,
  look,
  mono,
  presence,
  sCurve,
  split,
  tone,
  wheel
} from './dsl'

const lx = (name: string): string => `Panasonic LUMIX ${name}`

export const PANASONIC = collection('camera/panasonic', [
  look(
    'classic-neo',
    'Classic Neo',
    {
      tags: ['classic', 'soft', 'nostalgic', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Classic Neo'),
      description: 'Soft blacks and gently nostalgic colour.'
    },
    tone({ contrast: -10 }),
    fade(0.03),
    presence({ saturation: -10 }),
    wheel('highlights', 45, 14),
    hsl({ orange: [0, -5, 6], blue: [0, -10, 10] }),
    foliage(10, -15, 0),
    grain(12, 20, 40)
  ),
  look(
    'classic-shift',
    'Classic Shift',
    {
      tags: ['classic', 'cinematic', 'split', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Classic'),
      description: 'Colour that shifts with brightness: teal low, warm high.'
    },
    tone({ contrast: 5 }),
    presence({ saturation: -15 }),
    split(190, 12, 45, 12)
  ),
  look(
    'gentle-mono',
    'Gentle Mono',
    {
      tags: ['bw', 'mono', 'warm', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Monochrome'),
      description: 'A faintly warm, even mono.'
    },
    mono({ orange: 5 }),
    sCurve(12),
    tone({ shadows: 6 }),
    wheel('global', 40, 9)
  ),
  look(
    'dynamic-mono',
    'Dynamic Mono',
    {
      tags: ['bw', 'mono', 'dramatic', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Monochrome D'),
      description: 'Dramatic mono with bright whites and deep blacks.'
    },
    mono({ red: 10, orange: 10, blue: -15 }),
    sCurve(30),
    tone({ contrast: 25, whites: 18, blacks: -18 }),
    presence({ clarity: 18 })
  ),
  look(
    'soft-mono',
    'Soft Mono',
    {
      tags: ['bw', 'mono', 'soft', 'lumix', 'panasonic'],
      inspiredBy: lx('L.Monochrome S'),
      description: 'A soft, low-contrast mono.'
    },
    mono({ orange: 6, green: 6 }),
    tone({ contrast: -22, highlights: -15, shadows: 15 }),
    fade(0.02),
    wheel('global', 220, 3)
  ),
  look(
    'cine-wide',
    'Cine Wide',
    {
      tags: ['cinema', 'flat', 'dynamic range', 'video', 'lumix', 'panasonic'],
      inspiredBy: lx('Cinelike D2'),
      description: 'Wide, flat cine gamma to grade from.'
    },
    tone({ contrast: -35, highlights: -30, shadows: 25 }),
    presence({ saturation: -15 })
  ),
  look(
    'cine-contrast',
    'Cine Contrast',
    {
      tags: ['cinema', 'contrast', 'video', 'lumix', 'panasonic'],
      inspiredBy: lx('Cinelike V2'),
      description: 'Cinematic contrast with soft highlights.'
    },
    tone({ contrast: 15, highlights: -15 }),
    presence({ saturation: 5 }),
    hsl({ orange: [0, 5, 0] })
  )
])
