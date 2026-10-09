/**
 * Cine-camera colour science, camera negative and theatre print, in the
 * spirit of the cameras and stocks films are made on.
 */
import {
  approximates,
  collection,
  fade,
  grain,
  halationApprox,
  hsl,
  look,
  mono,
  presence,
  rolloff,
  sCurve,
  split,
  tone,
  vignette,
  wheel
} from './dsl'
import { tk } from '../i18n'

export const CINEMA = collection('cinema', [
  look(
    'classic-cine-camera',
    tk('Classic Cine Camera'),
    {
      tags: ['cinema', 'cine camera', 'skin', 'highlight rolloff', 'arri', 'alexa', 'k1s1'],
      inspiredBy: 'ARRI ALEXA LogC to Rec.709 (K1S1)',
      description: tk(
        'A moderate S with a very long, desaturating highlight shoulder and kind skin.'
      )
    },
    sCurve(25),
    rolloff(0.03),
    tone({ whites: -18, highlights: -15 }),
    presence({ saturation: -6 }),
    wheel('global', 35, 4),
    hsl({ orange: [-3, 6, 2], yellow: [0, -10, 0], green: [-8, -18, 0] })
  ),
  look(
    'modern-cine-camera',
    tk('Modern Cine Camera'),
    {
      tags: ['cinema', 'cine camera', 'accurate', 'arri', 'reveal'],
      inspiredBy: 'ARRI REVEAL colour science',
      description: tk('The classic cine curve with cleaner, truer hues.')
    },
    sCurve(25),
    rolloff(0.02),
    tone({ whites: -12, highlights: -12 }),
    presence({ vibrance: 10 }),
    wheel('global', 200, 3),
    hsl({ red: [0, 5, -4], blue: [-5, 10, -5], aqua: [0, 10, 0] })
  ),
  look(
    'cine-print-look',
    tk('Cine Print Look'),
    {
      tags: ['cinema', 'print', 'film look', 'arri', 'look library'],
      inspiredBy: 'ARRI Look Library film-print styles',
      description: tk(
        'A cine camera printed to film: teal shadows, warm highlights, a little grain.'
      )
    },
    sCurve(30),
    fade(0.01),
    presence({ saturation: -12 }),
    split(185, 16, 40, 14),
    hsl({ green: [5, -12, 0] }),
    grain(8, 20, 40)
  ),
  look(
    'digital-cine-neutral',
    tk('Digital Cine Neutral'),
    {
      tags: ['cinema', 'neutral', 'soft', 'red', 'ipp2'],
      inspiredBy: 'RED IPP2 (medium contrast, soft roll-off)',
      description: tk('Neutral, slightly cool, with a very soft highlight roll-off.')
    },
    sCurve(12),
    rolloff(0.04),
    tone({ highlights: -22, shadows: 8 }),
    presence({ saturation: -10 }),
    wheel('global', 210, 6)
  ),
  look(
    'full-frame-cine',
    tk('Full Frame Cine'),
    {
      tags: ['cinema', 'warm skin', 'sony', 'venice'],
      inspiredBy: 'Sony VENICE Rec.709',
      description: tk('Rich reds, cyan skies and warm skin.')
    },
    tone({ contrast: 15 }),
    presence({ saturation: 5 }),
    wheel('global', 35, 3),
    hsl({ red: [0, 10, 0], green: [-5, -10, 0], blue: [-8, 0, 0] })
  ),
  look(
    'indie-cine',
    tk('Indie Cine'),
    {
      tags: ['cinema', 'indie', 'warm', 'blackmagic', 'gen5'],
      inspiredBy: 'Blackmagic Design Gen 5 colour science',
      description: tk('Warm reds and a faint magenta lean.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: 5 }),
    wheel('global', 330, 3),
    hsl({ red: [0, 8, 0], orange: [0, 8, 0] })
  ),
  look(
    'creamy-cine',
    tk('Creamy Cine'),
    {
      tags: ['cinema', 'creamy', 'skin', 'soft', 'panavision', 'light iron'],
      inspiredBy: 'Panavision / Light Iron colour',
      description: tk('Creamy skin and soft highlights over a gentle split.')
    },
    tone({ contrast: 5, highlights: -18 }),
    rolloff(0.03),
    presence({ texture: -10 }),
    split(190, 10, 45, 14),
    hsl({ orange: [-2, -5, 8], red: [0, -5, 0] }),
    grain(5, 15, 30)
  ),
  look(
    'warm-theatre-print',
    tk('Warm Theatre Print'),
    {
      tags: ['print film', 'cinema', 'warm', 'dense', 'kodak', '2383'],
      inspiredBy: 'Kodak Vision Color Print Film 2383',
      description: tk('Dense blacks, a strong shoulder and the warm-teal split of a theatre print.')
    },
    sCurve(45),
    rolloff(0.03),
    tone({ blacks: -5 }),
    presence({ saturation: 5 }),
    split(185, 18, 40, 15),
    hsl({ red: [0, 15, 0], yellow: [0, 10, 0], green: [0, -10, 0], blue: [-15, 0, 0] })
  ),
  look(
    'cool-theatre-print',
    tk('Cool Theatre Print'),
    {
      tags: ['print film', 'cinema', 'cool', 'fuji', '3513'],
      inspiredBy: 'Fujifilm Eterna-CP 3513 print film',
      description: tk('A cooler, greener print with more neutral skin.')
    },
    sCurve(35),
    split(170, 12, 50, 6),
    hsl({ red: [0, 5, 0], orange: [0, -5, 0] })
  ),
  look(
    'silver-retention-print',
    tk('Silver Retention Print'),
    {
      tags: ['bleach bypass', 'enr', 'cinema', 'gritty', 'technicolor'],
      inspiredBy: 'Technicolor ENR / bleach-bypass print processing',
      description: tk('Silver left in the print: heavy contrast, deep blacks, muted colour.')
    },
    sCurve(50),
    tone({ contrast: 20, blacks: -10 }),
    presence({ saturation: -45, clarity: 10 }),
    grain(15, 25, 50)
  ),
  look(
    'three-strip-glory',
    tk('Three-Strip Glory'),
    {
      tags: ['technicolor', 'dye transfer', 'saturated', 'classic hollywood'],
      inspiredBy: 'Three-strip Technicolor dye-transfer prints',
      description: tk('Rich primaries and inky blacks of classic dye-transfer prints.')
    },
    sCurve(30),
    tone({ blacks: -8 }),
    presence({ saturation: 25 }),
    hsl({ red: [0, 20, -5], yellow: [0, 15, 0], blue: [0, 20, -10], green: [0, 10, -5] })
  ),
  look(
    'two-strip-colour',
    tk('Two-Strip Colour'),
    {
      tags: ['technicolor', 'two strip', 'vintage', 'red cyan'],
      inspiredBy: 'Two-colour Technicolor (1920s)',
      description: tk('Only reds and cyans: greens and blues fold into teal, yellows into peach.')
    },
    presence({ saturation: -10 }),
    hsl({
      yellow: [-60, -40, 0],
      green: [60, -30, 0],
      blue: [-60, -20, 0],
      purple: [-60, -40, 0],
      magenta: [60, -30, 0]
    }),
    approximates('hueSwap')
  ),
  look(
    'day-for-night',
    tk('Day for Night'),
    {
      tags: ['day for night', 'night', 'blue', 'dark', 'cinema'],
      inspiredBy: 'The classic day-for-night film technique',
      description: tk('Daylight made to read as moonlight: dark, blue and drained.')
    },
    tone({ contrast: 15, highlights: -50, whites: -40, shadows: -20 }),
    presence({ saturation: -50 }),
    wheel('global', 220, 30),
    wheel('shadows', 225, 20)
  ),
  look(
    'tungsten-cine-neg-500',
    tk('Tungsten Cine Neg 500'),
    {
      tags: ['cinema', 'negative', 'tungsten', 'night', 'grain', 'kodak', 'vision3', '500t'],
      inspiredBy: 'Kodak Vision3 500T 5219, printed',
      description: tk('Fast tungsten negative: soft blacks, teal shadows, visible grain.')
    },
    sCurve(18),
    fade(0.03),
    tone({ highlights: -12 }),
    presence({ saturation: -8 }),
    split(175, 18, 35, 12),
    halationApprox(40),
    grain(32, 30, 55)
  ),
  look(
    'tungsten-cine-neg-200',
    tk('Tungsten Cine Neg 200'),
    {
      tags: ['cinema', 'negative', 'tungsten', 'kodak', 'vision3', '200t'],
      inspiredBy: 'Kodak Vision3 200T 5213, printed',
      description: tk('Tungsten negative with finer grain and the same teal-warm split.')
    },
    sCurve(28),
    fade(0.015),
    tone({ highlights: -10 }),
    presence({ saturation: -4 }),
    split(180, 18, 40, 12),
    hsl({ green: [8, -10, 0] }),
    grain(18, 25, 45)
  ),
  look(
    'daylight-cine-neg-250',
    tk('Daylight Cine Neg 250'),
    {
      tags: ['cinema', 'negative', 'daylight', 'kodak', 'vision3', '250d'],
      inspiredBy: 'Kodak Vision3 250D 5207, printed',
      description: tk('Daylight negative with a very long highlight range.')
    },
    sCurve(20),
    rolloff(0.03),
    tone({ highlights: -18, shadows: 8 }),
    presence({ saturation: -4 }),
    split(190, 12, 45, 12),
    hsl({ green: [5, -10, 0] }),
    grain(18, 25, 45)
  ),
  look(
    'fine-daylight-cine-neg',
    tk('Fine Daylight Cine Neg'),
    {
      tags: ['cinema', 'negative', 'daylight', 'fine grain', 'kodak', 'vision3', '50d'],
      inspiredBy: 'Kodak Vision3 50D 5203, printed',
      description: tk('Crisp, clean, fine-grained daylight negative.')
    },
    sCurve(30),
    presence({ saturation: 10 }),
    wheel('shadows', 190, 6),
    grain(6, 15, 30)
  ),
  look(
    'cine-bw-neg',
    tk('Cine B&W Neg'),
    {
      tags: ['bw', 'mono', 'cinema', 'grain', 'kodak', 'double-x', '5222'],
      inspiredBy: 'Kodak Double-X 5222',
      description: tk('Classic motion-picture black and white: punchy with real grain.')
    },
    mono({ red: 10, orange: 10, blue: -10 }),
    sCurve(40),
    tone({ blacks: -15, shadows: -10, highlights: -10 }),
    vignette(-15, { feather: 70 }),
    grain(40, 35, 65)
  )
])
