/** Creative-look styles and cine skin tones, in the spirit of Sony's cameras. */
import {
  collection,
  fade,
  foliage,
  hsl,
  look,
  mono,
  presence,
  rolloff,
  split,
  tone,
  wheel
} from './dsl'
import { tk } from '../i18n'

const cl = (name: string): string => `Sony Creative Look ${name}`

export const SONY = collection('camera/sony', [
  look(
    'clean-standard',
    tk('Clean Standard'),
    {
      tags: ['standard', 'everyday', 'st', 'sony'],
      inspiredBy: cl('ST'),
      description: tk('A clean, lightly lifted standard.')
    },
    tone({ contrast: 10, whites: 10, blacks: -5 }),
    presence({ saturation: 8, vibrance: 6, clarity: 6 }),
    wheel('global', 210, 4),
    hsl({ blue: [0, 12, -5], aqua: [0, 8, 0] })
  ),
  look(
    'soft-skin',
    tk('Soft Skin'),
    {
      tags: ['portrait', 'skin', 'soft', 'pt', 'sony'],
      inspiredBy: cl('PT'),
      description: tk('Soft contrast and bright, smooth skin.')
    },
    tone({ contrast: -12, highlights: -10, shadows: 12 }),
    presence({ texture: -18, clarity: -5 }),
    wheel('highlights', 345, 8),
    hsl({ orange: [-5, -8, 12], red: [0, -5, 5] })
  ),
  look(
    'muted-neutral',
    tk('Muted Neutral'),
    {
      tags: ['neutral', 'muted', 'calm', 'nt', 'sony'],
      inspiredBy: cl('NT'),
      description: tk('Quiet colour and softened detail.')
    },
    tone({ contrast: -15, highlights: -10 }),
    presence({ saturation: -25, texture: -15 }),
    wheel('global', 215, 4)
  ),
  look(
    'saturated-vivid',
    tk('Saturated Vivid'),
    {
      tags: ['vivid', 'saturated', 'vv', 'sony'],
      inspiredBy: cl('VV'),
      description: tk('Saturated colour and firm contrast.')
    },
    tone({ contrast: 15 }),
    presence({ saturation: 22 }),
    wheel('global', 20, 3),
    hsl({ red: [0, 15, 0], orange: [0, 10, 0] })
  ),
  look(
    'vivid-clear',
    tk('Vivid Clear'),
    {
      tags: ['vivid', 'clear', 'bright', 'vv2', 'sony'],
      inspiredBy: cl('VV2'),
      description: tk('Bright, clear and colourful.')
    },
    tone({ whites: 10, shadows: 5 }),
    presence({ saturation: 20, clarity: 15 })
  ),
  look(
    'film-mood',
    tk('Film Mood'),
    {
      tags: ['film', 'mood', 'faded', 'teal', 'fl', 'sony'],
      inspiredBy: cl('FL'),
      description: tk('Moody film contrast with faded blacks and teal skies.')
    },
    tone({ contrast: 20 }),
    fade(0.03),
    presence({ saturation: -15 }),
    split(190, 10, 50, 8),
    hsl({ blue: [-10, 0, 0] }),
    foliage(10, -15, 0)
  ),
  look(
    'instant-matte',
    tk('Instant Matte'),
    {
      tags: ['matte', 'faded', 'instant', 'in', 'sony'],
      inspiredBy: cl('IN'),
      description: tk('Flat, matte and warm, like an instant print.')
    },
    tone({ contrast: -25 }),
    fade(0.06),
    presence({ saturation: -25 }),
    wheel('global', 40, 8)
  ),
  look(
    'soft-high-key',
    tk('Soft High-Key'),
    {
      tags: ['high key', 'bright', 'airy', 'sh', 'sony'],
      inspiredBy: cl('SH'),
      description: tk('Bright, soft and a little cool.')
    },
    tone({ contrast: -15, shadows: 20, whites: 20, highlights: 10 }),
    presence({ vibrance: 15 }),
    wheel('global', 200, 5)
  ),
  look(
    'studio-mono',
    tk('Studio Mono'),
    {
      tags: ['bw', 'mono', 'sony'],
      inspiredBy: cl('BW'),
      description: tk('A crisp, punchy black and white.')
    },
    mono({ blue: -10, aqua: -5 }),
    tone({ contrast: 22, whites: 12, blacks: -12 }),
    presence({ clarity: 10 })
  ),
  look(
    'warm-sepia',
    tk('Warm Sepia'),
    {
      tags: ['bw', 'sepia', 'toned', 'se', 'sony'],
      inspiredBy: cl('SE'),
      description: tk('A warm sepia-toned mono.')
    },
    mono(),
    wheel('global', 35, 30)
  ),
  look(
    'cine-skin-tone',
    tk('Cine Skin Tone'),
    {
      tags: ['cinema', 'skin', 'video', 's-cinetone', 'sony'],
      inspiredBy: 'Sony S-Cinetone',
      description: tk('Soft highlights and warm, cinematic skin.')
    },
    tone({ contrast: 5, whites: -20, highlights: -18, shadows: 6 }),
    rolloff(0.03),
    presence({ saturation: -6 }),
    split(190, 8, 35, 12),
    wheel('global', 30, 6),
    hsl({ orange: [-3, 10, 4], yellow: [0, -12, 0], green: [10, -22, 0] })
  )
])
