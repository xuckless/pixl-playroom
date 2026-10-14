/** Creative-look styles and cine skin tones, in the spirit of Sony's cameras. */
import {
  collection,
  gain,
  hsl,
  hueCurve,
  lift,
  look,
  matte,
  mono,
  offset,
  presence,
  prim,
  tone
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
      description: tk('A clean, lightly lifted standard.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    tone({ whites: 10, blacks: -5 }),
    presence({ saturation: 8, vibrance: 6, clarity: 6 }),
    offset(210, 4),
    hueCurve('hueSat', [
      [240, 1.12],
      [180, 1.08]
    ]),
    hsl({ blue: [0, 0, -5] })
  ),
  look(
    'soft-skin',
    tk('Soft Skin'),
    {
      tags: ['portrait', 'skin', 'soft', 'pt', 'sony'],
      inspiredBy: cl('PT'),
      description: tk('Soft contrast and bright, smooth skin.'),
      version: 2
    },
    prim({ contrast: 0.93 }),
    tone({ highlights: -10, shadows: 12 }),
    presence({ texture: -18, clarity: -5 }),
    gain(345, 8),
    hueCurve('hueHue', [[30, -1.5]]),
    hueCurve('hueSat', [
      [30, 0.92],
      [0, 0.95]
    ]),
    hsl({ orange: [0, 0, 12], red: [0, 0, 5] })
  ),
  look(
    'muted-neutral',
    tk('Muted Neutral'),
    {
      tags: ['neutral', 'muted', 'calm', 'nt', 'sony'],
      inspiredBy: cl('NT'),
      description: tk('Quiet colour and softened detail.'),
      version: 2
    },
    prim({ contrast: 0.91 }),
    tone({ highlights: -10 }),
    presence({ saturation: -25, texture: -15 }),
    offset(215, 4)
  ),
  look(
    'saturated-vivid',
    tk('Saturated Vivid'),
    {
      tags: ['vivid', 'saturated', 'vv', 'sony'],
      inspiredBy: cl('VV'),
      description: tk('Saturated colour and firm contrast.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    presence({ saturation: 22 }),
    offset(20, 3),
    hueCurve('hueSat', [
      [0, 1.15],
      [30, 1.1]
    ])
  ),
  look(
    'vivid-clear',
    tk('Vivid Clear'),
    {
      tags: ['vivid', 'clear', 'bright', 'vv2', 'sony'],
      inspiredBy: cl('VV2'),
      description: tk('Bright, clear and colourful.'),
      version: 2
    },
    tone({ whites: 10, shadows: 5 }),
    prim({ sat: 20 }),
    presence({ clarity: 15 })
  ),
  look(
    'film-mood',
    tk('Film Mood'),
    {
      tags: ['film', 'mood', 'faded', 'teal', 'fl', 'sony'],
      inspiredBy: cl('FL'),
      description: tk('Moody film contrast with faded blacks and teal skies.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    matte(0.03),
    presence({ saturation: -15 }),
    lift(190, 10),
    gain(50, 8),
    hueCurve('hueHue', [
      [240, -3],
      [120, 3],
      [60, 1.8]
    ]),
    hueCurve('hueSat', [
      [120, 0.85],
      [60, 0.91]
    ])
  ),
  look(
    'instant-matte',
    tk('Instant Matte'),
    {
      tags: ['matte', 'faded', 'instant', 'in', 'sony'],
      inspiredBy: cl('IN'),
      description: tk('Flat, matte and warm, like an instant print.'),
      version: 2
    },
    prim({ contrast: 0.85 }),
    matte(0.06),
    presence({ saturation: -25 }),
    offset(40, 8)
  ),
  look(
    'soft-high-key',
    tk('Soft High-Key'),
    {
      tags: ['high key', 'bright', 'airy', 'sh', 'sony'],
      inspiredBy: cl('SH'),
      description: tk('Bright, soft and a little cool.'),
      version: 2
    },
    prim({ contrast: 0.91 }),
    tone({ shadows: 20, whites: 20, highlights: 10 }),
    presence({ vibrance: 15 }),
    offset(200, 5)
  ),
  look(
    'studio-mono',
    tk('Studio Mono'),
    {
      tags: ['bw', 'mono', 'sony'],
      inspiredBy: cl('BW'),
      description: tk('A crisp, punchy black and white.'),
      version: 2
    },
    mono({ blue: -10, aqua: -5 }),
    prim({ contrast: 1.13 }),
    tone({ whites: 12, blacks: -12 }),
    presence({ clarity: 10 })
  ),
  look(
    'warm-sepia',
    tk('Warm Sepia'),
    {
      tags: ['bw', 'sepia', 'toned', 'se', 'sony'],
      inspiredBy: cl('SE'),
      description: tk('A warm sepia-toned mono.'),
      version: 2
    },
    mono(),
    offset(35, 30)
  ),
  look(
    'cine-skin-tone',
    tk('Cine Skin Tone'),
    {
      tags: ['cinema', 'skin', 'video', 's-cinetone', 'sony'],
      inspiredBy: 'Sony S-Cinetone',
      description: tk('Soft highlights and warm, cinematic skin.'),
      version: 2
    },
    prim({ contrast: 1.03 }),
    tone({ whites: -20, highlights: -18, shadows: 6 }),
    matte(0, 0.03),
    presence({ saturation: -6 }),
    lift(190, 8),
    gain(35, 12),
    offset(30, 6),
    hueCurve('hueHue', [
      [30, -0.9],
      [120, 3]
    ]),
    hueCurve('hueSat', [
      [30, 1.1],
      [60, 0.88],
      [120, 0.78]
    ]),
    hsl({ orange: [0, 0, 4] })
  )
])
