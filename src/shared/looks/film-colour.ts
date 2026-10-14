/** Colour negative, slide and instant stocks, written from their character. */
import {
  approximates,
  calib,
  collection,
  gain,
  gamma,
  grain,
  halationApprox,
  hsl,
  hueCurve,
  lift,
  look,
  matte,
  offset,
  presence,
  prim,
  rgb,
  sCurve,
  tone,
  vignette
} from './dsl'
import { tk } from '../i18n'

export const FILM_COLOUR = collection('film/colour', [
  look(
    'fine-portrait-160',
    tk('Fine Portrait 160'),
    {
      tags: ['film', 'portrait', 'skin', 'soft', 'kodak', 'portra', '160'],
      inspiredBy: 'Kodak Portra 160',
      description: tk('Low contrast, gentle saturation and creamy skin; fine grain.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    tone({ highlights: -15 }),
    matte(0.02, 0.02),
    presence({ saturation: -12 }),
    lift(180, 5),
    gain(45, 6),
    hueCurve('hueHue', [
      [120, 1.5],
      [60, 0.9]
    ]),
    hueCurve('hueSat', [
      [30, 0.95],
      [240, 0.85],
      [120, 0.85],
      [60, 0.91]
    ]),
    hsl({ orange: [0, 0, 5] }),
    grain(8, 18, 35)
  ),
  look(
    'warm-portrait-400',
    tk('Warm Portrait 400'),
    {
      tags: ['film', 'portrait', 'warm', 'wedding', 'kodak', 'portra', '400'],
      inspiredBy: 'Kodak Portra 400',
      description: tk('The classic portrait negative: warm skin, soft greens, long highlights.'),
      version: 2
    },
    prim({ contrast: 0.97 }),
    tone({ highlights: -15 }),
    matte(0.03, 0.02),
    presence({ saturation: -5 }),
    lift(170, 6),
    gain(42, 10),
    hueCurve('hueHue', [
      [30, -0.6],
      [240, -3],
      [120, 3],
      [60, 1.8]
    ]),
    hueCurve('hueSat', [
      [240, 0.9],
      [120, 0.85],
      [60, 0.91]
    ]),
    hsl({ orange: [0, 0, 6] }),
    grain(15, 22, 40)
  ),
  look(
    'warm-portrait-800',
    tk('Warm Portrait 800'),
    {
      tags: ['film', 'portrait', 'warm', 'low light', 'kodak', 'portra', '800'],
      inspiredBy: 'Kodak Portra 800',
      description: tk('Richer, warmer and grainier, with a green lean in the shadows.'),
      version: 2
    },
    prim({ contrast: 1.05 }),
    tone({ highlights: -12 }),
    matte(0.03),
    presence({ saturation: 8 }),
    lift(150, 12),
    gain(40, 16),
    hueCurve('hueHue', [
      [30, -0.6],
      [120, 2.4]
    ]),
    hueCurve('hueSat', [
      [0, 1.08],
      [30, 1.1],
      [120, 0.9]
    ]),
    hsl({ orange: [0, 0, 4] }),
    grain(28, 30, 55)
  ),
  look(
    'vivid-landscape-100',
    tk('Vivid Landscape 100'),
    {
      tags: ['film', 'landscape', 'saturated', 'fine grain', 'kodak', 'ektar', '100'],
      inspiredBy: 'Kodak Ektar 100',
      description: tk('Saturated, fine-grained landscape negative; skin runs red.'),
      version: 2
    },
    prim({ contrast: 1.12, sat: 25 }),
    hueCurve('hueHue', [[30, -1.2]]),
    hueCurve('hueSat', [
      [0, 1.2],
      [30, 1.2],
      [240, 1.2]
    ]),
    hsl({ blue: [0, 0, -10] }),
    grain(5, 15, 30)
  ),
  look(
    'golden-consumer-200',
    tk('Golden Consumer 200'),
    {
      tags: ['film', 'warm', 'golden', 'nostalgic', 'kodak', 'gold', '200'],
      inspiredBy: 'Kodak Gold 200',
      description: tk('Golden, sunny consumer film with yellowed greens.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: 10 }),
    gamma(45, 10),
    gain(50, 18),
    hueCurve('hueHue', [
      [120, -3],
      [60, -1.8]
    ]),
    hueCurve('hueSat', [[240, 0.9]]),
    grain(22, 28, 50)
  ),
  look(
    'punchy-consumer-400',
    tk('Punchy Consumer 400'),
    {
      tags: ['film', 'punchy', 'saturated', 'everyday', 'kodak', 'ultramax', '400'],
      inspiredBy: 'Kodak UltraMax 400',
      description: tk('Punchy everyday colour with strong reds.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    presence({ saturation: 15 }),
    lift(150, 8),
    gain(45, 10),
    hueCurve('hueSat', [[0, 1.15]]),
    grain(25, 30, 55)
  ),
  look(
    'budget-warm-200',
    tk('Budget Warm 200'),
    {
      tags: ['film', 'warm', 'budget', 'soft', 'kodak', 'colorplus', '200'],
      inspiredBy: 'Kodak ColorPlus 200',
      description: tk('Warm, soft and a little grainy, with muted blues.'),
      version: 2
    },
    prim({ contrast: 1.03 }),
    presence({ saturation: 5, texture: -10 }),
    offset(45, 12),
    hueCurve('hueSat', [[240, 0.85]]),
    grain(28, 32, 55)
  ),
  look(
    'clean-slide-100',
    tk('Clean Slide 100'),
    {
      tags: ['slide', 'film', 'clean', 'cool', 'kodak', 'ektachrome', 'e100'],
      inspiredBy: 'Kodak Ektachrome E100',
      description: tk('Clean, slightly cool slide film with crisp blues.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    tone({ blacks: -5 }),
    presence({ saturation: 10 }),
    offset(210, 6),
    hueCurve('hueSat', [[240, 1.15]]),
    grain(5, 15, 30)
  ),
  look(
    'classic-slide-64',
    tk('Classic Slide 64'),
    {
      tags: ['slide', 'film', 'vintage', 'rich', 'kodak', 'kodachrome', '64'],
      inspiredBy: 'Kodak Kodachrome 64',
      description: tk('Rich reds and yellows, deep blue skies and dense blacks.'),
      version: 2
    },
    sCurve(40),
    tone({ blacks: -5 }),
    presence({ saturation: 10 }),
    lift(200, 6),
    gain(45, 8),
    hueCurve('hueHue', [
      [120, -1.5],
      [240, -2.4]
    ]),
    hueCurve('hueSat', [
      [0, 1.2],
      [60, 1.15],
      [120, 0.9],
      [240, 1.1]
    ]),
    hsl({ red: [0, 0, -5], blue: [0, 0, -15] }),
    grain(8, 18, 35)
  ),
  look(
    'saturated-slide-50',
    tk('Saturated Slide 50'),
    {
      tags: ['slide', 'film', 'saturated', 'landscape', 'fuji', 'velvia', '50'],
      inspiredBy: 'Fujifilm Velvia 50 (film)',
      description: tk('Maximum saturation, magenta shadows and dark skies.'),
      version: 2
    },
    sCurve(40),
    prim({ contrast: 1.06 }),
    presence({ saturation: 40 }),
    lift(300, 10),
    hueCurve('hueHue', [[0, -2.4]]),
    hueCurve('hueSat', [
      [0, 1.2],
      [120, 1.3],
      [60, 1.18]
    ]),
    hsl({ blue: [0, 0, -20] }),
    grain(4, 12, 25)
  ),
  look(
    'neutral-slide-100',
    tk('Neutral Slide 100'),
    {
      tags: ['slide', 'film', 'neutral', 'fuji', 'provia', '100f'],
      inspiredBy: 'Fujifilm Provia 100F (film)',
      description: tk('An honest, neutral slide film.'),
      version: 2
    },
    sCurve(30),
    tone({ blacks: -10 }),
    presence({ saturation: 6 }),
    offset(210, 7),
    hueCurve('hueSat', [[240, 1.1]]),
    hsl({ blue: [0, 0, -10] }),
    grain(5, 15, 30)
  ),
  look(
    'green-cast-consumer-400',
    tk('Green-Cast Consumer 400'),
    {
      tags: ['film', 'green', 'consumer', 'fuji', 'superia', '400'],
      inspiredBy: 'Fujifilm Superia X-TRA 400',
      description: tk('Everyday film with green shadows and vivid greens.'),
      version: 2
    },
    prim({ contrast: 1.06 }),
    presence({ saturation: 10 }),
    lift(155, 12),
    hueCurve('hueHue', [
      [30, -0.9],
      [120, 3],
      [60, 1.8]
    ]),
    hueCurve('hueSat', [
      [120, 1.1],
      [60, 1.06]
    ]),
    grain(25, 30, 55)
  ),
  look(
    'airy-pastel-400',
    tk('Airy Pastel 400'),
    {
      tags: ['film', 'pastel', 'airy', 'wedding', 'mint', 'fuji', '400h'],
      inspiredBy: 'Fujifilm Pro 400H',
      description: tk('Bright, airy pastels with mint greens.'),
      version: 2
    },
    prim({ contrast: 0.88 }),
    tone({ shadows: 15, whites: 10 }),
    matte(0.04),
    presence({ saturation: -10 }),
    lift(180, 10),
    gain(60, 5),
    hueCurve('hueHue', [
      [120, 6],
      [60, 3.6]
    ]),
    hueCurve('hueSat', [
      [120, 0.9],
      [60, 0.94]
    ]),
    hsl({ orange: [0, 0, 5] }),
    grain(15, 22, 40)
  ),
  look(
    'cool-portrait-160',
    tk('Cool Portrait 160'),
    {
      tags: ['film', 'portrait', 'cool', 'fuji', 'pro 160ns'],
      inspiredBy: 'Fujifilm Pro 160NS',
      description: tk('Cool, low-contrast portrait negative.'),
      version: 2
    },
    prim({ contrast: 0.91 }),
    tone({ highlights: -10 }),
    matte(0.02),
    presence({ saturation: -12 }),
    lift(170, 12),
    gain(60, 5),
    hueCurve('hueHue', [
      [120, 3.6],
      [60, 2.1]
    ]),
    hueCurve('hueSat', [
      [30, 0.95],
      [120, 0.95],
      [60, 0.97]
    ]),
    hsl({ orange: [0, 0, 6] }),
    grain(8, 18, 35)
  ),
  look(
    'budget-cool-200',
    tk('Budget Cool 200'),
    {
      tags: ['film', 'cool', 'green', 'budget', 'fuji', 'c200'],
      inspiredBy: 'Fujicolor C200',
      description: tk('Cool, green-leaning budget film.'),
      version: 2
    },
    sCurve(15),
    presence({ saturation: 5 }),
    offset(150, 10),
    lift(170, 12),
    hueCurve('hueHue', [
      [60, 2.4],
      [120, 3]
    ]),
    hueCurve('hueSat', [
      [60, 1.05],
      [120, 1.1],
      [240, 0.9]
    ]),
    grain(25, 30, 55)
  ),
  look(
    'low-light-soft-1600',
    tk('Low-Light Soft 1600'),
    {
      tags: ['film', 'low light', 'soft', 'grain', 'fuji', 'natura', '1600'],
      inspiredBy: 'Fujifilm Natura 1600',
      description: tk('Soft, natural low-light colour with generous grain.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    tone({ shadows: 12 }),
    matte(0.04),
    presence({ saturation: -8 }),
    lift(150, 12),
    gain(40, 10),
    grain(35, 35, 60)
  ),
  look(
    'red-bias-consumer-200',
    tk('Red-Bias Consumer 200'),
    {
      tags: ['film', 'red', 'consumer', 'agfa', 'vista', '200'],
      inspiredBy: 'Agfa Vista 200',
      description: tk('Punchy reds and deep blue skies.'),
      version: 2
    },
    prim({ contrast: 1.09 }),
    presence({ saturation: 15 }),
    offset(15, 6),
    hueCurve('hueSat', [
      [0, 1.2],
      [240, 1.15]
    ]),
    hsl({ blue: [0, 0, -10] }),
    grain(22, 28, 50)
  ),
  look(
    'tungsten-night-800',
    tk('Tungsten Night 800'),
    {
      tags: ['film', 'night', 'tungsten', 'neon', 'halation', 'cinestill', '800t'],
      inspiredBy: 'CineStill 800T',
      description: tk('Tungsten night film: cool light, teal shadows and red-glowing highlights.'),
      version: 2
    },
    prim({ contrast: 1.07 }),
    presence({ saturation: -5 }),
    lift(190, 22),
    gain(30, 10),
    offset(215, 14),
    hueCurve('hueSat', [[0, 1.12]]),
    halationApprox(60),
    grain(30, 30, 55)
  ),
  look(
    'clean-daylight-50',
    tk('Clean Daylight 50'),
    {
      tags: ['film', 'daylight', 'clean', 'fine grain', 'cinestill', '50d'],
      inspiredBy: 'CineStill 50D',
      description: tk('Clean, saturated, very fine-grained daylight film.'),
      version: 2
    },
    sCurve(28),
    presence({ saturation: 15 }),
    offset(205, 6),
    hueCurve('hueHue', [[240, -1.5]]),
    hueCurve('hueSat', [
      [240, 1.15],
      [180, 1.1]
    ]),
    hsl({ blue: [0, 0, -8] }),
    halationApprox(25),
    grain(6, 15, 30)
  ),
  look(
    'warm-daylight-400',
    tk('Warm Daylight 400'),
    {
      tags: ['film', 'daylight', 'warm', 'cinestill', '400d'],
      inspiredBy: 'CineStill 400D',
      description: tk('Warm daylight film with a soft glow.'),
      version: 2
    },
    sCurve(20),
    presence({ saturation: 6 }),
    lift(195, 8),
    gain(40, 18),
    hueCurve('hueSat', [[30, 1.08]]),
    halationApprox(35),
    grain(22, 28, 50)
  ),
  look(
    'toy-colour-800',
    tk('Toy Colour 800'),
    {
      tags: ['film', 'lomo', 'saturated', 'vignette', 'lomography', '800'],
      inspiredBy: 'Lomography Color Negative 800',
      description: tk('Loud, warm colour, dark corners and plenty of grain.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    presence({ saturation: 20 }),
    offset(20, 8),
    vignette(-20),
    grain(30, 32, 60)
  ),
  look(
    'purple-swap',
    tk('Purple Swap'),
    {
      tags: ['film', 'creative', 'purple', 'false colour', 'lomochrome'],
      inspiredBy: 'LomoChrome Purple',
      description: tk(
        'Greens pushed toward purple and blues toward green: an approximation of the full swap.'
      ),
      version: 2
    },
    matte(0.03),
    calib({ greenHue: 100, blueHue: -80 }),
    hueCurve('hueHue', [
      [120, 30],
      [180, 18],
      [240, -24]
    ]),
    hueCurve('hueSat', [[120, 1.1]]),
    approximates('hueSwap'),
    grain(20, 28, 50)
  ),
  look(
    'metro-desat',
    tk('Metro Desat'),
    {
      tags: ['film', 'desaturated', 'urban', 'contrast', 'lomochrome', 'metropolis'],
      inspiredBy: 'LomoChrome Metropolis',
      description: tk('Drained urban colour with warm tones kept.'),
      version: 2
    },
    prim({ contrast: 1.15, sat: -50 }),
    hueCurve('hueSat', [
      [0, 1.2],
      [60, 1.2]
    ]),
    grain(25, 30, 55)
  ),
  look(
    'ir-false-colour',
    tk('IR False Colour'),
    {
      tags: ['film', 'infrared', 'false colour', 'creative', 'kodak', 'aerochrome'],
      inspiredBy: 'Kodak Aerochrome infrared film',
      description: tk('Foliage turned red-magenta: an approximation of infrared colour.'),
      version: 2
    },
    calib({ redHue: -60, greenHue: -100, greenSaturation: 40 }),
    hueCurve('hueHue', [
      [120, -30],
      [60, -30],
      [240, -9]
    ]),
    hueCurve('hueSat', [
      [120, 1.5],
      [60, 1.3],
      [240, 1.1]
    ]),
    hsl({ green: [0, 0, 10] }),
    approximates('hueSwap')
  ),
  look(
    'cross-processed-slide',
    tk('Cross-Processed Slide'),
    {
      tags: ['film', 'cross process', 'creative', 'saturated'],
      inspiredBy: 'Slide film cross-processed in C-41',
      description: tk('Blown contrast, cyan shadows and yellow highlights.'),
      version: 2
    },
    tone({ contrast: 35 }),
    presence({ saturation: 25 }),
    lift(210, 25),
    gain(70, 30),
    rgb({
      g: [
        [0, 0],
        [0.5, 0.56],
        [1, 1]
      ],
      b: [
        [0, 0.05],
        [0.5, 0.48],
        [1, 0.86]
      ]
    })
  ),
  look(
    'expired-film',
    tk('Expired Film'),
    {
      tags: ['film', 'expired', 'faded', 'vintage', 'magenta'],
      inspiredBy: 'Expired colour negative film',
      description: tk('Fogged blacks, shifted colour and heavy grain.'),
      version: 2
    },
    prim({ contrast: 0.91 }),
    matte(0.08, 0.04),
    presence({ saturation: -20 }),
    lift(160, 15),
    gain(330, 10),
    grain(40, 38, 70)
  ),
  look(
    'drugstore-print',
    tk('Drugstore Print'),
    {
      tags: ['film', 'print', 'nostalgic', '90s', 'warm'],
      inspiredBy: 'One-hour lab prints from the 1990s',
      description: tk('Bright, warm, slightly green-shadowed prints from the minilab.'),
      version: 2
    },
    sCurve(25),
    tone({ whites: 10 }),
    presence({ saturation: 10 }),
    lift(150, 10),
    gain(45, 12),
    grain(20, 28, 50)
  )
])
