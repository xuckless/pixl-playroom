/** Street looks in the spirit of Ricoh GR's image controls. */
import {
  collection,
  gain,
  gamma,
  grain,
  lift,
  look,
  matte,
  mono,
  offset,
  presence,
  prim,
  rgb,
  tone,
  vignette,
  lumSat
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
      description: tk('Contrasty slide colour with a faint yellow-green.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    presence({ saturation: 20 }),
    offset(75, 6)
  ),
  look(
    'negative-film',
    tk('Negative Film'),
    {
      tags: ['negative', 'cool', 'street', 'blue', 'ricoh'],
      inspiredBy: gr('Negative Film'),
      description: tk('Cool, low-saturation negative with blue shadows.'),
      version: 2
    },
    prim({ contrast: 1.15 }),
    tone({ whites: 10 }),
    presence({ saturation: -25 }),
    lift(210, 20),
    offset(205, 10)
  ),
  look(
    'street-bleach',
    tk('Street Bleach'),
    {
      tags: ['bleach bypass', 'gritty', 'street', 'ricoh'],
      inspiredBy: gr('Bleach Bypass'),
      description: tk('Hard and drained.'),
      version: 2
    },
    prim({ contrast: 1.24 }),
    presence({ saturation: -50 }),
    lift(200, 5),
    // Silver left in: the ends lose colour first.
    lumSat([
      [0, 0.7],
      [0.35, 1],
      [0.65, 1],
      [1, 0.7]
    ])
  ),
  look(
    'retro-print',
    tk('Retro Print'),
    {
      tags: ['retro', 'vintage', 'faded', 'warm', 'ricoh'],
      inspiredBy: gr('Retro'),
      description: tk('Faded, warm and vignetted.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    matte(0.05),
    presence({ saturation: -30 }),
    offset(45, 20),
    vignette(-25)
  ),
  look(
    'hi-contrast-street',
    tk('Hi-Contrast Street'),
    {
      tags: ['bw', 'mono', 'street', 'gritty', 'contrast', 'ricoh'],
      inspiredBy: gr('Hi-Contrast B&W'),
      description: tk('Inky blacks, blown whites and heavy grain.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.48 }),
    tone({ blacks: -20, whites: 20 }),
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
      description: tk('Cyan shadows, yellow highlights, loud colour.'),
      version: 2
    },
    tone({ contrast: 25 }),
    presence({ saturation: 20 }),
    lift(200, 25),
    gain(65, 25),
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
      description: tk('Muted cinema colour with yellow mids.'),
      version: 2
    },
    prim({ contrast: 1.07 }),
    presence({ saturation: -18 }),
    gamma(50, 22),
    gain(45, 16),
    lift(190, 8)
  ),
  look(
    'cinema-green',
    tk('Cinema Green'),
    {
      tags: ['cinema', 'green', 'teal', 'ricoh'],
      inspiredBy: gr('Cinema (Green)'),
      description: tk('Muted cinema colour with green mids.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -15 }),
    gamma(150, 12),
    lift(175, 10)
  ),
  look(
    'soft-monotone',
    tk('Soft Monotone'),
    {
      tags: ['bw', 'mono', 'soft', 'ricoh'],
      inspiredBy: gr('Soft Monotone'),
      description: tk('A soft, faded mono.'),
      version: 2
    },
    mono({ red: 6, orange: 6 }),
    prim({ contrast: 0.85 }),
    tone({ shadows: 10 }),
    matte(0.04),
    offset(30, 5)
  ),
  look(
    'hard-monotone',
    tk('Hard Monotone'),
    {
      tags: ['bw', 'mono', 'hard', 'ricoh'],
      inspiredBy: gr('Hard Monotone'),
      description: tk('A punchy, crisp mono.'),
      version: 2
    },
    mono({ blue: -12, aqua: -6 }),
    prim({ contrast: 1.21 }),
    tone({ highlights: -15, blacks: -12 }),
    presence({ clarity: 25, texture: 10 })
  )
])
