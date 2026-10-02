/** Seasons, moods and colour play. */
import {
  bloomApprox,
  calib,
  collection,
  fade,
  grain,
  hsl,
  look,
  presence,
  rolloff,
  sCurve,
  split,
  tone,
  vignette,
  wash,
  wheel
} from './dsl'

export const CREATIVE = collection('creative', [
  look(
    'faded-summer',
    'Faded Summer',
    {
      tags: ['summer', 'faded', 'warm', 'nostalgic'],
      description: 'A sun-bleached summer afternoon.'
    },
    tone({ contrast: -10, shadows: 15 }),
    fade(0.06),
    presence({ saturation: -10 }),
    split(190, 8, 45, 15),
    grain(10, 20, 40)
  ),
  look(
    'autumn-gold',
    'Autumn Gold',
    {
      tags: ['autumn', 'fall', 'gold', 'warm', 'foliage'],
      description: 'Greens turned gold and orange, warm and rich.'
    },
    sCurve(20),
    presence({ vibrance: 15 }),
    wheel('midtones', 35, 10),
    hsl({ yellow: [-20, 15, 0], green: [-60, -20, -10], orange: [0, 15, -5] })
  ),
  look(
    'winter-blue',
    'Winter Blue',
    {
      tags: ['winter', 'cold', 'snow', 'blue'],
      description: 'Crisp, cold and clean, with blue shadows.'
    },
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: -15 }),
    split(215, 18, 200, 6),
    hsl({ orange: [0, -10, 0] })
  ),
  look(
    'desert-heat',
    'Desert Heat',
    { tags: ['desert', 'hot', 'warm', 'orange'], description: 'Baked orange heat and hazy sky.' },
    tone({ contrast: 15 }),
    presence({ dehaze: -10, saturation: -5 }),
    wheel('global', 30, 18),
    hsl({ blue: [0, -25, 10] })
  ),
  look(
    'vaporwave',
    'Vaporwave',
    {
      tags: ['vaporwave', 'retro', 'pink', 'cyan', 'synth'],
      description: 'Magenta and cyan, faded and dreamy.'
    },
    fade(0.05),
    split(190, 30, 320, 30),
    hsl({ magenta: [0, 30, 0], aqua: [0, 30, 0], orange: [0, -20, 0] })
  ),
  look(
    'lo-fi',
    'Lo-Fi',
    {
      tags: ['lo-fi', 'cheap camera', 'faded', 'grain'],
      description: 'Cheap-camera charm: faded, soft and grainy.'
    },
    tone({ contrast: 10 }),
    fade(0.06),
    rolloff(0.05),
    presence({ saturation: -10, texture: -15 }),
    wheel('shadows', 160, 10),
    vignette(-25),
    grain(35, 40, 70)
  ),
  look(
    'cyberpunk-night',
    'Cyberpunk Night',
    {
      tags: ['cyberpunk', 'neon', 'night', 'magenta', 'teal'],
      description: 'Electric magenta and teal, deep blacks.'
    },
    tone({ contrast: 25, blacks: -10 }),
    split(185, 30, 315, 20),
    hsl({ magenta: [0, 35, 0], purple: [0, 25, 0], aqua: [0, 25, 0], yellow: [0, -30, 0] }),
    bloomApprox(15)
  ),
  look(
    'mint-fresh',
    'Mint Fresh',
    { tags: ['mint', 'fresh', 'pastel', 'airy'], description: 'Bright, minty and clean.' },
    tone({ contrast: -10, whites: 10 }),
    presence({ saturation: -5 }),
    wheel('shadows', 160, 12),
    hsl({ green: [25, -10, 10], aqua: [0, 10, 10] })
  ),
  look(
    'sunset-glow',
    'Sunset Glow',
    { tags: ['sunset', 'glow', 'warm', 'pink'], description: 'Peach and pink evening glow.' },
    tone({ highlights: -10, shadows: 10 }),
    split(280, 10, 25, 25),
    presence({ vibrance: 15 }),
    wash(25, 60, 6)
  ),
  look(
    'forest-moody',
    'Forest Moody',
    {
      tags: ['forest', 'moody', 'green', 'dark', 'nature'],
      description: 'Deep, dark greens and misty quiet.'
    },
    tone({ contrast: 10, highlights: -15, whites: -10 }),
    fade(0.03),
    presence({ saturation: -10 }),
    hsl({ green: [10, -15, -20], yellow: [-15, -20, -10] }),
    wheel('shadows', 170, 10)
  ),
  look(
    'ocean-deep',
    'Ocean Deep',
    {
      tags: ['ocean', 'sea', 'blue', 'teal', 'water'],
      description: 'Rich teal and deep sea blue.'
    },
    tone({ contrast: 15 }),
    hsl({ aqua: [-10, 25, -10], blue: [-10, 20, -15] }),
    wheel('shadows', 200, 12)
  ),
  look(
    'urban-grit',
    'Urban Grit',
    {
      tags: ['urban', 'gritty', 'street', 'desaturated'],
      description: 'Hard, gritty city detail with little colour.'
    },
    tone({ contrast: 20 }),
    presence({ saturation: -40, clarity: 30, texture: 15 }),
    wheel('shadows', 200, 6),
    grain(20, 28, 60)
  ),
  look(
    'peach-skin',
    'Peach Skin',
    {
      tags: ['portrait', 'peach', 'warm', 'soft', 'skin'],
      description: 'Soft peachy skin, gentle everything else.'
    },
    tone({ contrast: -5, shadows: 10 }),
    presence({ texture: -10 }),
    hsl({ orange: [3, -5, 8], red: [5, -5, 5] }),
    wheel('highlights', 30, 10)
  ),
  look(
    'cotton-candy',
    'Cotton Candy',
    {
      tags: ['pastel', 'pink', 'blue', 'sweet'],
      description: 'Pink highlights, blue shadows, all pastel.'
    },
    tone({ contrast: -15 }),
    fade(0.04),
    split(205, 20, 335, 18),
    presence({ saturation: -5 })
  ),
  look(
    'honey-haze',
    'Honey Haze',
    { tags: ['honey', 'warm', 'haze', 'dreamy'], description: 'Hazy, honeyed backlight.' },
    tone({ contrast: -10 }),
    fade(0.04),
    presence({ dehaze: -15 }),
    wheel('global', 42, 15),
    bloomApprox(20)
  ),
  look(
    'bleach-pop',
    'Bleach Pop',
    {
      tags: ['bleach', 'fashion', 'contrast', 'desaturated'],
      description: 'Fashion bleach: hard, bright and pale.'
    },
    tone({ contrast: 30, whites: 15 }),
    presence({ saturation: -35, clarity: 10 })
  ),
  look(
    'emerald-city',
    'Emerald City',
    { tags: ['green', 'emerald', 'night', 'city'], description: 'Everything leans emerald.' },
    tone({ contrast: 15 }),
    split(150, 25, 130, 10),
    calib({ greenHue: 10, greenSaturation: 20 })
  )
])
