/** Warm, friendly colour and flattering skin, in the spirit of Canon's Picture Styles. */
import { collection, hsl, look, mono, presence, tone, wheel } from './dsl'

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
    presence({ texture: -10 }),
    wheel('global', 20, 3),
    hsl({ orange: [-4, -5, 6] })
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
    hsl({ green: [-5, 25, 0], blue: [0, 25, -10] })
  ),
  look(
    'faithful-colour',
    'Faithful Colour',
    {
      tags: ['faithful', 'accurate', 'colorimetric', 'product', 'canon'],
      inspiredBy: insp('Faithful'),
      description: 'Colour as measured, contrast held low.'
    },
    tone({ contrast: -10 }),
    presence({ saturation: -5 })
  ),
  look(
    'neutral-base',
    'Neutral Base',
    {
      tags: ['neutral', 'flat', 'grading', 'canon'],
      inspiredBy: insp('Neutral'),
      description: 'A low-contrast, low-saturation base to grade from.'
    },
    tone({ contrast: -20 }),
    presence({ saturation: -15 })
  ),
  look(
    'fine-detail',
    'Fine Detail',
    {
      tags: ['detail', 'texture', 'sharp', 'canon'],
      inspiredBy: insp('Fine Detail'),
      description: 'Fine texture brought forward, colour as standard.'
    },
    tone({ contrast: 5 }),
    presence({ saturation: 5, texture: 30 })
  ),
  look(
    'plain-mono',
    'Plain Mono',
    {
      tags: ['bw', 'mono', 'canon'],
      inspiredBy: insp('Monochrome'),
      description: 'A straightforward black and white.'
    },
    mono(),
    tone({ contrast: 10 })
  )
])
