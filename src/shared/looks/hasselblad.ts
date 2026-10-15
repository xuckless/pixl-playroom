/** Natural, accurate colour with a gentle film curve, in Hasselblad's spirit. */
import {
  collection,
  gain,
  grain,
  hsl,
  hueCurve,
  lift,
  look,
  matte,
  offset,
  presence,
  sCurve,
  tone
} from './dsl'
import { tk } from '../i18n'

export const HASSELBLAD = collection('camera/hasselblad', [
  look(
    'natural-colour',
    tk('Natural Colour'),
    {
      tags: ['natural', 'accurate', 'medium format', 'hncs', 'hasselblad'],
      inspiredBy: 'Hasselblad Natural Colour Solution',
      description: tk('True hues, a gentle film curve and very long highlights.'),
      version: 2
    },
    sCurve(22),
    matte(0, 0.03),
    tone({ highlights: -18, shadows: 6 }),
    presence({ vibrance: 10 }),
    hueCurve('hueHue', [
      [60, -1.2],
      [120, 1.8]
    ]),
    hueCurve('hueSat', [
      [30, 0.97],
      [60, 0.88],
      [120, 0.94],
      [240, 1.08]
    ]),
    hsl({ orange: [0, 0, 3], blue: [0, 0, -8] })
  ),
  look(
    'natural-portrait',
    tk('Natural Portrait'),
    {
      tags: ['portrait', 'skin', 'natural', 'medium format', 'hasselblad'],
      inspiredBy: 'Hasselblad Natural Colour Solution (portrait)',
      description: tk('Natural colour tuned for even, creamy skin.'),
      version: 2
    },
    sCurve(12),
    matte(0, 0.03),
    tone({ highlights: -18, shadows: 10 }),
    presence({ texture: -12 }),
    gain(35, 8),
    hueCurve('hueHue', [[30, -0.9]]),
    hueCurve('hueSat', [
      [30, 0.94],
      [0, 0.92],
      [60, 0.92]
    ]),
    hsl({ orange: [0, 0, 10], red: [0, 0, 4] })
  ),
  look(
    'panoramic-travel',
    tk('Panoramic Travel'),
    {
      tags: ['travel', 'landscape', 'warm', 'film', 'xpan', 'hasselblad'],
      inspiredBy: 'Hasselblad XPan travel film',
      description: tk('A warm, slightly faded travel film look for wide frames.'),
      version: 2
    },
    sCurve(22),
    matte(0.03),
    tone({ highlights: -12 }),
    presence({ saturation: -8 }),
    lift(200, 12),
    gain(40, 16),
    offset(40, 6),
    hueCurve('hueHue', [
      [240, -1.8],
      [120, 3],
      [60, 1.8]
    ]),
    hueCurve('hueSat', [
      [240, 0.9],
      [120, 0.85],
      [60, 0.91]
    ]),
    grain(12, 20, 40)
  )
])
