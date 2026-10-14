/**
 * Cine-camera colour science, camera negative and theatre print, in the
 * spirit of the cameras and stocks films are made on.
 */
import {
  approximates,
  collection,
  gain,
  grain,
  halationApprox,
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
  vignette,
  lumSat
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
      ),
      version: 2
    },
    sCurve(25),
    matte(0, 0.03),
    tone({ whites: -18, highlights: -15 }),
    presence({ saturation: -6 }),
    offset(35, 4),
    hueCurve('hueHue', [
      [30, -0.9],
      [120, -2.4]
    ]),
    hueCurve('hueSat', [
      [30, 1.06],
      [60, 0.9],
      [120, 0.82]
    ]),
    hsl({ orange: [0, 0, 2] }),
    // The shoulder drains colour as it rolls off, as the description says.
    lumSat([
      [0, 1],
      [0.55, 1],
      [0.85, 0.82],
      [1, 0.6]
    ])
  ),
  look(
    'modern-cine-camera',
    tk('Modern Cine Camera'),
    {
      tags: ['cinema', 'cine camera', 'accurate', 'arri', 'reveal'],
      inspiredBy: 'ARRI REVEAL colour science',
      description: tk('The classic cine curve with cleaner, truer hues.'),
      version: 2
    },
    sCurve(25),
    matte(0, 0.02),
    tone({ whites: -12, highlights: -12 }),
    presence({ vibrance: 10 }),
    offset(200, 3),
    hueCurve('hueHue', [[240, -1.5]]),
    hueCurve('hueSat', [
      [0, 1.05],
      [240, 1.1],
      [180, 1.1]
    ]),
    hsl({ red: [0, 0, -4], blue: [0, 0, -5] })
  ),
  look(
    'cine-print-look',
    tk('Cine Print Look'),
    {
      tags: ['cinema', 'print', 'film look', 'arri', 'look library'],
      inspiredBy: 'ARRI Look Library film-print styles',
      description: tk(
        'A cine camera printed to film: teal shadows, warm highlights, a little grain.'
      ),
      version: 2
    },
    sCurve(30),
    matte(0.01),
    presence({ saturation: -12 }),
    lift(185, 16),
    gain(40, 14),
    hueCurve('hueHue', [[120, 1.5]]),
    hueCurve('hueSat', [[120, 0.88]]),
    grain(8, 20, 40)
  ),
  look(
    'digital-cine-neutral',
    tk('Digital Cine Neutral'),
    {
      tags: ['cinema', 'neutral', 'soft', 'red', 'ipp2'],
      inspiredBy: 'RED IPP2 (medium contrast, soft roll-off)',
      description: tk('Neutral, slightly cool, with a very soft highlight roll-off.'),
      version: 2
    },
    sCurve(12),
    matte(0, 0.04),
    tone({ highlights: -22, shadows: 8 }),
    presence({ saturation: -10 }),
    offset(210, 6),
    // Colour eases off with the highlights.
    lumSat([
      [0, 1],
      [0.65, 1],
      [1, 0.8]
    ])
  ),
  look(
    'full-frame-cine',
    tk('Full Frame Cine'),
    {
      tags: ['cinema', 'warm skin', 'sony', 'venice'],
      inspiredBy: 'Sony VENICE Rec.709',
      description: tk('Rich reds, cyan skies and warm skin.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    presence({ saturation: 5 }),
    offset(35, 3),
    hueCurve('hueHue', [
      [120, -1.5],
      [240, -2.4]
    ]),
    hueCurve('hueSat', [
      [0, 1.1],
      [120, 0.9]
    ])
  ),
  look(
    'indie-cine',
    tk('Indie Cine'),
    {
      tags: ['cinema', 'indie', 'warm', 'blackmagic', 'gen5'],
      inspiredBy: 'Blackmagic Design Gen 5 colour science',
      description: tk('Warm reds and a faint magenta lean.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: 5 }),
    offset(330, 3),
    hueCurve('hueSat', [
      [0, 1.08],
      [30, 1.08]
    ])
  ),
  look(
    'creamy-cine',
    tk('Creamy Cine'),
    {
      tags: ['cinema', 'creamy', 'skin', 'soft', 'panavision', 'light iron'],
      inspiredBy: 'Panavision / Light Iron colour',
      description: tk('Creamy skin and soft highlights over a gentle split.'),
      version: 2
    },
    prim({ contrast: 1.03 }),
    tone({ highlights: -18 }),
    matte(0, 0.03),
    presence({ texture: -10 }),
    lift(190, 10),
    gain(45, 14),
    hueCurve('hueHue', [[30, -0.6]]),
    hueCurve('hueSat', [
      [30, 0.95],
      [0, 0.95]
    ]),
    hsl({ orange: [0, 0, 8] }),
    grain(5, 15, 30)
  ),
  look(
    'warm-theatre-print',
    tk('Warm Theatre Print'),
    {
      tags: ['print film', 'cinema', 'warm', 'dense', 'kodak', '2383'],
      inspiredBy: 'Kodak Vision Color Print Film 2383',
      description: tk(
        'Dense blacks, a strong shoulder and the warm-teal split of a theatre print.'
      ),
      version: 2
    },
    sCurve(45),
    matte(0, 0.03),
    tone({ blacks: -5 }),
    presence({ saturation: 5 }),
    lift(185, 18),
    gain(40, 15),
    hueCurve('hueHue', [[240, -4.5]]),
    hueCurve('hueSat', [
      [0, 1.15],
      [60, 1.1],
      [120, 0.9]
    ]),
    // Dense blacks and a strong shoulder, both quieter in colour.
    lumSat([
      [0, 0.85],
      [0.2, 1],
      [0.7, 1],
      [1, 0.75]
    ])
  ),
  look(
    'cool-theatre-print',
    tk('Cool Theatre Print'),
    {
      tags: ['print film', 'cinema', 'cool', 'fuji', '3513'],
      inspiredBy: 'Fujifilm Eterna-CP 3513 print film',
      description: tk('A cooler, greener print with more neutral skin.'),
      version: 2
    },
    sCurve(35),
    lift(170, 12),
    gain(50, 6),
    hueCurve('hueSat', [
      [0, 1.05],
      [30, 0.95]
    ])
  ),
  look(
    'silver-retention-print',
    tk('Silver Retention Print'),
    {
      tags: ['bleach bypass', 'enr', 'cinema', 'gritty', 'technicolor'],
      inspiredBy: 'Technicolor ENR / bleach-bypass print processing',
      description: tk('Silver left in the print: heavy contrast, deep blacks, muted colour.'),
      version: 2
    },
    sCurve(50),
    prim({ contrast: 1.12, sat: -45 }),
    tone({ blacks: -10 }),
    presence({ clarity: 10 }),
    grain(15, 25, 50)
  ),
  look(
    'three-strip-glory',
    tk('Three-Strip Glory'),
    {
      tags: ['technicolor', 'dye transfer', 'saturated', 'classic hollywood'],
      inspiredBy: 'Three-strip Technicolor dye-transfer prints',
      description: tk('Rich primaries and inky blacks of classic dye-transfer prints.'),
      version: 2
    },
    sCurve(30),
    tone({ blacks: -8 }),
    prim({ sat: 25 }),
    hueCurve('hueSat', [
      [0, 1.2],
      [60, 1.15],
      [240, 1.2],
      [120, 1.1]
    ]),
    hsl({ red: [0, 0, -5], blue: [0, 0, -10], green: [0, 0, -5] })
  ),
  look(
    'two-strip-colour',
    tk('Two-Strip Colour'),
    {
      tags: ['technicolor', 'two strip', 'vintage', 'red cyan'],
      inspiredBy: 'Two-colour Technicolor (1920s)',
      description: tk('Only reds and cyans: greens and blues fold into teal, yellows into peach.'),
      version: 2
    },
    prim({ sat: -10 }),
    hueCurve('hueHue', [
      [60, -18],
      [120, 18],
      [240, -18],
      [275, -18],
      [315, 18]
    ]),
    hueCurve('hueSat', [
      [60, 0.6],
      [120, 0.7],
      [240, 0.8],
      [275, 0.6],
      [315, 0.7]
    ]),
    approximates('hueSwap')
  ),
  look(
    'day-for-night',
    tk('Day for Night'),
    {
      tags: ['day for night', 'night', 'blue', 'dark', 'cinema'],
      inspiredBy: 'The classic day-for-night film technique',
      description: tk('Daylight made to read as moonlight: dark, blue and drained.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    tone({ highlights: -50, whites: -40, shadows: -20 }),
    presence({ saturation: -50 }),
    offset(220, 30),
    lift(225, 20)
  ),
  look(
    'tungsten-cine-neg-500',
    tk('Tungsten Cine Neg 500'),
    {
      tags: ['cinema', 'negative', 'tungsten', 'night', 'grain', 'kodak', 'vision3', '500t'],
      inspiredBy: 'Kodak Vision3 500T 5219, printed',
      description: tk('Fast tungsten negative: soft blacks, teal shadows, visible grain.'),
      version: 2
    },
    sCurve(18),
    matte(0.03),
    tone({ highlights: -12 }),
    presence({ saturation: -8 }),
    lift(175, 18),
    gain(35, 12),
    halationApprox(40),
    grain(32, 30, 55)
  ),
  look(
    'tungsten-cine-neg-200',
    tk('Tungsten Cine Neg 200'),
    {
      tags: ['cinema', 'negative', 'tungsten', 'kodak', 'vision3', '200t'],
      inspiredBy: 'Kodak Vision3 200T 5213, printed',
      description: tk('Tungsten negative with finer grain and the same teal-warm split.'),
      version: 2
    },
    sCurve(28),
    matte(0.015),
    tone({ highlights: -10 }),
    presence({ saturation: -4 }),
    lift(180, 18),
    gain(40, 12),
    hueCurve('hueHue', [[120, 2.4]]),
    hueCurve('hueSat', [[120, 0.9]]),
    grain(18, 25, 45)
  ),
  look(
    'daylight-cine-neg-250',
    tk('Daylight Cine Neg 250'),
    {
      tags: ['cinema', 'negative', 'daylight', 'kodak', 'vision3', '250d'],
      inspiredBy: 'Kodak Vision3 250D 5207, printed',
      description: tk('Daylight negative with a very long highlight range.'),
      version: 2
    },
    sCurve(20),
    matte(0, 0.03),
    tone({ highlights: -18, shadows: 8 }),
    presence({ saturation: -4 }),
    lift(190, 12),
    gain(45, 12),
    hueCurve('hueHue', [[120, 1.5]]),
    hueCurve('hueSat', [[120, 0.9]]),
    grain(18, 25, 45)
  ),
  look(
    'fine-daylight-cine-neg',
    tk('Fine Daylight Cine Neg'),
    {
      tags: ['cinema', 'negative', 'daylight', 'fine grain', 'kodak', 'vision3', '50d'],
      inspiredBy: 'Kodak Vision3 50D 5203, printed',
      description: tk('Crisp, clean, fine-grained daylight negative.'),
      version: 2
    },
    sCurve(30),
    presence({ saturation: 10 }),
    lift(190, 6),
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
