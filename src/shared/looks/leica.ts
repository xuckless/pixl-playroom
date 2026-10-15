/**
 * Restrained contrast, long highlights and toned monochromes, in the spirit
 * of Leica's camera looks.
 */
import {
  collection,
  gain,
  gamma,
  grain,
  hsl,
  hueCurve,
  lift,
  look,
  matte,
  mono,
  offset,
  presence,
  prim,
  sCurve,
  tone,
  lumSat
} from './dsl'
import { tk } from '../i18n'

const insp = (name: string): string => `Leica ${name}`

export const LEICA = collection('camera/leica', [
  look(
    'quiet-natural',
    tk('Quiet Natural'),
    {
      tags: ['natural', 'accurate', 'subtle', 'leica'],
      inspiredBy: insp('Looks: Natural'),
      description: tk('Accurate colour with a long, quiet highlight roll-off.'),
      version: 2
    },
    sCurve(12),
    tone({ highlights: -22, shadows: 6 }),
    matte(0, 0.03),
    prim({ sat: -8 }),
    hueCurve('hueHue', [[120, 1.5]]),
    hueCurve('hueSat', [
      [60, 0.9],
      [120, 0.9]
    ]),
    // Colour eases off with the highlights.
    lumSat([
      [0, 1],
      [0.65, 1],
      [1, 0.8]
    ])
  ),
  look(
    'contemporary-clean',
    tk('Contemporary Clean'),
    {
      tags: ['contemporary', 'clean', 'modern', 'leica'],
      inspiredBy: insp('Looks: Contemporary'),
      description: tk('Clean modern contrast with smooth mid-to-highlight transitions.'),
      version: 2
    },
    sCurve(25),
    tone({ highlights: -10, blacks: -6 }),
    presence({ saturation: 6, clarity: 8 }),
    lift(205, 10),
    gain(30, 4),
    hueCurve('hueSat', [
      [0, 1.06],
      [240, 1.1]
    ]),
    hsl({ red: [0, 0, -4], blue: [0, 0, -8] })
  ),
  look(
    'analog-cinema',
    tk('Analog Cinema'),
    {
      tags: ['classic', 'analog', 'film', 'cinema', 'leica'],
      inspiredBy: insp('Looks: Classic'),
      description: tk('Soft, faded film character with teal shadows and warm highlights.'),
      version: 2
    },
    prim({ contrast: 0.97 }),
    tone({ highlights: -10 }),
    matte(0.03),
    presence({ saturation: -15 }),
    lift(190, 10),
    gain(45, 12),
    grain(8, 20, 40)
  ),
  look(
    'eternal-punch',
    tk('Eternal Punch'),
    {
      tags: ['punchy', 'saturated', 'contrast', 'bold', 'leica'],
      inspiredBy: insp('Looks: Eternal'),
      description: tk('Bold contrast and colour; lovely at half strength.'),
      version: 2
    },
    prim({ contrast: 1.18 }),
    tone({ blacks: -5 }),
    presence({ saturation: 25 }),
    offset(320, 4)
  ),
  look(
    'muted-slide',
    tk('Muted Slide'),
    {
      tags: ['chrome', 'slide', 'muted', 'restrained', 'leica'],
      inspiredBy: insp('Looks: Chrome'),
      description: tk('Slide-like restraint: firm contrast, quiet colour.'),
      version: 2
    },
    prim({ contrast: 1.11 }),
    presence({ saturation: -25 }),
    lift(195, 8),
    gain(50, 10),
    hueCurve('hueSat', [
      [60, 0.8],
      [120, 0.75]
    ])
  ),
  look(
    'teal-tone',
    tk('Teal Tone'),
    {
      tags: ['teal', 'cool', 'cinematic', 'leica'],
      inspiredBy: insp('Looks: Teal'),
      description: tk('Teal shadows with skin protected.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    lift(185, 25),
    gain(35, 10),
    hueCurve('hueHue', [[240, -4.5]]),
    hueCurve('hueSat', [[30, 1.05]])
  ),
  look(
    'brass-tone',
    tk('Brass Tone'),
    {
      tags: ['brass', 'warm', 'gold', 'vintage', 'leica'],
      inspiredBy: insp('Looks: Brass'),
      description: tk('Golden midtones and soft blacks, blues pulled back.'),
      version: 2
    },
    prim({ contrast: 1.03 }),
    matte(0.02),
    gamma(45, 20),
    gain(50, 15),
    hueCurve('hueSat', [[240, 0.7]])
  ),
  look(
    'blue-tone',
    tk('Blue Tone'),
    {
      tags: ['blue', 'cool', 'monochromatic', 'mood', 'leica'],
      inspiredBy: insp('Looks: Blue'),
      description: tk('A cool blue cast over muted colour.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: -30 }),
    offset(215, 25),
    lift(225, 20)
  ),
  look(
    'selenium-mono',
    tk('Selenium Mono'),
    {
      tags: ['bw', 'mono', 'selenium', 'toned', 'leica'],
      inspiredBy: insp('Looks: Selenium'),
      description: tk('Deep blacks with a cool purple-brown selenium tone.'),
      version: 2
    },
    mono(),
    prim({ contrast: 1.12 }),
    lift(280, 12)
  ),
  look(
    'sensor-mono',
    tk('Sensor Mono'),
    {
      tags: ['bw', 'mono', 'panchromatic', 'tonal', 'leica', 'monochrom'],
      inspiredBy: insp('M Monochrom'),
      description: tk('A long, even tonal scale from a sensor that sees only light.')
    },
    mono({ red: 10, orange: 8, yellow: 4 }),
    sCurve(15),
    tone({ shadows: 15, highlights: -20, blacks: -6 }),
    presence({ clarity: 8 }),
    grain(6, 15, 30)
  )
])
