/** Street looks in the spirit of Ricoh GR's image controls. */
import {
  collection,
  fade,
  grain,
  look,
  mono,
  presence,
  rgb,
  split,
  tone,
  vignette,
  wheel
} from './dsl'

const gr = (name: string): string => `Ricoh GR ${name}`

export const RICOH = collection('camera/ricoh', [
  look(
    'positive-film',
    'Positive Film',
    {
      tags: ['positive', 'slide', 'street', 'ricoh'],
      inspiredBy: gr('Positive Film'),
      description: 'Contrasty slide colour with a faint yellow-green.'
    },
    tone({ contrast: 15 }),
    presence({ saturation: 20 }),
    wheel('global', 75, 6)
  ),
  look(
    'negative-film',
    'Negative Film',
    {
      tags: ['negative', 'cool', 'street', 'blue', 'ricoh'],
      inspiredBy: gr('Negative Film'),
      description: 'Cool, low-saturation negative with blue shadows.'
    },
    tone({ contrast: 25, whites: 10 }),
    presence({ saturation: -25 }),
    wheel('shadows', 210, 20),
    wheel('global', 205, 10)
  ),
  look(
    'street-bleach',
    'Street Bleach',
    {
      tags: ['bleach bypass', 'gritty', 'street', 'ricoh'],
      inspiredBy: gr('Bleach Bypass'),
      description: 'Hard and drained.'
    },
    tone({ contrast: 40 }),
    presence({ saturation: -50 }),
    wheel('shadows', 200, 5)
  ),
  look(
    'retro-print',
    'Retro Print',
    {
      tags: ['retro', 'vintage', 'faded', 'warm', 'ricoh'],
      inspiredBy: gr('Retro'),
      description: 'Faded, warm and vignetted.'
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -30 }),
    wheel('global', 45, 20),
    vignette(-25)
  ),
  look(
    'hi-contrast-street',
    'Hi-Contrast Street',
    {
      tags: ['bw', 'mono', 'street', 'gritty', 'contrast', 'ricoh'],
      inspiredBy: gr('Hi-Contrast B&W'),
      description: 'Inky blacks, blown whites and heavy grain.'
    },
    mono(),
    tone({ contrast: 80, blacks: -20, whites: 20 }),
    presence({ clarity: 30 }),
    grain(60, 45, 80),
    vignette(-40)
  ),
  look(
    'cross-process',
    'Cross Process',
    {
      tags: ['cross process', 'creative', 'saturated', 'ricoh'],
      inspiredBy: gr('Cross Process'),
      description: 'Cyan shadows, yellow highlights, loud colour.'
    },
    tone({ contrast: 25 }),
    presence({ saturation: 20 }),
    split(200, 25, 65, 25),
    rgb({
      b: [
        [0, 0.06],
        [0.5, 0.48],
        [1, 0.9]
      ]
    })
  ),
  look(
    'cinema-yellow',
    'Cinema Yellow',
    {
      tags: ['cinema', 'yellow', 'warm', 'ricoh'],
      inspiredBy: gr('Cinema (Yellow)'),
      description: 'Muted cinema colour with yellow mids.'
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    wheel('midtones', 50, 15),
    wheel('highlights', 45, 10)
  ),
  look(
    'cinema-green',
    'Cinema Green',
    {
      tags: ['cinema', 'green', 'teal', 'ricoh'],
      inspiredBy: gr('Cinema (Green)'),
      description: 'Muted cinema colour with green mids.'
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    wheel('midtones', 150, 12),
    wheel('shadows', 175, 10)
  ),
  look(
    'soft-monotone',
    'Soft Monotone',
    {
      tags: ['bw', 'mono', 'soft', 'ricoh'],
      inspiredBy: gr('Soft Monotone'),
      description: 'A soft, faded mono.'
    },
    mono(),
    tone({ contrast: -25 }),
    fade(0.04)
  ),
  look(
    'hard-monotone',
    'Hard Monotone',
    {
      tags: ['bw', 'mono', 'hard', 'ricoh'],
      inspiredBy: gr('Hard Monotone'),
      description: 'A punchy, crisp mono.'
    },
    mono(),
    tone({ contrast: 40 }),
    presence({ clarity: 15 })
  )
])
