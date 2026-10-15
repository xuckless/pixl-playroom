/**
 * Seasons, moods and colour play. Version 2 (2026-10-14) builds them on
 * DaVinci Resolve's tools: Lift, Gamma, Gain and Offset tints, the
 * Primaries' Contrast and Sat, hue curves to move one colour alone (a green
 * turned gold, a sky turned teal), HSL for brightness by colour.
 */
import {
  bloom,
  collection,
  gain,
  gamma,
  grain,
  hsl,
  hueCurve,
  lift,
  look,
  matte,
  offset,
  presence,
  prim,
  sCurve,
  tone,
  vignette,
  wash
} from './dsl'
import { tk } from '../i18n'

export const CREATIVE = collection('creative', [
  look(
    'faded-summer',
    tk('Faded Summer'),
    {
      tags: ['summer', 'faded', 'warm', 'nostalgic'],
      description: tk('A sun-bleached summer afternoon.'),
      version: 2
    },
    prim({ contrast: 0.92, sat: -10 }),
    tone({ shadows: 15 }),
    matte(0.06),
    lift(190, 8),
    gain(45, 15),
    grain(10, 20, 40)
  ),
  look(
    'autumn-gold',
    tk('Autumn Gold'),
    {
      tags: ['autumn', 'fall', 'gold', 'warm', 'foliage'],
      description: tk('Greens turned gold and orange, warm and rich.'),
      version: 2
    },
    sCurve(20),
    gamma(35, 10),
    // The leaves turn: greens and yellow-greens toward gold, the golds richer.
    hueCurve(
      'hueHue',
      [
        [105, -45],
        [70, -18]
      ],
      40
    ),
    hueCurve(
      'hueSat',
      [
        [105, 0.85],
        [45, 1.2]
      ],
      40
    ),
    hsl({ green: [0, 0, -10], orange: [0, 0, -5] }),
    prim({ sat: 5 })
  ),
  look(
    'winter-blue',
    tk('Winter Blue'),
    {
      tags: ['winter', 'cold', 'snow', 'blue'],
      description: tk('Crisp, cold and clean, with blue shadows.'),
      version: 2
    },
    prim({ contrast: 1.08, sat: -15 }),
    tone({ whites: 10 }),
    lift(215, 18),
    gain(200, 6),
    hueCurve('hueSat', [[30, 0.88]])
  ),
  look(
    'desert-heat',
    tk('Desert Heat'),
    {
      tags: ['desert', 'hot', 'warm', 'orange'],
      description: tk('Baked orange heat and hazy sky.'),
      version: 2
    },
    prim({ contrast: 1.12, sat: -5 }),
    presence({ dehaze: -10 }),
    offset(30, 18),
    hueCurve('hueSat', [[215, 0.72]]),
    hsl({ blue: [0, 0, 10] })
  ),
  look(
    'vaporwave',
    tk('Vaporwave'),
    {
      tags: ['vaporwave', 'retro', 'pink', 'cyan', 'synth'],
      description: tk('Magenta and cyan, faded and dreamy.'),
      version: 2
    },
    matte(0.05),
    lift(190, 30),
    gain(320, 30),
    hueCurve('hueSat', [
      [315, 1.35],
      [180, 1.35],
      [30, 0.8]
    ])
  ),
  look(
    'lo-fi',
    tk('Lo-Fi'),
    {
      tags: ['lo-fi', 'cheap camera', 'faded', 'grain'],
      description: tk('Cheap-camera charm: faded, soft and grainy.'),
      version: 2
    },
    prim({ contrast: 1.08, sat: -10 }),
    matte(0.06, 0.05),
    presence({ texture: -15 }),
    lift(160, 10),
    vignette(-25),
    grain(35, 40, 70)
  ),
  look(
    'cyberpunk-night',
    tk('Cyberpunk Night'),
    {
      tags: ['cyberpunk', 'neon', 'night', 'magenta', 'teal'],
      description: tk('Electric magenta and teal, deep blacks.'),
      version: 3
    },
    prim({ contrast: 1.2 }),
    tone({ blacks: -10 }),
    lift(185, 30),
    gain(315, 20),
    // Neon up, sodium yellow down.
    hueCurve('hueSat', [
      [315, 1.4],
      [275, 1.3],
      [180, 1.3],
      [60, 0.65]
    ]),
    bloom(30, { style: 'glow', threshold: 65, size: 55 })
  ),
  look(
    'mint-fresh',
    tk('Mint Fresh'),
    {
      tags: ['mint', 'fresh', 'pastel', 'airy'],
      description: tk('Bright, minty and clean.'),
      version: 2
    },
    prim({ contrast: 0.92, sat: -5 }),
    tone({ whites: 10 }),
    lift(160, 12),
    // Foliage leans minty and a touch quieter.
    hueCurve('hueHue', [[95, 14]], 40),
    hueCurve(
      'hueSat',
      [
        [95, 0.9],
        [180, 1.1]
      ],
      40
    ),
    hsl({ aqua: [0, 0, 10], green: [0, 0, 10], yellow: [0, 0, 6] })
  ),
  look(
    'sunset-glow',
    tk('Sunset Glow'),
    {
      tags: ['sunset', 'glow', 'warm', 'pink'],
      description: tk('Peach and pink evening glow.'),
      version: 2
    },
    tone({ highlights: -10, shadows: 10 }),
    lift(280, 10),
    gain(25, 25),
    prim({ sat: 5 }),
    wash(25, 60, 6)
  ),
  look(
    'forest-moody',
    tk('Forest Moody'),
    {
      tags: ['forest', 'moody', 'green', 'dark', 'nature'],
      description: tk('Deep, dark greens and misty quiet.'),
      version: 2
    },
    prim({ contrast: 1.08, sat: -10 }),
    tone({ highlights: -15, whites: -10 }),
    matte(0.03),
    // The greens deeper and toward pine, the yellow-greens out.
    hueCurve(
      'hueHue',
      [
        [115, 8],
        [65, -12]
      ],
      40
    ),
    hueCurve(
      'hueSat',
      [
        [115, 0.85],
        [65, 0.78]
      ],
      40
    ),
    hsl({ green: [0, 0, -20], yellow: [0, 0, -10] }),
    lift(170, 10)
  ),
  look(
    'ocean-deep',
    tk('Ocean Deep'),
    {
      tags: ['ocean', 'sea', 'blue', 'teal', 'water'],
      description: tk('Rich teal and deep sea blue.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    hueCurve('hueHue', [
      [180, -8],
      [220, -8]
    ]),
    hueCurve('hueSat', [
      [180, 1.35],
      [220, 1.3]
    ]),
    hsl({ aqua: [0, 0, -15], blue: [0, 0, -20] }),
    lift(200, 22),
    gamma(190, 8)
  ),
  look(
    'urban-grit',
    tk('Urban Grit'),
    {
      tags: ['urban', 'gritty', 'street', 'desaturated'],
      description: tk('Hard, gritty city detail with little colour.'),
      version: 2
    },
    prim({ contrast: 1.18, sat: -40 }),
    presence({ clarity: 30, texture: 15 }),
    lift(200, 6),
    grain(20, 28, 60)
  ),
  look(
    'peach-skin',
    tk('Peach Skin'),
    {
      tags: ['portrait', 'peach', 'warm', 'soft', 'skin'],
      description: tk('Soft peachy skin, gentle everything else.'),
      version: 2
    },
    prim({ contrast: 0.94 }),
    tone({ shadows: 12 }),
    presence({ texture: -12 }),
    hsl({ orange: [4, -4, 10], red: [6, -4, 6] }),
    gain(25, 18),
    gamma(20, 8)
  ),
  look(
    'cotton-candy',
    tk('Cotton Candy'),
    {
      tags: ['pastel', 'pink', 'blue', 'sweet'],
      description: tk('Pink highlights, blue shadows, all pastel.'),
      version: 2
    },
    prim({ contrast: 0.88, sat: -5 }),
    matte(0.04),
    lift(205, 20),
    gain(335, 18)
  ),
  look(
    'honey-haze',
    tk('Honey Haze'),
    {
      tags: ['honey', 'warm', 'haze', 'dreamy'],
      description: tk('Hazy, honeyed backlight.'),
      version: 3
    },
    prim({ contrast: 0.92 }),
    matte(0.04),
    presence({ dehaze: -15 }),
    offset(42, 15),
    tone({ shadows: 3 }),
    bloom(25, { warmth: 40 })
  ),
  look(
    'bleach-pop',
    tk('Bleach Pop'),
    {
      tags: ['bleach', 'fashion', 'contrast', 'desaturated'],
      description: tk('Fashion bleach: hard, bright and pale.'),
      version: 2
    },
    prim({ contrast: 1.28, sat: -35 }),
    tone({ whites: 15 }),
    presence({ clarity: 10 })
  ),
  look(
    'emerald-city',
    tk('Emerald City'),
    {
      tags: ['green', 'emerald', 'night', 'city'],
      description: tk('Everything leans emerald.'),
      version: 2
    },
    prim({ contrast: 1.12 }),
    lift(150, 25),
    gain(130, 10),
    // Greens turned toward emerald and richer (what Calibration's green did).
    hueCurve('hueHue', [[120, 12]], 50),
    hueCurve('hueSat', [[130, 1.25]], 50)
  )
])
