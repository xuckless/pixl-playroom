/** Creative-look styles and cine skin tones, in the spirit of Sony's cameras. */
import { collection, fade, hsl, look, mono, presence, split, tone, wheel } from './dsl'

const cl = (name: string): string => `Sony Creative Look ${name}`

export const SONY = collection('camera/sony', [
  look(
    'clean-standard',
    'Clean Standard',
    {
      tags: ['standard', 'everyday', 'st', 'sony'],
      inspiredBy: cl('ST'),
      description: 'A clean, lightly lifted standard.'
    },
    tone({ contrast: 5 }),
    presence({ saturation: 5 })
  ),
  look(
    'soft-skin',
    'Soft Skin',
    {
      tags: ['portrait', 'skin', 'soft', 'pt', 'sony'],
      inspiredBy: cl('PT'),
      description: 'Soft contrast and bright, smooth skin.'
    },
    tone({ contrast: -5 }),
    presence({ texture: -10 }),
    hsl({ orange: [0, -5, 5] })
  ),
  look(
    'muted-neutral',
    'Muted Neutral',
    {
      tags: ['neutral', 'muted', 'calm', 'nt', 'sony'],
      inspiredBy: cl('NT'),
      description: 'Quiet colour and softened detail.'
    },
    tone({ contrast: -10 }),
    presence({ saturation: -20, texture: -10 })
  ),
  look(
    'saturated-vivid',
    'Saturated Vivid',
    {
      tags: ['vivid', 'saturated', 'vv', 'sony'],
      inspiredBy: cl('VV'),
      description: 'Saturated colour and firm contrast.'
    },
    tone({ contrast: 15 }),
    presence({ saturation: 25 })
  ),
  look(
    'vivid-clear',
    'Vivid Clear',
    {
      tags: ['vivid', 'clear', 'bright', 'vv2', 'sony'],
      inspiredBy: cl('VV2'),
      description: 'Bright, clear and colourful.'
    },
    tone({ whites: 10, shadows: 5 }),
    presence({ saturation: 20, clarity: 15 })
  ),
  look(
    'film-mood',
    'Film Mood',
    {
      tags: ['film', 'mood', 'faded', 'teal', 'fl', 'sony'],
      inspiredBy: cl('FL'),
      description: 'Moody film contrast with faded blacks and teal skies.'
    },
    tone({ contrast: 20 }),
    fade(0.03),
    presence({ saturation: -15 }),
    split(190, 10, 50, 8),
    hsl({ green: [10, -15, 0], blue: [-10, 0, 0] })
  ),
  look(
    'instant-matte',
    'Instant Matte',
    {
      tags: ['matte', 'faded', 'instant', 'in', 'sony'],
      inspiredBy: cl('IN'),
      description: 'Flat, matte and warm, like an instant print.'
    },
    tone({ contrast: -25 }),
    fade(0.06),
    presence({ saturation: -25 }),
    wheel('global', 40, 8)
  ),
  look(
    'soft-high-key',
    'Soft High-Key',
    {
      tags: ['high key', 'bright', 'airy', 'sh', 'sony'],
      inspiredBy: cl('SH'),
      description: 'Bright, soft and a little cool.'
    },
    tone({ contrast: -15, shadows: 20, whites: 20, highlights: 10 }),
    presence({ vibrance: 15 }),
    wheel('global', 200, 5)
  ),
  look(
    'studio-mono',
    'Studio Mono',
    { tags: ['bw', 'mono', 'sony'], inspiredBy: cl('BW'), description: 'A neat black and white.' },
    mono(),
    tone({ contrast: 10 })
  ),
  look(
    'warm-sepia',
    'Warm Sepia',
    {
      tags: ['bw', 'sepia', 'toned', 'se', 'sony'],
      inspiredBy: cl('SE'),
      description: 'A warm sepia-toned mono.'
    },
    mono(),
    wheel('global', 35, 30)
  ),
  look(
    'cine-skin-tone',
    'Cine Skin Tone',
    {
      tags: ['cinema', 'skin', 'video', 's-cinetone', 'sony'],
      inspiredBy: 'Sony S-Cinetone',
      description: 'Soft highlights and warm, cinematic skin.'
    },
    tone({ contrast: 5, whites: -15, highlights: -10 }),
    presence({ saturation: -5 }),
    wheel('global', 30, 4),
    hsl({ orange: [-2, 5, 0], green: [0, -10, 0] })
  )
])
