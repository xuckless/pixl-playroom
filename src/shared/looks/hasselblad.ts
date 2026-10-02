/** Natural, accurate colour with a gentle film curve, in Hasselblad's spirit. */
import {
  collection,
  fade,
  foliage,
  grain,
  hsl,
  look,
  presence,
  rolloff,
  sCurve,
  split,
  tone,
  wheel
} from './dsl'

export const HASSELBLAD = collection('camera/hasselblad', [
  look(
    'natural-colour',
    'Natural Colour',
    {
      tags: ['natural', 'accurate', 'medium format', 'hncs', 'hasselblad'],
      inspiredBy: 'Hasselblad Natural Colour Solution',
      description: 'True hues, a gentle film curve and very long highlights.'
    },
    sCurve(22),
    rolloff(0.03),
    tone({ highlights: -18, shadows: 6 }),
    presence({ vibrance: 10 }),
    // Yellow-greens tamed and blues deepened: the "true" medium-format rendering.
    hsl({ orange: [0, -3, 3], yellow: [-4, -12, 0], green: [6, -6, 0], blue: [0, 8, -8] })
  ),
  look(
    'natural-portrait',
    'Natural Portrait',
    {
      tags: ['portrait', 'skin', 'natural', 'medium format', 'hasselblad'],
      inspiredBy: 'Hasselblad Natural Colour Solution (portrait)',
      description: 'Natural colour tuned for even, creamy skin.'
    },
    sCurve(12),
    rolloff(0.03),
    tone({ highlights: -18, shadows: 10 }),
    presence({ texture: -12 }),
    wheel('highlights', 35, 8),
    hsl({ orange: [-3, -6, 10], red: [0, -8, 4], yellow: [0, -8, 0] })
  ),
  look(
    'panoramic-travel',
    'Panoramic Travel',
    {
      tags: ['travel', 'landscape', 'warm', 'film', 'xpan', 'hasselblad'],
      inspiredBy: 'Hasselblad XPan travel film',
      description: 'A warm, slightly faded travel film look for wide frames.'
    },
    sCurve(22),
    fade(0.03),
    tone({ highlights: -12 }),
    presence({ saturation: -8 }),
    split(200, 12, 40, 16),
    wheel('global', 40, 6),
    hsl({ blue: [-6, -10, 0] }),
    foliage(10, -15, 0),
    grain(12, 20, 40)
  )
])
