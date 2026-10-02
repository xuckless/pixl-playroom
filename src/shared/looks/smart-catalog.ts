/**
 * Smart looks: looks that make masks and run AI steps as they are applied
 * (`smart.ts`). Those made of colour ranges, gradients, the subject and the
 * background, AI denoise and deblur work on today's engine; those that need
 * the sky, people's parts or an object by name wait for the next engine
 * release, and say so in the browser until it lands.
 */
import {
  collection,
  deblur,
  denoise,
  fade,
  foliage,
  grain,
  hsl,
  inverted,
  look,
  mask,
  minus,
  part,
  presence,
  rolloff,
  sCurve,
  split,
  tone,
  vignette,
  wheel,
  within
} from './dsl'

export const SMART = collection('smart', [
  // ── Today: ranges, gradients, subject and background, AI steps ──
  look(
    'golden-subject',
    'Golden Subject',
    {
      tags: ['smart', 'subject', 'portrait', 'warm', 'cool', 'separation'],
      description: 'The subject warmed and lifted, the background cooled and quieted.'
    },
    sCurve(15),
    mask('subject', 'Subject', [part.subject()], {
      'wb.temperature': 14,
      'basic.exposure': 0.15,
      'presence.vibrance': 10
    }),
    mask('background', 'Background', [part.background()], {
      'wb.temperature': -12,
      'presence.saturation': -15,
      'basic.exposure': -0.1
    })
  ),
  look(
    'subject-pop',
    'Subject Pop',
    {
      tags: ['smart', 'subject', 'pop', 'separation', 'portrait', 'product'],
      description: 'The subject brighter and crisper; the background a step darker.'
    },
    tone({ contrast: 8 }),
    mask('subject', 'Subject', [part.subject()], {
      'basic.exposure': 0.2,
      'presence.clarity': 15,
      'presence.texture': 10
    }),
    mask('background', 'Background', [part.background()], {
      'basic.exposure': -0.35,
      'presence.saturation': -10
    })
  ),
  look(
    'quiet-background',
    'Quiet Background',
    {
      tags: ['smart', 'background', 'product', 'clean', 'muted', 'subject'],
      description: 'The background drained and softened so the subject carries the picture.'
    },
    mask('background', 'Background', [part.background()], {
      'presence.saturation': -60,
      'presence.clarity': -20,
      'basic.exposure': -0.2
    }),
    mask('subject', 'Subject', [part.subject()], {
      'presence.vibrance': 15,
      'presence.clarity': 10
    }),
    tone({ contrast: 5 })
  ),
  look(
    'teal-water',
    'Teal Water',
    {
      tags: ['smart', 'water', 'sea', 'teal', 'colour range', 'travel'],
      description: 'Water and sea pushed toward clear teal, the rest left alone.'
    },
    tone({ contrast: 6 }),
    mask(
      'water',
      'Water',
      [
        part.range({
          hue: { centre: 195, width: 50, softness: 30 },
          saturation: { centre: 0.55, width: 0.8, softness: 0.25 },
          smoothness: 30
        })
      ],
      {
        'hsl.aqua.hue': -10,
        'hsl.aqua.saturation': 30,
        'hsl.blue.hue': -20,
        'hsl.blue.saturation': 20,
        'basic.contrast': 10
      }
    )
  ),
  look(
    'autumn-turn',
    'Autumn Turn',
    {
      tags: ['smart', 'foliage', 'autumn', 'fall', 'colour range', 'landscape'],
      description: 'Green leaves turned to amber and rust; skies and skin untouched.'
    },
    split(200, 8, 40, 12),
    mask(
      'leaves',
      'Leaves',
      [
        part.range({
          hue: { centre: 85, width: 60, softness: 30 },
          saturation: { centre: 0.5, width: 0.8, softness: 0.25 },
          smoothness: 30
        })
      ],
      {
        'hsl.yellow.hue': -60,
        'hsl.green.hue': -100,
        'hsl.yellow.saturation': 20,
        'hsl.green.saturation': 10,
        'hsl.green.luminance': -10
      }
    )
  ),
  look(
    'lush-greens',
    'Lush Greens',
    {
      tags: ['smart', 'foliage', 'green', 'colour range', 'landscape', 'nature'],
      description: 'Deeper, richer foliage; everything else as it was.'
    },
    mask(
      'leaves',
      'Leaves',
      [
        part.range({
          hue: { centre: 95, width: 60, softness: 30 },
          saturation: { centre: 0.5, width: 0.8, softness: 0.25 },
          smoothness: 30
        })
      ],
      {
        'hsl.yellow.hue': 15,
        'hsl.green.saturation': 20,
        'hsl.yellow.saturation': 15,
        'hsl.green.luminance': -15,
        'hsl.yellow.luminance': -10
      }
    ),
    tone({ contrast: 6 })
  ),
  look(
    'graduated-sky',
    'Graduated Sky',
    {
      tags: ['smart', 'sky', 'gradient', 'landscape', 'nd grad'],
      description: 'A graduated filter from the top: a darker, deeper sky over any horizon.'
    },
    mask('grad', 'Top gradient', [part.linear([0.5, 0], [0.5, 0.5])], {
      'basic.exposure': -0.6,
      'basic.highlights': -30,
      'presence.saturation': 15,
      'presence.dehaze': 10
    })
  ),
  look(
    'sunset-grad',
    'Sunset Grad',
    {
      tags: ['smart', 'sky', 'gradient', 'sunset', 'warm', 'golden'],
      description: 'A warm graduated filter from the top, as a sunset filter would.'
    },
    mask('grad', 'Top gradient', [part.linear([0.5, 0], [0.5, 0.55])], {
      'wb.temperature': 30,
      'wb.tint': 8,
      'basic.exposure': -0.3,
      'presence.saturation': 20
    }),
    tone({ contrast: 8 })
  ),
  look(
    'spotlight',
    'Spotlight',
    {
      tags: ['smart', 'vignette', 'light', 'focus', 'radial', 'moody'],
      description: 'Light falling off around the middle of the frame, as from a spot.'
    },
    mask('edge', 'Around the light', [inverted(part.radial([0.5, 0.48], 0.75, 0.6, 70))], {
      'basic.exposure': -0.55,
      'presence.saturation': -10
    }),
    tone({ contrast: 10 })
  ),
  look(
    'clean-whites',
    'Clean Whites',
    {
      tags: ['smart', 'highlights', 'white', 'neutral', 'product', 'luminance range'],
      description: 'Colour casts taken out of the brightest tones only.'
    },
    mask(
      'whites',
      'Bright tones',
      [part.range({ luma: { centre: 0.9, width: 0.2, softness: 0.12 }, smoothness: 20 })],
      { 'presence.saturation': -45, 'basic.whites': 8 }
    )
  ),
  look(
    'teal-shadows',
    'Teal Shadows',
    {
      tags: ['smart', 'shadows', 'teal', 'cinematic', 'luminance range'],
      description: 'Teal laid into the deep tones only, where a split tone would tint the mids too.'
    },
    sCurve(15),
    mask(
      'shadows',
      'Deep tones',
      [part.range({ luma: { centre: 0.1, width: 0.25, softness: 0.15 }, smoothness: 20 })],
      { 'colorGrade.global.hue': 190, 'colorGrade.global.saturation': 35 }
    ),
    wheel('highlights', 40, 8)
  ),
  look(
    'night-city-clean',
    'Night City Clean',
    {
      tags: ['smart', 'night', 'city', 'neon', 'denoise', 'ai', 'high iso'],
      description: 'AI denoise for a high-ISO night shot, then a cool neon grade.'
    },
    denoise(60),
    sCurve(20),
    split(195, 22, 320, 10),
    presence({ vibrance: 15, clarity: 8 }),
    hsl({ magenta: [0, 20, 0], purple: [0, 15, 0], blue: [-8, 10, -10] })
  ),
  look(
    'high-iso-rescue',
    'High-ISO Rescue',
    {
      tags: ['smart', 'denoise', 'ai', 'high iso', 'low light', 'clean'],
      description: 'AI denoise, a little clarity back, the colour left as it was.'
    },
    denoise(70),
    presence({ clarity: 6, texture: 6 })
  ),
  look(
    'crisp-restore',
    'Crisp Restore',
    {
      tags: ['smart', 'deblur', 'sharpen', 'ai', 'restore', 'detail'],
      description: 'AI deblur for a soft or shaken shot, with gentle local contrast.'
    },
    deblur(50),
    presence({ clarity: 8 }),
    tone({ contrast: 5 })
  ),
  look(
    'subject-denoise',
    'Clean Subject',
    {
      tags: ['smart', 'denoise', 'ai', 'subject', 'portrait', 'low light'],
      description: 'AI denoise on the subject only, so the background keeps its grain.'
    },
    mask('subject', 'Subject', [part.subject()], { 'presence.clarity': 5 }),
    denoise(55, { scope: 'subject' }),
    grain(10, 20, 40)
  ),

  // ── With the next engine: sky, people's parts, objects ──
  look(
    'moody-sky',
    'Moody Sky',
    {
      tags: ['smart', 'sky', 'moody', 'dramatic', 'landscape', 'storm'],
      description: 'The sky (not the subject against it) darkened, deepened and given weight.'
    },
    mask(
      'sky',
      'Sky',
      [part.sky(), minus(part.subject())],
      {
        'basic.exposure': -0.5,
        'basic.highlights': -40,
        'presence.saturation': 15,
        'presence.dehaze': 20,
        'basic.contrast': 15
      },
      { required: true }
    ),
    tone({ contrast: 8 })
  ),
  look(
    'blue-sky-pop',
    'Blue Sky Pop',
    {
      tags: ['smart', 'sky', 'blue', 'travel', 'landscape', 'clear'],
      description: 'A clear, deep blue sky, with clouds kept white.'
    },
    mask(
      'sky',
      'Sky',
      [part.sky()],
      {
        'hsl.blue.saturation': 30,
        'hsl.blue.luminance': -15,
        'hsl.aqua.saturation': 15,
        'presence.dehaze': 15
      },
      { required: true }
    )
  ),
  look(
    'portrait-polish',
    'Portrait Polish',
    {
      tags: ['smart', 'portrait', 'skin', 'eyes', 'retouch', 'beauty', 'denoise'],
      description:
        'Smooth, even skin; brighter eyes; a clean subject. Hair and clothes keep their texture.'
    },
    mask(
      'skin',
      'Skin',
      [part.person('skin'), within(part.subject())],
      { 'presence.texture': -30, 'presence.clarity': -10, 'wb.temperature': 4 },
      { required: true }
    ),
    mask('eyes', 'Eyes', [part.person('eyes')], {
      'basic.exposure': 0.15,
      'presence.clarity': 15,
      'presence.saturation': 8
    }),
    denoise(30, { scope: 'skin' }),
    tone({ highlights: -8 })
  ),
  look(
    'bright-eyes',
    'Bright Eyes',
    {
      tags: ['smart', 'portrait', 'eyes', 'retouch'],
      description: 'Eyes a touch brighter and crisper, nothing else changed.'
    },
    mask(
      'eyes',
      'Eyes',
      [part.person('eyes')],
      { 'basic.exposure': 0.25, 'presence.clarity': 20, 'presence.saturation': 10 },
      { required: true }
    ),
    presence({ vibrance: 3 })
  ),
  look(
    'car-shine',
    'Car Shine',
    {
      tags: ['smart', 'car', 'object', 'automotive', 'gloss', 'pop'],
      description: 'The car crisp and glossy, the surroundings a step back.'
    },
    mask(
      'car',
      'Car',
      [part.object('car')],
      { 'presence.clarity': 25, 'basic.contrast': 15, 'presence.saturation': 15 },
      { required: true }
    ),
    mask('around', 'Around it', [inverted(part.object('car'))], {
      'basic.exposure': -0.25,
      'presence.saturation': -15
    }),
    vignette(-15, { feather: 70 })
  ),
  look(
    'rain-city-noir-lift',
    'Rain City Noir Lift',
    {
      tags: ['smart', 'noir', 'dark', 'moody', 'amber', 'skin', 'the batman', 'batman'],
      inspiredBy: 'The Batman (2022)',
      description:
        'Rain City Noir, with faces lifted out of the crushed dark and the background pressed down.'
    },
    sCurve(45),
    tone({ whites: -25, highlights: -25, shadows: -20, blacks: -15 }),
    rolloff(0.04),
    presence({ saturation: -30 }),
    wheel('midtones', 28, 25),
    wheel('shadows', 20, 15),
    hsl({ red: [0, 25, -5], orange: [-4, 5, -5], aqua: [0, -60, 0], blue: [0, -60, -10] }),
    foliage(0, -50, 0),
    mask(
      'skin',
      'Faces',
      [part.person('skin')],
      { 'basic.exposure': 0.25, 'presence.saturation': 10, 'basic.shadows': 15 },
      { required: true }
    ),
    mask('background', 'Background', [part.background()], { 'basic.exposure': -0.2 }),
    grain(12, 22, 45)
  ),
  look(
    'golden-hour-skin',
    'Golden Hour Skin',
    {
      tags: ['smart', 'portrait', 'skin', 'golden hour', 'warm', 'glow'],
      description: 'A warm, glowing light on skin only, as late sun would give.'
    },
    mask(
      'skin',
      'Skin',
      [part.person('skin')],
      { 'wb.temperature': 18, 'basic.exposure': 0.1, 'basic.highlights': -15 },
      { required: true }
    ),
    split(210, 6, 40, 10),
    fade(0.01)
  )
])
