/** Natural, accurate colour with a gentle film curve, in Hasselblad's spirit. */
import { collection, grain, hsl, look, presence, rolloff, sCurve, split, tone, wheel } from './dsl'

export const HASSELBLAD = collection('camera/hasselblad', [
  look(
    'natural-colour',
    'Natural Colour',
    {
      tags: ['natural', 'accurate', 'medium format', 'hncs', 'hasselblad'],
      inspiredBy: 'Hasselblad Natural Colour Solution',
      description: 'True hues, a gentle film curve and very long highlights.'
    },
    sCurve(15),
    rolloff(0.02),
    tone({ highlights: -10 }),
    presence({ vibrance: 5 }),
    hsl({ orange: [0, -3, 0] })
  ),
  look(
    'natural-portrait',
    'Natural Portrait',
    {
      tags: ['portrait', 'skin', 'natural', 'medium format', 'hasselblad'],
      inspiredBy: 'Hasselblad Natural Colour Solution (portrait)',
      description: 'Natural colour tuned for even, creamy skin.'
    },
    sCurve(10),
    rolloff(0.02),
    tone({ highlights: -12, shadows: 5 }),
    presence({ texture: -8 }),
    hsl({ orange: [-2, -5, 5], red: [0, -5, 0] })
  ),
  look(
    'panoramic-travel',
    'Panoramic Travel',
    {
      tags: ['travel', 'landscape', 'warm', 'film', 'xpan', 'hasselblad'],
      inspiredBy: 'Hasselblad XPan travel film',
      description: 'A warm, slightly faded travel film look for wide frames.'
    },
    sCurve(20),
    tone({ highlights: -10 }),
    split(200, 6, 40, 10),
    wheel('global', 40, 4),
    grain(10, 20, 40)
  )
])
