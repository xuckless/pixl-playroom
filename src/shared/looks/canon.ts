/** Warm, friendly colour and flattering skin, in the spirit of Canon's Picture Styles. */
import { collection, foliage, hsl, look, mono, presence, tone, wheel } from './dsl'

const insp = (style: string): string => `Canon Picture Style ${style}`

export const CANON = collection('camera/canon', [
  look(
    'friendly-standard',
    'Friendly Standard',
    {
      tags: ['standard', 'warm', 'everyday', 'canon'],
      inspiredBy: insp('Standard'),
      description: 'Warm, punchy everyday colour with rich reds.'
    },
    tone({ contrast: 12 }),
    presence({ saturation: 10, texture: 10 }),
    wheel('global', 40, 3),
    hsl({ red: [0, 10, 0], orange: [0, 10, 0] })
  ),
  look(
    'gentle-portrait',
    'Gentle Portrait',
    {
      tags: ['portrait', 'skin', 'soft', 'warm', 'canon'],
      inspiredBy: insp('Portrait'),
      description: 'Rosy, smooth skin and a soft touch.'
    },
    tone({ contrast: -8, highlights: -12, shadows: 8 }),
    presence({ texture: -18, clarity: -6 }),
    wheel('global', 15, 7),
    wheel('highlights', 25, 10),
    hsl({ orange: [-6, -8, 12], red: [0, -6, 6] })
  ),
  look(
    'lush-landscape',
    'Lush Landscape',
    {
      tags: ['landscape', 'nature', 'green', 'blue sky', 'canon'],
      inspiredBy: insp('Landscape'),
      description: 'Vivid greens and blues with crisp detail.'
    },
    tone({ contrast: 15 }),
    presence({ saturation: 15, clarity: 10 }),
    hsl({ blue: [0, 25, -10] }),
    foliage(-5, 25, 0)
  ),
  look(
    'faithful-colour',
    'Faithful Colour',
    {
      tags: ['faithful', 'accurate', 'colorimetric', 'product', 'canon'],
      inspiredBy: insp('Faithful'),
      description: 'Colour as measured, contrast held low.'
    },
    tone({ contrast: -15, highlights: -12, shadows: 10 }),
    presence({ saturation: -6 }),
    hsl({ red: [0, -6, 0], yellow: [0, -6, 0] })
  ),
  look(
    'neutral-base',
    'Neutral Base',
    {
      tags: ['neutral', 'flat', 'grading', 'canon'],
      inspiredBy: insp('Neutral'),
      description: 'A low-contrast, low-saturation base to grade from.'
    },
    tone({ contrast: -25, shadows: 10 }),
    presence({ saturation: -15 }),
    wheel('global', 35, 4)
  ),
  look(
    'fine-detail',
    'Fine Detail',
    {
      tags: ['detail', 'texture', 'sharp', 'canon'],
      inspiredBy: insp('Fine Detail'),
      description: 'Fine texture brought forward, colour as standard.'
    },
    tone({ contrast: 12, whites: 8, blacks: -8 }),
    presence({ saturation: 6, texture: 45, clarity: 15 }),
    wheel('global', 40, 3),
    hsl({ blue: [0, 8, -5] })
  ),
  look(
    'plain-mono',
    'Plain Mono',
    {
      tags: ['bw', 'mono', 'canon'],
      inspiredBy: insp('Monochrome'),
      description: 'A straightforward black and white.'
    },
    // Canon renders skin bright in mono: warm bands lifted, blue held down.
    mono({ red: 12, orange: 18, yellow: 8, blue: -12 }),
    tone({ contrast: 15, blacks: -6 })
  )
])
