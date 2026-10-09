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
import { tk } from '../i18n'

const gr = (name: string): string => `Ricoh GR ${name}`

export const RICOH = collection('camera/ricoh', [
  look(
    'positive-film',
    tk('Positive Film'),
    {
      tags: ['positive', 'slide', 'street', 'ricoh'],
      inspiredBy: gr('Positive Film'),
      description: tk('Contrasty slide colour with a faint yellow-green.')
    },
    tone({ contrast: 15 }),
    presence({ saturation: 20 }),
    wheel('global', 75, 6)
  ),
  look(
    'negative-film',
    tk('Negative Film'),
    {
      tags: ['negative', 'cool', 'street', 'blue', 'ricoh'],
      inspiredBy: gr('Negative Film'),
      description: tk('Cool, low-saturation negative with blue shadows.')
    },
    tone({ contrast: 25, whites: 10 }),
    presence({ saturation: -25 }),
    wheel('shadows', 210, 20),
    wheel('global', 205, 10)
  ),
  look(
    'street-bleach',
    tk('Street Bleach'),
    {
      tags: ['bleach bypass', 'gritty', 'street', 'ricoh'],
      inspiredBy: gr('Bleach Bypass'),
      description: tk('Hard and drained.')
    },
    tone({ contrast: 40 }),
    presence({ saturation: -50 }),
    wheel('shadows', 200, 5)
  ),
  look(
    'retro-print',
    tk('Retro Print'),
    {
      tags: ['retro', 'vintage', 'faded', 'warm', 'ricoh'],
      inspiredBy: gr('Retro'),
      description: tk('Faded, warm and vignetted.')
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -30 }),
    wheel('global', 45, 20),
    vignette(-25)
  ),
  look(
    'hi-contrast-street',
    tk('Hi-Contrast Street'),
    {
      tags: ['bw', 'mono', 'street', 'gritty', 'contrast', 'ricoh'],
      inspiredBy: gr('Hi-Contrast B&W'),
      description: tk('Inky blacks, blown whites and heavy grain.')
    },
    mono(),
    tone({ contrast: 80, blacks: -20, whites: 20 }),
    presence({ clarity: 30 }),
    grain(60, 45, 80),
    vignette(-40)
  ),
  look(
    'cross-process',
    tk('Cross Process'),
    {
      tags: ['cross process', 'creative', 'saturated', 'ricoh'],
      inspiredBy: gr('Cross Process'),
      description: tk('Cyan shadows, yellow highlights, loud colour.')
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
    tk('Cinema Yellow'),
    {
      tags: ['cinema', 'yellow', 'warm', 'ricoh'],
      inspiredBy: gr('Cinema (Yellow)'),
      description: tk('Muted cinema colour with yellow mids.')
    },
    tone({ contrast: 12 }),
    presence({ saturation: -18 }),
    wheel('midtones', 50, 22),
    wheel('highlights', 45, 16),
    wheel('shadows', 190, 8)
  ),
  look(
    'cinema-green',
    tk('Cinema Green'),
    {
      tags: ['cinema', 'green', 'teal', 'ricoh'],
      inspiredBy: gr('Cinema (Green)'),
      description: tk('Muted cinema colour with green mids.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    wheel('midtones', 150, 12),
    wheel('shadows', 175, 10)
  ),
  look(
    'soft-monotone',
    tk('Soft Monotone'),
    {
      tags: ['bw', 'mono', 'soft', 'ricoh'],
      inspiredBy: gr('Soft Monotone'),
      description: tk('A soft, faded mono.')
    },
    mono({ red: 6, orange: 6 }),
    tone({ contrast: -25, shadows: 10 }),
    fade(0.04),
    wheel('global', 30, 5)
  ),
  look(
    'hard-monotone',
    tk('Hard Monotone'),
    {
      tags: ['bw', 'mono', 'hard', 'ricoh'],
      inspiredBy: gr('Hard Monotone'),
      description: tk('A punchy, crisp mono.')
    },
    mono({ blue: -12, aqua: -6 }),
    tone({ contrast: 35, highlights: -15, blacks: -12 }),
    presence({ clarity: 25, texture: 10 })
  )
])
