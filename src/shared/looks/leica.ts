/**
 * Restrained contrast, long highlights and toned monochromes, in the spirit
 * of Leica's camera looks.
 */
import {
  collection,
  fade,
  grain,
  hsl,
  look,
  mono,
  presence,
  rolloff,
  sCurve,
  split,
  tone,
  wheel
} from './dsl'

const insp = (name: string): string => `Leica ${name}`

export const LEICA = collection('camera/leica', [
  look(
    'quiet-natural',
    'Quiet Natural',
    {
      tags: ['natural', 'accurate', 'subtle', 'leica'],
      inspiredBy: insp('Looks: Natural'),
      description: 'Accurate colour with a long, quiet highlight roll-off.'
    },
    sCurve(12),
    tone({ highlights: -22, shadows: 6 }),
    rolloff(0.03),
    presence({ saturation: -8 }),
    hsl({ yellow: [0, -10, 0], green: [5, -10, 0] })
  ),
  look(
    'contemporary-clean',
    'Contemporary Clean',
    {
      tags: ['contemporary', 'clean', 'modern', 'leica'],
      inspiredBy: insp('Looks: Contemporary'),
      description: 'Clean modern contrast with smooth mid-to-highlight transitions.'
    },
    sCurve(25),
    tone({ highlights: -10, blacks: -6 }),
    presence({ saturation: 6, clarity: 8 }),
    split(205, 10, 30, 4),
    hsl({ red: [0, 6, -4], blue: [0, 10, -8] })
  ),
  look(
    'analog-cinema',
    'Analog Cinema',
    {
      tags: ['classic', 'analog', 'film', 'cinema', 'leica'],
      inspiredBy: insp('Looks: Classic'),
      description: 'Soft, faded film character with teal shadows and warm highlights.'
    },
    tone({ contrast: -5, highlights: -10 }),
    fade(0.03),
    presence({ saturation: -15 }),
    split(190, 10, 45, 12),
    grain(8, 20, 40)
  ),
  look(
    'eternal-punch',
    'Eternal Punch',
    {
      tags: ['punchy', 'saturated', 'contrast', 'bold', 'leica'],
      inspiredBy: insp('Looks: Eternal'),
      description: 'Bold contrast and colour; lovely at half strength.'
    },
    tone({ contrast: 30, blacks: -5 }),
    presence({ saturation: 25 }),
    wheel('global', 320, 4)
  ),
  look(
    'muted-slide',
    'Muted Slide',
    {
      tags: ['chrome', 'slide', 'muted', 'restrained', 'leica'],
      inspiredBy: insp('Looks: Chrome'),
      description: 'Slide-like restraint: firm contrast, quiet colour.'
    },
    tone({ contrast: 18 }),
    presence({ saturation: -25 }),
    split(195, 8, 50, 10),
    hsl({ yellow: [0, -20, 0], green: [0, -25, 0] })
  ),
  look(
    'teal-tone',
    'Teal Tone',
    {
      tags: ['teal', 'cool', 'cinematic', 'leica'],
      inspiredBy: insp('Looks: Teal'),
      description: 'Teal shadows with skin protected.'
    },
    tone({ contrast: 10 }),
    split(185, 25, 35, 10),
    hsl({ orange: [0, 5, 0], blue: [-15, 0, 0] })
  ),
  look(
    'brass-tone',
    'Brass Tone',
    {
      tags: ['brass', 'warm', 'gold', 'vintage', 'leica'],
      inspiredBy: insp('Looks: Brass'),
      description: 'Golden midtones and soft blacks, blues pulled back.'
    },
    tone({ contrast: 5 }),
    fade(0.02),
    wheel('midtones', 45, 20),
    wheel('highlights', 50, 15),
    hsl({ blue: [0, -30, 0] })
  ),
  look(
    'blue-tone',
    'Blue Tone',
    {
      tags: ['blue', 'cool', 'monochromatic', 'mood', 'leica'],
      inspiredBy: insp('Looks: Blue'),
      description: 'A cool blue cast over muted colour.'
    },
    tone({ contrast: 10 }),
    presence({ saturation: -30 }),
    wheel('global', 215, 25),
    wheel('shadows', 225, 20)
  ),
  look(
    'selenium-mono',
    'Selenium Mono',
    {
      tags: ['bw', 'mono', 'selenium', 'toned', 'leica'],
      inspiredBy: insp('Looks: Selenium'),
      description: 'Deep blacks with a cool purple-brown selenium tone.'
    },
    mono(),
    tone({ contrast: 20 }),
    wheel('shadows', 280, 12)
  ),
  look(
    'sensor-mono',
    'Sensor Mono',
    {
      tags: ['bw', 'mono', 'panchromatic', 'tonal', 'leica', 'monochrom'],
      inspiredBy: insp('M Monochrom'),
      description: 'A long, even tonal scale from a sensor that sees only light.'
    },
    mono({ red: 10, orange: 8, yellow: 4 }),
    sCurve(15),
    tone({ shadows: 15, highlights: -20, blacks: -6 }),
    presence({ clarity: 8 }),
    grain(6, 15, 30)
  )
])
