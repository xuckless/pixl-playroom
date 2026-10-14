/**
 * Everyday starting points: the looks Playroom has always shipped (their ids
 * unchanged, so My Looks and old notes still find them) and a few more
 * general ones. Version 2 (2026-10-14) builds them on DaVinci Resolve's
 * tools: Lift, Gamma, Gain and Offset tints for the toning, the Primaries'
 * Contrast and Sat, the hue curves for a colour moved on its own, HSL for
 * its brightness; every one of them shows in the Resolve colour tools.
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
  master,
  matte,
  mono,
  offset,
  prim,
  presence,
  raw,
  sCurve,
  tone,
  vignette
} from './dsl'
import { tk } from '../i18n'

export const ESSENTIALS = collection('essentials', [
  look(
    'bw-contrast',
    tk('High-contrast B&W'),
    {
      tags: ['bw', 'mono', 'contrast', 'punchy'],
      description: tk('Deep blacks, bright skies held back.'),
      version: 2
    },
    mono({
      red: 20,
      orange: 25,
      yellow: 10,
      green: -20,
      aqua: -25,
      blue: -40,
      purple: -10,
      magenta: 10
    }),
    prim({ contrast: 1.3 }),
    tone({ whites: 15, blacks: -20 }),
    presence({ clarity: 20 })
  ),
  look(
    'bw-soft',
    tk('Soft B&W'),
    {
      tags: ['bw', 'mono', 'soft', 'gentle'],
      description: tk('Open shadows and quiet highlights.'),
      version: 2
    },
    mono(),
    prim({ contrast: 0.88 }),
    tone({ highlights: -30, shadows: 30 }),
    presence({ clarity: -10 })
  ),
  look(
    'warm-film',
    tk('Warm film'),
    {
      tags: ['film', 'warm', 'grain', 'analog'],
      description: tk('A warm print with soft blacks and fine grain.'),
      version: 2
    },
    sCurve(8),
    matte(0.05, 0.05),
    lift(200, 12),
    gain(40, 18),
    prim({ sat: 4 }),
    // Greens toward olive and quieter: a print's, not a screen's.
    hueCurve('hueHue', [[115, -10]]),
    hueCurve('hueSat', [[115, 0.8]]),
    grain(18, 30)
  ),
  look(
    'cool-matte',
    tk('Cool matte'),
    {
      tags: ['film', 'cool', 'matte', 'faded'],
      description: tk('Lifted blacks and cool, quiet colour.'),
      version: 2
    },
    sCurve(10),
    matte(0.08, 0.06),
    lift(220, 15),
    gamma(190, 6),
    prim({ sat: -15 })
  ),
  look(
    'vivid',
    tk('Vivid'),
    {
      tags: ['colour', 'vivid', 'saturated', 'punchy'],
      description: tk('More contrast and colour, skin kept in check.'),
      version: 2
    },
    prim({ contrast: 1.15, sat: 20 }),
    // Skin kept where it was: orange and red back down a little.
    hueCurve('hueSat', [[25, 0.88]], 25),
    presence({ clarity: 10 })
  ),
  look(
    'teal-orange',
    tk('Teal & orange'),
    {
      tags: ['colour', 'cinematic', 'teal', 'orange', 'blockbuster'],
      description: tk('Teal shadows against warm skin.'),
      version: 2
    },
    lift(190, 30),
    master('lift', -0.01),
    gain(35, 25),
    // Greens and blues fold toward teal; skin a touch richer.
    hueCurve('hueHue', [
      [120, 30],
      [225, -15]
    ]),
    hueCurve('hueSat', [
      [30, 1.12],
      [200, 1.12]
    ]),
    prim({ sat: 3 })
  ),
  look(
    'landscape',
    tk('Landscape pop'),
    {
      tags: ['landscape', 'nature', 'sky', 'clarity'],
      description: tk('Held highlights, open shadows, deeper skies.'),
      version: 2
    },
    tone({ highlights: -40, shadows: 30 }),
    presence({ dehaze: 15, clarity: 15 }),
    prim({ sat: 10 }),
    hueCurve('hueSat', [
      [215, 1.2],
      [100, 1.12]
    ]),
    hueCurve('hueHue', [[100, 6]]),
    hsl({ blue: [0, 0, -15] })
  ),
  look(
    'portrait',
    tk('Soft portrait'),
    {
      tags: ['portrait', 'skin', 'soft', 'people'],
      description: tk('Smoother skin and lifted shadows.'),
      version: 2
    },
    presence({ texture: -20, clarity: -10 }),
    tone({ shadows: 15 }),
    // Skin a little lighter and calmer; a whisper of warmth in the middle.
    hsl({ orange: [0, -8, 10], red: [5, -5, 5] }),
    gamma(30, 5)
  ),
  look(
    'vignette',
    tk('Classic vignette'),
    {
      tags: ['vignette', 'frame', 'effect'],
      description: tk('Darkened corners that draw the eye in.')
    },
    raw((r) => {
      r.effects.vignetteAmount = -30
      r.effects.vignetteFeather = 60
    })
  ),
  look(
    'clean-pop',
    tk('Clean pop'),
    {
      tags: ['colour', 'clean', 'bright', 'everyday'],
      description: tk('A gentle S-curve and clean colour.'),
      version: 2
    },
    sCurve(30),
    tone({ highlights: -15, shadows: 10 }),
    prim({ sat: 10 }),
    presence({ clarity: 8 }),
    hueCurve('hueSat', [[215, 1.1]]),
    hsl({ blue: [0, 0, -6] })
  ),
  look(
    'matte-fade',
    tk('Matte fade'),
    {
      tags: ['matte', 'faded', 'soft', 'film'],
      description: tk('Faded blacks and softened whites.'),
      version: 2
    },
    sCurve(15),
    matte(0.07, 0.04),
    prim({ sat: -10 })
  ),
  look(
    'golden-hour',
    tk('Golden hour'),
    {
      tags: ['warm', 'sunset', 'golden', 'glow'],
      description: tk('Low sun warmth, honeyed highlights.'),
      version: 2
    },
    lift(30, 8),
    gain(42, 22),
    offset(38, 6),
    tone({ highlights: -10, shadows: 10 }),
    hueCurve('hueHue', [[60, -6]]),
    hueCurve('hueSat', [
      [30, 1.08],
      [215, 0.85]
    ]),
    prim({ sat: 4 })
  ),
  look(
    'moody-blue',
    tk('Moody blue'),
    {
      tags: ['moody', 'cool', 'dark', 'blue'],
      description: tk('Cool, dark and quiet.'),
      version: 2
    },
    sCurve(25),
    matte(0.03),
    tone({ highlights: -20, whites: -10 }),
    lift(215, 20),
    gain(200, 6),
    prim({ sat: -20 }),
    hueCurve('hueHue', [[220, -5]]),
    hueCurve('hueSat', [
      [220, 1.1],
      [30, 0.95]
    ]),
    hsl({ orange: [0, 0, -5], blue: [0, 0, -10] }),
    vignette(-15, { feather: 70 })
  ),
  look(
    'crisp-detail',
    tk('Crisp detail'),
    {
      tags: ['detail', 'sharp', 'texture', 'architecture'],
      description: tk('Texture and clarity without crunch.')
    },
    tone({ contrast: 10, whites: 6, blacks: -6 }),
    presence({ texture: 30, clarity: 20, dehaze: 8 })
  ),
  look(
    'soft-pastel',
    tk('Soft pastel'),
    {
      tags: ['pastel', 'airy', 'soft', 'bright'],
      description: tk('Bright, low-contrast and pastel.'),
      version: 2
    },
    prim({ contrast: 0.85, sat: -12 }),
    tone({ shadows: 25, highlights: -10 }),
    matte(0.05),
    presence({ clarity: -8 }),
    lift(190, 8),
    gain(330, 8),
    grain(6, 20, 40)
  )
])
