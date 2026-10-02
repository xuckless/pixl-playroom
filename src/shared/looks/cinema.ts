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
  wheel
} from './dsl'

export const CINEMA = collection('cinema', [
  look(
    'classic-cine-camera',
    'Classic Cine Camera',
    {
      tags: ['cinema', 'cine camera', 'skin', 'highlight rolloff', 'arri', 'alexa', 'k1s1'],
      inspiredBy: 'ARRI ALEXA LogC to Rec.709 (K1S1)',
      description: 'A moderate S with a very long, desaturating highlight shoulder and kind skin.'
    },
    sCurve(20),
    rolloff(0.02),
    tone({ whites: -15, highlights: -10 }),
    presence({ saturation: -5 }),
    hsl({ orange: [-2, 3, 0], green: [-5, -10, 0] })
  ),
  look(
    'modern-cine-camera',
    'Modern Cine Camera',
    {
      tags: ['cinema', 'cine camera', 'accurate', 'arri', 'reveal'],
      inspiredBy: 'ARRI REVEAL colour science',
      description: 'The classic cine curve with cleaner, truer hues.'
    },
    sCurve(20),
    rolloff(0.02),
    tone({ whites: -12, highlights: -10 }),
    presence({ vibrance: 5 }),
    hsl({ red: [0, 0, -3] })
  ),
  look(
    'cine-print-look',
    'Cine Print Look',
    {
      tags: ['cinema', 'print', 'film look', 'arri', 'look library'],
      inspiredBy: 'ARRI Look Library film-print styles',
      description: 'A cine camera printed to film: teal shadows, warm highlights, a little grain.'
    },
    sCurve(30),
    presence({ saturation: -10 }),
    split(185, 10, 40, 10),
    grain(8, 20, 40)
  ),
  look(
    'digital-cine-neutral',
    'Digital Cine Neutral',
    {
      tags: ['cinema', 'neutral', 'soft', 'red', 'ipp2'],
      inspiredBy: 'RED IPP2 (medium contrast, soft roll-off)',
      description: 'Neutral, slightly cool, with a very soft highlight roll-off.'
    },
    sCurve(10),
    rolloff(0.03),
    tone({ highlights: -15 }),
    presence({ saturation: -5 }),
    wheel('global', 210, 3)
  ),
  look(
    'full-frame-cine',
    'Full Frame Cine',
    {
      tags: ['cinema', 'warm skin', 'sony', 'venice'],
      inspiredBy: 'Sony VENICE Rec.709',
      description: 'Rich reds, cyan skies and warm skin.'
    },
    tone({ contrast: 15 }),
    presence({ saturation: 5 }),
    wheel('global', 35, 3),
    hsl({ red: [0, 10, 0], green: [-5, -10, 0], blue: [-8, 0, 0] })
  ),
  look(
    'indie-cine',
    'Indie Cine',
    {
      tags: ['cinema', 'indie', 'warm', 'blackmagic', 'gen5'],
      inspiredBy: 'Blackmagic Design Gen 5 colour science',
      description: 'Warm reds and a faint magenta lean.'
    },
    tone({ contrast: 10 }),
    presence({ saturation: 5 }),
    wheel('global', 330, 3),
    hsl({ red: [0, 8, 0], orange: [0, 8, 0] })
  ),
  look(
    'creamy-cine',
    'Creamy Cine',
    {
      tags: ['cinema', 'creamy', 'skin', 'soft', 'panavision', 'light iron'],
      inspiredBy: 'Panavision / Light Iron colour',
      description: 'Creamy skin and soft highlights over a gentle split.'
    },
    tone({ contrast: 5, highlights: -12 }),
    split(190, 6, 45, 8),
    hsl({ orange: [0, -3, 4] }),
    grain(5, 15, 30)
  ),
  look(
    'warm-theatre-print',
    'Warm Theatre Print',
    {
      tags: ['print film', 'cinema', 'warm', 'dense', 'kodak', '2383'],
      inspiredBy: 'Kodak Vision Color Print Film 2383',
      description: 'Dense blacks, a strong shoulder and the warm-teal split of a theatre print.'
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
    'Cool Theatre Print',
    {
      tags: ['print film', 'cinema', 'cool', 'fuji', '3513'],
      inspiredBy: 'Fujifilm Eterna-CP 3513 print film',
      description: 'A cooler, greener print with more neutral skin.'
    },
    sCurve(35),
    split(170, 12, 50, 6),
    hsl({ red: [0, 5, 0], orange: [0, -5, 0] })
  ),
  look(
    'silver-retention-print',
    'Silver Retention Print',
    {
      tags: ['bleach bypass', 'enr', 'cinema', 'gritty', 'technicolor'],
      inspiredBy: 'Technicolor ENR / bleach-bypass print processing',
      description: 'Silver left in the print: heavy contrast, deep blacks, muted colour.'
    },
    sCurve(50),
    tone({ contrast: 20, blacks: -10 }),
    presence({ saturation: -45, clarity: 10 }),
    grain(15, 25, 50)
  ),
  look(
    'three-strip-glory',
    'Three-Strip Glory',
    {
      tags: ['technicolor', 'dye transfer', 'saturated', 'classic hollywood'],
      inspiredBy: 'Three-strip Technicolor dye-transfer prints',
      description: 'Rich primaries and inky blacks of classic dye-transfer prints.'
    },
    sCurve(30),
    tone({ blacks: -8 }),
    presence({ saturation: 25 }),
    hsl({ red: [0, 20, -5], yellow: [0, 15, 0], blue: [0, 20, -10], green: [0, 10, -5] })
  ),
  look(
    'two-strip-colour',
    'Two-Strip Colour',
    {
      tags: ['technicolor', 'two strip', 'vintage', 'red cyan'],
      inspiredBy: 'Two-colour Technicolor (1920s)',
      description: 'Only reds and cyans: greens and blues fold into teal, yellows into peach.'
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
    'Day for Night',
    {
      tags: ['day for night', 'night', 'blue', 'dark', 'cinema'],
      inspiredBy: 'The classic day-for-night film technique',
      description: 'Daylight made to read as moonlight: dark, blue and drained.'
    },
    tone({ contrast: 15, highlights: -50, whites: -40, shadows: -20 }),
    presence({ saturation: -50 }),
    wheel('global', 220, 30),
    wheel('shadows', 225, 20)
  ),
  look(
    'tungsten-cine-neg-500',
    'Tungsten Cine Neg 500',
    {
      tags: ['cinema', 'negative', 'tungsten', 'night', 'grain', 'kodak', 'vision3', '500t'],
      inspiredBy: 'Kodak Vision3 500T 5219, printed',
      description: 'Fast tungsten negative: soft blacks, teal shadows, visible grain.'
    },
    sCurve(20),
    fade(0.02),
    tone({ highlights: -10 }),
    presence({ saturation: -5 }),
    split(175, 12, 40, 10),
    halationApprox(30),
    grain(30, 30, 55)
  ),
  look(
    'tungsten-cine-neg-200',
    'Tungsten Cine Neg 200',
    {
      tags: ['cinema', 'negative', 'tungsten', 'kodak', 'vision3', '200t'],
      inspiredBy: 'Kodak Vision3 200T 5213, printed',
      description: 'Tungsten negative with finer grain and the same teal-warm split.'
    },
    sCurve(20),
    fade(0.02),
    tone({ highlights: -10 }),
    presence({ saturation: -5 }),
    split(175, 12, 40, 10),
    grain(18, 25, 45)
  ),
  look(
    'daylight-cine-neg-250',
    'Daylight Cine Neg 250',
    {
      tags: ['cinema', 'negative', 'daylight', 'kodak', 'vision3', '250d'],
      inspiredBy: 'Kodak Vision3 250D 5207, printed',
      description: 'Daylight negative with a very long highlight range.'
    },
    sCurve(20),
    rolloff(0.02),
    tone({ highlights: -15 }),
    split(190, 8, 45, 8),
    grain(18, 25, 45)
  ),
  look(
    'fine-daylight-cine-neg',
    'Fine Daylight Cine Neg',
    {
      tags: ['cinema', 'negative', 'daylight', 'fine grain', 'kodak', 'vision3', '50d'],
      inspiredBy: 'Kodak Vision3 50D 5203, printed',
      description: 'Crisp, clean, fine-grained daylight negative.'
    },
    sCurve(30),
    presence({ saturation: 10 }),
    wheel('shadows', 190, 6),
    grain(6, 15, 30)
  ),
  look(
    'cine-bw-neg',
    'Cine B&W Neg',
    {
      tags: ['bw', 'mono', 'cinema', 'grain', 'kodak', 'double-x', '5222'],
      inspiredBy: 'Kodak Double-X 5222',
      description: 'Classic motion-picture black and white: punchy with real grain.'
    },
    mono({ red: 10, orange: 10, blue: -10 }),
    sCurve(40),
    tone({ blacks: -5 }),
    grain(40, 35, 65)
  )
])
