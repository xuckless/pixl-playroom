/**
 * The looks Playroom ships with. A preset is a recipe plus the groups it
 * carries: applying it copies those groups onto the photo and leaves the
 * rest (white balance, crop, masks) alone.
 */
import type { Preset } from './ipc'
import { defaultRecipe, type Recipe, type RecipeGroup } from './recipe'

function preset(
  id: string,
  name: string,
  group: string,
  groups: RecipeGroup[],
  edit: (r: Recipe) => void
): Preset {
  const recipe = defaultRecipe(false)
  edit(recipe)
  return { id: `builtin:${id}`, name, group, builtin: true, groups, recipe }
}

export const BUILTIN_PRESETS: Preset[] = [
  preset(
    'bw-contrast',
    'High-contrast B&W',
    'Black & white',
    ['treatment', 'hsl', 'basicTone', 'presence', 'toneCurve'],
    (r) => {
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
    }
  ),
  preset(
    'bw-soft',
    'Soft B&W',
    'Black & white',
    ['treatment', 'hsl', 'basicTone', 'presence'],
    (r) => {
      r.treatment = 'bw'
      r.basic.contrast = -15
      r.basic.highlights = -30
      r.basic.shadows = 30
      r.presence.clarity = -10
    }
  ),
  preset(
    'warm-film',
    'Warm film',
    'Film',
    ['toneCurve', 'colorGrade', 'effects', 'presence', 'hsl'],
    (r) => {
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
    }
  ),
  preset('cool-matte', 'Cool matte', 'Film', ['toneCurve', 'colorGrade', 'presence'], (r) => {
    r.toneCurve.master = [
      { x: 0, y: 0.08 },
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.72 },
      { x: 1, y: 0.94 }
    ]
    r.colorGrade.shadows = { hue: 220, saturation: 15, luminance: 0 }
    r.colorGrade.midtones = { hue: 190, saturation: 6, luminance: 0 }
    r.presence.saturation = -15
  }),
  preset('vivid', 'Vivid', 'Colour', ['basicTone', 'presence'], (r) => {
    r.basic.contrast = 20
    r.presence.vibrance = 35
    r.presence.saturation = 8
    r.presence.clarity = 10
  }),
  preset('teal-orange', 'Teal & orange', 'Colour', ['colorGrade', 'hsl', 'presence'], (r) => {
    r.colorGrade.shadows = { hue: 190, saturation: 30, luminance: -5 }
    r.colorGrade.highlights = { hue: 35, saturation: 25, luminance: 0 }
    r.colorGrade.balance = -10
    r.hsl.orange = { hue: 0, saturation: 10, luminance: 5 }
    r.hsl.blue = { hue: -15, saturation: 10, luminance: 0 }
    r.presence.vibrance = 10
  }),
  preset('landscape', 'Landscape pop', 'Colour', ['basicTone', 'presence', 'hsl'], (r) => {
    r.basic.highlights = -40
    r.basic.shadows = 30
    r.presence.dehaze = 15
    r.presence.clarity = 15
    r.presence.vibrance = 25
    r.hsl.blue = { hue: 0, saturation: 15, luminance: -15 }
    r.hsl.green = { hue: 10, saturation: 10, luminance: 0 }
  }),
  preset('portrait', 'Soft portrait', 'Portrait', ['presence', 'hsl', 'basicTone'], (r) => {
    r.presence.texture = -20
    r.presence.clarity = -10
    r.basic.shadows = 15
    r.hsl.orange = { hue: 0, saturation: -8, luminance: 10 }
    r.hsl.red = { hue: 5, saturation: -5, luminance: 5 }
  }),
  preset('vignette', 'Classic vignette', 'Effects', ['effects'], (r) => {
    r.effects.vignetteAmount = -30
    r.effects.vignetteFeather = 60
  })
]
