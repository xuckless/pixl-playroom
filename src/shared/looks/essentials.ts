/**
 * Everyday starting points: the looks Playroom has always shipped (their ids
 * and numbers unchanged, so My Looks and old notes still find them) and a
 * few more general ones.
 */
import {
  collection,
  fade,
  grain,
  hsl,
  look,
  presence,
  raw,
  rolloff,
  sCurve,
  split,
  tone,
  vignette,
  wheel
} from './dsl'
import { tk } from '../i18n'

export const ESSENTIALS = collection('essentials', [
  look(
    'bw-contrast',
    tk('High-contrast B&W'),
    {
      tags: ['bw', 'mono', 'contrast', 'punchy'],
      description: tk('Deep blacks, bright skies held back.')
    },
    raw((r) => {
      r.treatment = 'bw'
      r.bwMix = {
        red: 20,
        orange: 25,
        yellow: 10,
        green: -20,
        aqua: -25,
        blue: -40,
        purple: -10,
        magenta: 10
      }
      r.basic.contrast = 35
      r.basic.whites = 15
      r.basic.blacks = -20
      r.presence.clarity = 20
    })
  ),
  look(
    'bw-soft',
    tk('Soft B&W'),
    {
      tags: ['bw', 'mono', 'soft', 'gentle'],
      description: tk('Open shadows and quiet highlights.')
    },
    raw((r) => {
      r.treatment = 'bw'
      r.basic.contrast = -15
      r.basic.highlights = -30
      r.basic.shadows = 30
      r.presence.clarity = -10
    })
  ),
  look(
    'warm-film',
    tk('Warm film'),
    {
      tags: ['film', 'warm', 'grain', 'analog'],
      description: tk('A warm print with soft blacks and fine grain.')
    },
    raw((r) => {
      r.toneCurve.master = [
        { x: 0, y: 0.05 },
        { x: 0.25, y: 0.24 },
        { x: 0.75, y: 0.78 },
        { x: 1, y: 0.95 }
      ]
      r.colorGrade.shadows = { hue: 200, saturation: 12, luminance: 0 }
      r.colorGrade.highlights = { hue: 40, saturation: 18, luminance: 0 }
      r.presence.vibrance = 10
      r.effects.grainAmount = 18
      r.effects.grainSize = 30
      r.hsl.green = { hue: 15, saturation: -20, luminance: 0 }
    })
  ),
  look(
    'cool-matte',
    tk('Cool matte'),
    {
      tags: ['film', 'cool', 'matte', 'faded'],
      description: tk('Lifted blacks and cool, quiet colour.')
    },
    raw((r) => {
      r.toneCurve.master = [
        { x: 0, y: 0.08 },
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.72 },
        { x: 1, y: 0.94 }
      ]
      r.colorGrade.shadows = { hue: 220, saturation: 15, luminance: 0 }
      r.colorGrade.midtones = { hue: 190, saturation: 6, luminance: 0 }
      r.presence.saturation = -15
    })
  ),
  look(
    'vivid',
    tk('Vivid'),
    {
      tags: ['colour', 'vivid', 'saturated', 'punchy'],
      description: tk('More contrast and colour, skin kept in check.')
    },
    raw((r) => {
      r.basic.contrast = 20
      r.presence.vibrance = 35
      r.presence.saturation = 8
      r.presence.clarity = 10
    })
  ),
  look(
    'teal-orange',
    tk('Teal & orange'),
    {
      tags: ['colour', 'cinematic', 'teal', 'orange', 'blockbuster'],
      description: tk('Teal shadows against warm skin.')
    },
    raw((r) => {
      r.colorGrade.shadows = { hue: 190, saturation: 30, luminance: -5 }
      r.colorGrade.highlights = { hue: 35, saturation: 25, luminance: 0 }
      r.colorGrade.balance = -10
      r.hsl.orange = { hue: 0, saturation: 10, luminance: 5 }
      r.hsl.blue = { hue: -15, saturation: 10, luminance: 0 }
      r.presence.vibrance = 10
    })
  ),
  look(
    'landscape',
    tk('Landscape pop'),
    {
      tags: ['landscape', 'nature', 'sky', 'clarity'],
      description: tk('Held highlights, open shadows, deeper skies.')
    },
    raw((r) => {
      r.basic.highlights = -40
      r.basic.shadows = 30
      r.presence.dehaze = 15
      r.presence.clarity = 15
      r.presence.vibrance = 25
      r.hsl.blue = { hue: 0, saturation: 15, luminance: -15 }
      r.hsl.green = { hue: 10, saturation: 10, luminance: 0 }
    })
  ),
  look(
    'portrait',
    tk('Soft portrait'),
    {
      tags: ['portrait', 'skin', 'soft', 'people'],
      description: tk('Smoother skin and lifted shadows.')
    },
    raw((r) => {
      r.presence.texture = -20
      r.presence.clarity = -10
      r.basic.shadows = 15
      r.hsl.orange = { hue: 0, saturation: -8, luminance: 10 }
      r.hsl.red = { hue: 5, saturation: -5, luminance: 5 }
    })
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
      description: tk('A gentle S-curve and clean colour.')
    },
    sCurve(30),
    tone({ highlights: -15, shadows: 10 }),
    presence({ vibrance: 25, clarity: 8 }),
    hsl({ blue: [0, 10, -6] })
  ),
  look(
    'matte-fade',
    tk('Matte fade'),
    {
      tags: ['matte', 'faded', 'soft', 'film'],
      description: tk('Faded blacks and softened whites.')
    },
    sCurve(15),
    fade(0.07),
    rolloff(0.04),
    presence({ saturation: -10 })
  ),
  look(
    'golden-hour',
    tk('Golden hour'),
    {
      tags: ['warm', 'sunset', 'golden', 'glow'],
      description: tk('Low sun warmth, honeyed highlights.')
    },
    split(30, 8, 42, 22),
    wheel('global', 38, 6),
    tone({ highlights: -10, shadows: 10 }),
    hsl({ orange: [0, 8, 4], yellow: [-6, 5, 0], blue: [0, -15, 0] }),
    presence({ vibrance: 10 })
  ),
  look(
    'moody-blue',
    tk('Moody blue'),
    { tags: ['moody', 'cool', 'dark', 'blue'], description: tk('Cool, dark and quiet.') },
    sCurve(25),
    fade(0.03),
    tone({ highlights: -20, whites: -10 }),
    split(215, 20, 200, 6),
    presence({ saturation: -20 }),
    hsl({ orange: [0, -5, -5], blue: [-5, 10, -10] }),
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
      description: tk('Bright, low-contrast and pastel.')
    },
    tone({ contrast: -20, shadows: 25, highlights: -10 }),
    fade(0.05),
    presence({ saturation: -12, clarity: -8 }),
    split(190, 8, 330, 8),
    grain(6, 20, 40)
  )
])
