/** Colour negative, slide and instant stocks, written from their character. */
import {
  approximates,
  calib,
  collection,
  fade,
  foliage,
  grain,
  halationApprox,
  hsl,
  look,
  presence,
  rgb,
  rolloff,
  sCurve,
  split,
  tone,
  vignette,
  wheel
} from './dsl'
import { tk } from '../i18n'

export const FILM_COLOUR = collection('film/colour', [
  look(
    'fine-portrait-160',
    tk('Fine Portrait 160'),
    {
      tags: ['film', 'portrait', 'skin', 'soft', 'kodak', 'portra', '160'],
      inspiredBy: 'Kodak Portra 160',
      description: tk('Low contrast, gentle saturation and creamy skin; fine grain.')
    },
    tone({ contrast: -10, highlights: -15 }),
    fade(0.02),
    rolloff(0.02),
    presence({ saturation: -12 }),
    split(180, 5, 45, 6),
    hsl({ orange: [0, -5, 5], blue: [0, -15, 0] }),
    foliage(5, -15, 0),
    grain(8, 18, 35)
  ),
  look(
    'warm-portrait-400',
    tk('Warm Portrait 400'),
    {
      tags: ['film', 'portrait', 'warm', 'wedding', 'kodak', 'portra', '400'],
      inspiredBy: 'Kodak Portra 400',
      description: tk('The classic portrait negative: warm skin, soft greens, long highlights.')
    },
    tone({ contrast: -5, highlights: -15 }),
    fade(0.03),
    rolloff(0.02),
    presence({ saturation: -5 }),
    split(170, 6, 42, 10),
    hsl({ orange: [-2, 0, 6], blue: [-10, -10, 0] }),
    foliage(10, -15, 0),
    grain(15, 22, 40)
  ),
  look(
    'warm-portrait-800',
    tk('Warm Portrait 800'),
    {
      tags: ['film', 'portrait', 'warm', 'low light', 'kodak', 'portra', '800'],
      inspiredBy: 'Kodak Portra 800',
      description: tk('Richer, warmer and grainier, with a green lean in the shadows.')
    },
    tone({ contrast: 8, highlights: -12 }),
    fade(0.03),
    presence({ saturation: 8 }),
    split(150, 12, 40, 16),
    hsl({ red: [0, 8, 0], orange: [-2, 10, 4], green: [8, -10, 0] }),
    grain(28, 30, 55)
  ),
  look(
    'vivid-landscape-100',
    tk('Vivid Landscape 100'),
    {
      tags: ['film', 'landscape', 'saturated', 'fine grain', 'kodak', 'ektar', '100'],
      inspiredBy: 'Kodak Ektar 100',
      description: tk('Saturated, fine-grained landscape negative; skin runs red.')
    },
    tone({ contrast: 20 }),
    presence({ saturation: 25 }),
    hsl({ red: [0, 20, 0], orange: [-4, 20, 0], blue: [0, 20, -10] }),
    grain(5, 15, 30)
  ),
  look(
    'golden-consumer-200',
    tk('Golden Consumer 200'),
    {
      tags: ['film', 'warm', 'golden', 'nostalgic', 'kodak', 'gold', '200'],
      inspiredBy: 'Kodak Gold 200',
      description: tk('Golden, sunny consumer film with yellowed greens.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: 10 }),
    wheel('midtones', 45, 10),
    wheel('highlights', 50, 18),
    hsl({ blue: [0, -10, 0] }),
    foliage(-10, 0, 0),
    grain(22, 28, 50)
  ),
  look(
    'punchy-consumer-400',
    tk('Punchy Consumer 400'),
    {
      tags: ['film', 'punchy', 'saturated', 'everyday', 'kodak', 'ultramax', '400'],
      inspiredBy: 'Kodak UltraMax 400',
      description: tk('Punchy everyday colour with strong reds.')
    },
    tone({ contrast: 15 }),
    presence({ saturation: 15 }),
    split(150, 8, 45, 10),
    hsl({ red: [0, 15, 0] }),
    grain(25, 30, 55)
  ),
  look(
    'budget-warm-200',
    tk('Budget Warm 200'),
    {
      tags: ['film', 'warm', 'budget', 'soft', 'kodak', 'colorplus', '200'],
      inspiredBy: 'Kodak ColorPlus 200',
      description: tk('Warm, soft and a little grainy, with muted blues.')
    },
    tone({ contrast: 5 }),
    presence({ saturation: 5, texture: -10 }),
    wheel('global', 45, 12),
    hsl({ blue: [0, -15, 0] }),
    grain(28, 32, 55)
  ),
  look(
    'clean-slide-100',
    tk('Clean Slide 100'),
    {
      tags: ['slide', 'film', 'clean', 'cool', 'kodak', 'ektachrome', 'e100'],
      inspiredBy: 'Kodak Ektachrome E100',
      description: tk('Clean, slightly cool slide film with crisp blues.')
    },
    tone({ contrast: 20, blacks: -5 }),
    presence({ saturation: 10 }),
    wheel('global', 210, 6),
    hsl({ blue: [0, 15, 0] }),
    grain(5, 15, 30)
  ),
  look(
    'classic-slide-64',
    tk('Classic Slide 64'),
    {
      tags: ['slide', 'film', 'vintage', 'rich', 'kodak', 'kodachrome', '64'],
      inspiredBy: 'Kodak Kodachrome 64',
      description: tk('Rich reds and yellows, deep blue skies and dense blacks.')
    },
    sCurve(40),
    tone({ blacks: -5 }),
    presence({ saturation: 10 }),
    split(200, 6, 45, 8),
    hsl({
      red: [0, 20, -5],
      yellow: [0, 15, 0],
      green: [-5, -10, 0],
      blue: [-8, 10, -15]
    }),
    grain(8, 18, 35)
  ),
  look(
    'saturated-slide-50',
    tk('Saturated Slide 50'),
    {
      tags: ['slide', 'film', 'saturated', 'landscape', 'fuji', 'velvia', '50'],
      inspiredBy: 'Fujifilm Velvia 50 (film)',
      description: tk('Maximum saturation, magenta shadows and dark skies.')
    },
    sCurve(40),
    tone({ contrast: 10 }),
    presence({ saturation: 40 }),
    wheel('shadows', 300, 10),
    hsl({ red: [-8, 20, 0], blue: [0, 0, -20] }),
    foliage(0, 30, 0),
    grain(4, 12, 25)
  ),
  look(
    'neutral-slide-100',
    tk('Neutral Slide 100'),
    {
      tags: ['slide', 'film', 'neutral', 'fuji', 'provia', '100f'],
      inspiredBy: 'Fujifilm Provia 100F (film)',
      description: tk('An honest, neutral slide film.')
    },
    sCurve(30),
    tone({ blacks: -10 }),
    presence({ saturation: 6 }),
    wheel('global', 210, 7),
    hsl({ blue: [0, 10, -10] }),
    grain(5, 15, 30)
  ),
  look(
    'green-cast-consumer-400',
    tk('Green-Cast Consumer 400'),
    {
      tags: ['film', 'green', 'consumer', 'fuji', 'superia', '400'],
      inspiredBy: 'Fujifilm Superia X-TRA 400',
      description: tk('Everyday film with green shadows and vivid greens.')
    },
    tone({ contrast: 10 }),
    presence({ saturation: 10 }),
    wheel('shadows', 155, 12),
    hsl({ orange: [-3, 0, 0] }),
    foliage(10, 10, 0),
    grain(25, 30, 55)
  ),
  look(
    'airy-pastel-400',
    tk('Airy Pastel 400'),
    {
      tags: ['film', 'pastel', 'airy', 'wedding', 'mint', 'fuji', '400h'],
      inspiredBy: 'Fujifilm Pro 400H',
      description: tk('Bright, airy pastels with mint greens.')
    },
    tone({ contrast: -20, shadows: 15, whites: 10 }),
    fade(0.04),
    presence({ saturation: -10 }),
    split(180, 10, 60, 5),
    hsl({ orange: [0, 0, 5] }),
    foliage(20, -10, 0),
    grain(15, 22, 40)
  ),
  look(
    'cool-portrait-160',
    tk('Cool Portrait 160'),
    {
      tags: ['film', 'portrait', 'cool', 'fuji', 'pro 160ns'],
      inspiredBy: 'Fujifilm Pro 160NS',
      description: tk('Cool, low-contrast portrait negative.')
    },
    tone({ contrast: -15, highlights: -10 }),
    fade(0.02),
    presence({ saturation: -12 }),
    split(170, 12, 60, 5),
    hsl({ orange: [0, -5, 6] }),
    foliage(12, -5, 0),
    grain(8, 18, 35)
  ),
  look(
    'budget-cool-200',
    tk('Budget Cool 200'),
    {
      tags: ['film', 'cool', 'green', 'budget', 'fuji', 'c200'],
      inspiredBy: 'Fujicolor C200',
      description: tk('Cool, green-leaning budget film.')
    },
    sCurve(15),
    presence({ saturation: 5 }),
    wheel('global', 150, 10),
    wheel('shadows', 170, 12),
    hsl({ yellow: [8, 5, 0], green: [10, 10, 0], blue: [0, -10, 0] }),
    grain(25, 30, 55)
  ),
  look(
    'low-light-soft-1600',
    tk('Low-Light Soft 1600'),
    {
      tags: ['film', 'low light', 'soft', 'grain', 'fuji', 'natura', '1600'],
      inspiredBy: 'Fujifilm Natura 1600',
      description: tk('Soft, natural low-light colour with generous grain.')
    },
    tone({ contrast: -10, shadows: 12 }),
    fade(0.04),
    presence({ saturation: -8 }),
    split(150, 12, 40, 10),
    grain(35, 35, 60)
  ),
  look(
    'red-bias-consumer-200',
    tk('Red-Bias Consumer 200'),
    {
      tags: ['film', 'red', 'consumer', 'agfa', 'vista', '200'],
      inspiredBy: 'Agfa Vista 200',
      description: tk('Punchy reds and deep blue skies.')
    },
    tone({ contrast: 15 }),
    presence({ saturation: 15 }),
    wheel('global', 15, 6),
    hsl({ red: [0, 20, 0], blue: [0, 15, -10] }),
    grain(22, 28, 50)
  ),
  look(
    'tungsten-night-800',
    tk('Tungsten Night 800'),
    {
      tags: ['film', 'night', 'tungsten', 'neon', 'halation', 'cinestill', '800t'],
      inspiredBy: 'CineStill 800T',
      description: tk('Tungsten night film: cool light, teal shadows and red-glowing highlights.')
    },
    tone({ contrast: 12 }),
    presence({ saturation: -5 }),
    split(190, 22, 30, 10),
    wheel('global', 215, 14),
    hsl({ red: [0, 12, 0] }),
    halationApprox(60),
    grain(30, 30, 55)
  ),
  look(
    'clean-daylight-50',
    tk('Clean Daylight 50'),
    {
      tags: ['film', 'daylight', 'clean', 'fine grain', 'cinestill', '50d'],
      inspiredBy: 'CineStill 50D',
      description: tk('Clean, saturated, very fine-grained daylight film.')
    },
    sCurve(28),
    presence({ saturation: 15 }),
    wheel('global', 205, 6),
    hsl({ blue: [-5, 15, -8], aqua: [0, 10, 0] }),
    halationApprox(25),
    grain(6, 15, 30)
  ),
  look(
    'warm-daylight-400',
    tk('Warm Daylight 400'),
    {
      tags: ['film', 'daylight', 'warm', 'cinestill', '400d'],
      inspiredBy: 'CineStill 400D',
      description: tk('Warm daylight film with a soft glow.')
    },
    sCurve(20),
    presence({ saturation: 6 }),
    split(195, 8, 40, 18),
    hsl({ orange: [0, 8, 0] }),
    halationApprox(35),
    grain(22, 28, 50)
  ),
  look(
    'toy-colour-800',
    tk('Toy Colour 800'),
    {
      tags: ['film', 'lomo', 'saturated', 'vignette', 'lomography', '800'],
      inspiredBy: 'Lomography Color Negative 800',
      description: tk('Loud, warm colour, dark corners and plenty of grain.')
    },
    tone({ contrast: 20 }),
    presence({ saturation: 20 }),
    wheel('global', 20, 8),
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
      )
    },
    fade(0.03),
    calib({ greenHue: 100, blueHue: -80 }),
    hsl({ green: [100, 10, 0], aqua: [60, 0, 0], blue: [-80, 0, 0] }),
    approximates('hueSwap'),
    grain(20, 28, 50)
  ),
  look(
    'metro-desat',
    tk('Metro Desat'),
    {
      tags: ['film', 'desaturated', 'urban', 'contrast', 'lomochrome', 'metropolis'],
      inspiredBy: 'LomoChrome Metropolis',
      description: tk('Drained urban colour with warm tones kept.')
    },
    tone({ contrast: 25 }),
    presence({ saturation: -50 }),
    hsl({ red: [0, 20, 0], yellow: [0, 20, 0] }),
    grain(25, 30, 55)
  ),
  look(
    'ir-false-colour',
    tk('IR False Colour'),
    {
      tags: ['film', 'infrared', 'false colour', 'creative', 'kodak', 'aerochrome'],
      inspiredBy: 'Kodak Aerochrome infrared film',
      description: tk('Foliage turned red-magenta: an approximation of infrared colour.')
    },
    calib({ redHue: -60, greenHue: -100, greenSaturation: 40 }),
    hsl({ green: [-100, 50, 10], yellow: [-100, 30, 0], blue: [-30, 10, 0] }),
    approximates('hueSwap')
  ),
  look(
    'cross-processed-slide',
    tk('Cross-Processed Slide'),
    {
      tags: ['film', 'cross process', 'creative', 'saturated'],
      inspiredBy: 'Slide film cross-processed in C-41',
      description: tk('Blown contrast, cyan shadows and yellow highlights.')
    },
    tone({ contrast: 35 }),
    presence({ saturation: 25 }),
    split(210, 25, 70, 30),
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
      description: tk('Fogged blacks, shifted colour and heavy grain.')
    },
    tone({ contrast: -15 }),
    fade(0.08),
    rolloff(0.04),
    presence({ saturation: -20 }),
    split(160, 15, 330, 10),
    grain(40, 38, 70)
  ),
  look(
    'drugstore-print',
    tk('Drugstore Print'),
    {
      tags: ['film', 'print', 'nostalgic', '90s', 'warm'],
      inspiredBy: 'One-hour lab prints from the 1990s',
      description: tk('Bright, warm, slightly green-shadowed prints from the minilab.')
    },
    sCurve(25),
    tone({ whites: 10 }),
    presence({ saturation: 10 }),
    split(150, 10, 45, 12),
    grain(20, 28, 50)
  )
])
