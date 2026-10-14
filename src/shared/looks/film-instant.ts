/** Instant colour and mono, fresh and faded. */
import {
  bloomApprox,
  collection,
  gain,
  hsl,
  lift,
  look,
  matte,
  mono,
  offset,
  presence,
  prim,
  tone,
  vignette
} from './dsl'
import { tk } from '../i18n'

export const FILM_INSTANT = collection('film/instant', [
  look(
    'instant-colour',
    tk('Instant Colour'),
    {
      tags: ['instant', 'polaroid', 'faded', 'square'],
      inspiredBy: 'Polaroid 600 film',
      description: tk('Milky blacks, cyan shadows and soft, warm highlights.'),
      version: 2
    },
    prim({ contrast: 0.91 }),
    matte(0.08),
    presence({ saturation: -10, clarity: -10 }),
    lift(190, 12),
    gain(60, 15),
    vignette(-15),
    bloomApprox(20)
  ),
  look(
    'faded-instant',
    tk('Faded Instant'),
    {
      tags: ['instant', 'polaroid', 'faded', 'vintage', 'sx-70'],
      inspiredBy: 'Aged Polaroid SX-70 prints',
      description: tk('An old, sun-faded instant print.'),
      version: 2
    },
    prim({ contrast: 0.85 }),
    matte(0.1),
    presence({ saturation: -25 }),
    offset(40, 25),
    vignette(-25)
  ),
  look(
    'instant-mono',
    tk('Instant Mono'),
    {
      tags: ['bw', 'mono', 'instant', 'polaroid'],
      inspiredBy: 'Polaroid black-and-white film',
      description: tk('A soft, slightly warm instant mono.'),
      version: 2
    },
    mono(),
    prim({ contrast: 0.94 }),
    matte(0.06),
    offset(35, 6)
  ),
  look(
    'bright-instant',
    tk('Bright Instant'),
    {
      tags: ['instant', 'bright', 'party', 'instax'],
      inspiredBy: 'Fujifilm Instax film',
      description: tk('Bright, clean and colourful, with cool shadows.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    tone({ whites: 15, shadows: 10 }),
    presence({ saturation: 10 }),
    lift(175, 10),
    hsl({ orange: [0, 0, 5] }),
    vignette(-10)
  )
])
