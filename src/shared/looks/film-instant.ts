/** Instant colour and mono, fresh and faded. */
import {
  bloomApprox,
  collection,
  fade,
  hsl,
  look,
  mono,
  presence,
  split,
  tone,
  vignette,
  wheel
} from './dsl'
import { tk } from '../i18n'

export const FILM_INSTANT = collection('film/instant', [
  look(
    'instant-colour',
    tk('Instant Colour'),
    {
      tags: ['instant', 'polaroid', 'faded', 'square'],
      inspiredBy: 'Polaroid 600 film',
      description: tk('Milky blacks, cyan shadows and soft, warm highlights.')
    },
    tone({ contrast: -15 }),
    fade(0.08),
    presence({ saturation: -10, clarity: -10 }),
    split(190, 12, 60, 15),
    vignette(-15),
    bloomApprox(20)
  ),
  look(
    'faded-instant',
    tk('Faded Instant'),
    {
      tags: ['instant', 'polaroid', 'faded', 'vintage', 'sx-70'],
      inspiredBy: 'Aged Polaroid SX-70 prints',
      description: tk('An old, sun-faded instant print.')
    },
    tone({ contrast: -25 }),
    fade(0.1),
    presence({ saturation: -25 }),
    wheel('global', 40, 25),
    vignette(-25)
  ),
  look(
    'instant-mono',
    tk('Instant Mono'),
    {
      tags: ['bw', 'mono', 'instant', 'polaroid'],
      inspiredBy: 'Polaroid black-and-white film',
      description: tk('A soft, slightly warm instant mono.')
    },
    mono(),
    tone({ contrast: -10 }),
    fade(0.06),
    wheel('global', 35, 6)
  ),
  look(
    'bright-instant',
    tk('Bright Instant'),
    {
      tags: ['instant', 'bright', 'party', 'instax'],
      inspiredBy: 'Fujifilm Instax film',
      description: tk('Bright, clean and colourful, with cool shadows.')
    },
    tone({ contrast: 10, whites: 15, shadows: 10 }),
    presence({ saturation: 10 }),
    wheel('shadows', 175, 10),
    hsl({ orange: [0, 0, 5] }),
    vignette(-10)
  )
])
