import type { Tip } from '../components/InfoTip'

/**
 * What each adjustment does, what to expect from it and a habit worth
 * having: the notes behind the (i)s. Keyed by card (`light`) and by slider
 * (`light.exposure`). Written for someone who edits photos, not for
 * someone who wrote the engine.
 */
export const TIPS = {
  // ── White balance ──────────────────────────────────────────────────
  wb: {
    what: 'Sets what counts as neutral white, so colours read as they did in the light you shot in.',
    expect: 'The whole picture shifts warmer or cooler, greener or pinker.',
    tip: 'Pick a grey or white with the eyedropper first, then season by eye.'
  },
  'wb.temp': {
    what: 'Cools (left) or warms (right) the picture.',
    expect: 'Daylight sits near 5500 K; tungsten rooms want around 3200 K.',
    tip: 'Warm a touch past neutral for golden hour, cool for night and snow.'
  },
  'wb.tint': {
    what: 'Pulls a green (left) or magenta (right) cast out.',
    expect: 'Small moves matter: fluorescent and LED light usually need some magenta.',
    tip: 'Fix Temp first; Tint is for the cast that remains in skin and greys.'
  },

  // ── Light ──────────────────────────────────────────────────────────
  light: {
    what: 'Brightness and contrast, from the overall level down to the deepest blacks.',
    expect: 'The order top to bottom is the order most edits go in.',
    tip: 'Try Auto, then adjust Exposure and recover Highlights and Shadows by hand.'
  },
  'light.exposure': {
    what: 'Brightens or darkens the whole picture, in stops.',
    expect: '+1 doubles the light; highlights are the first to clip.',
    tip: 'Set it for the subject’s midtones, then pull Highlights back if the sky burns.'
  },
  'light.contrast': {
    what: 'Spreads the tones apart (right) or draws them together (left).',
    expect: 'More contrast deepens shadows, brightens highlights and saturates colour a little.',
    tip: 'Keep it modest here; the Tone curve gives finer control.'
  },
  'light.highlights': {
    what: 'Darkens or brightens only the bright parts of the picture.',
    expect: 'Left brings back clouds and bright skin; far left can look flat or grey.',
    tip: 'Lower it whenever the clipping warning (J) shows red in the sky.'
  },
  'light.shadows': {
    what: 'Lifts or deepens only the dark parts of the picture.',
    expect: 'Right opens up detail in shade; too far looks HDR and lifts noise.',
    tip: 'Pair a Shadows lift with a slight Blacks drop to keep depth.'
  },
  'light.whites': {
    what: 'Sets where the brightest tones end.',
    expect: 'Right adds sparkle; past the edge, pure white areas lose detail.',
    tip: 'Push it until the clipping warning (J) just shows, then back off a touch.'
  },
  'light.blacks': {
    what: 'Sets where the darkest tones end.',
    expect: 'Left gives punch and deep blacks; right gives a faded, matte look.',
    tip: 'A little clipping in true blacks (shadows under a car) is fine.'
  },

  // ── Presence ───────────────────────────────────────────────────────
  presence: {
    what: 'Local contrast at three scales: fine texture, midtone punch and haze.',
    expect: 'These change how sharp and deep a picture feels without moving its overall brightness.'
  },
  'presence.texture': {
    what: 'Brings out or smooths fine detail: skin pores, foliage, fabric.',
    expect: 'Left smooths skin without blurring edges; right adds crispness.',
    tip: 'Around −15 is a gentle portrait smoother.'
  },
  'presence.clarity': {
    what: 'Adds or removes contrast in the midtones, around edges.',
    expect: 'Right gives grit and depth; left gives a soft glow.',
    tip: 'Landscapes and architecture like +10 to +25; portraits rarely want more than +5.'
  },
  'presence.dehaze': {
    what: 'Adds contrast that grows with distance, cutting through haze and fog.',
    expect: 'Skies go deeper and colours denser; past +40, edges halo and blues get loud.',
    tip: 'Go negative for a soft, misty look.'
  },

  // ── Colour ─────────────────────────────────────────────────────────
  colour: {
    what: 'How strong colour is overall.',
    expect:
      'Vibrance protects skin and already-strong colours; Saturation treats every colour alike.'
  },
  'colour.vibrance': {
    what: 'Boosts muted colours more than strong ones, and protects skin.',
    expect: 'A natural lift that rarely looks overdone.',
    tip: 'Reach for Vibrance first, and Saturation only for a deliberate look.'
  },
  'colour.saturation': {
    what: 'Makes every colour stronger or weaker by the same amount.',
    expect: '−100 is black and white; past +30, skin turns orange.',
    tip: 'Lower Saturation with higher Vibrance gives a modern, muted look.'
  },
  'colour.hue': {
    what: 'Turns every colour inside the mask around the colour wheel.',
    expect: 'Small moves recolour; big moves look surreal.'
  },

  // ── Colour mixer ───────────────────────────────────────────────────
  mixer: {
    what: 'Changes the hue, saturation and brightness of one colour family at a time.',
    expect: 'Only that band moves: oranges for skin, blues for sky, greens for foliage.',
    tip: 'Use the target tool in the photo: drag on a colour to change the band under it.'
  },
  'mixer.bw': {
    what: 'Sets how bright each original colour becomes in black and white.',
    expect: 'Darker blues give dramatic skies; brighter oranges give luminous skin.'
  },
  'mixer.point': {
    what: 'Picks one exact colour from the photo and shifts only it.',
    expect: 'Tighter than the bands: a single jacket or a sign.',
    tip: 'Raise Range to catch the colour’s shadows and highlights too.'
  },

  // ── Colour grading ─────────────────────────────────────────────────
  grading: {
    what: 'Tints shadows, midtones and highlights separately, as in film and cinema grading.',
    expect: 'Classic looks: teal shadows with warm highlights, or a warm overall wash.',
    tip: 'Keep saturation low (under 20) and let Blending soften the joins.'
  },
  'grading.blending': {
    what: 'How much the three tints overlap.',
    expect: 'Higher is smoother and subtler; lower keeps each range’s colour distinct.'
  },
  'grading.balance': {
    what: 'Moves the point where shadows hand over to highlights.',
    expect: 'Left lets the highlight tint reach deeper; right lets the shadow tint climb.'
  },

  // ── Tone curve ─────────────────────────────────────────────────────
  curve: {
    what: 'Maps every input brightness to an output brightness, for full control of contrast.',
    expect: 'An S shape adds contrast; lifting the bottom-left point fades the blacks.',
    tip: 'Region sliders are the gentle way in; the point curve is for precise shapes and colour.'
  },
  'curve.region': {
    what: 'Bends the curve in four broad ranges without placing points.',
    expect: 'Smooth, safe changes that never cross over.'
  },
  'curve.point': {
    what: 'Places points on the curve itself, for all channels or red, green and blue alone.',
    expect:
      'Lifting blue in the shadows and cutting it in the highlights gives a cross-processed look.',
    tip: 'Turn on the target tool and drag up or down on the photo to bend the curve there.'
  },

  // ── Detail ─────────────────────────────────────────────────────────
  detail: {
    what: 'Sharpening and noise reduction.',
    expect: 'Both are only judged right at 100% (Z); fitted to the screen they look weaker.',
    tip: 'Reduce noise first, then sharpen what remains.'
  },
  'detail.amount': {
    what: 'How strongly edges are sharpened.',
    expect: 'Past about 60, edges halo and noise grows.'
  },
  'detail.radius': {
    what: 'How wide the sharpened edge is.',
    expect: 'Fine detail wants under 1; soft or large subjects can take more.'
  },
  'detail.detail': {
    what: 'How much fine texture is sharpened, beyond the main edges.',
    expect: 'Higher brings out texture, and noise with it.'
  },
  'detail.masking': {
    what: 'Keeps sharpening off smooth areas such as sky and skin.',
    expect: 'Higher sharpens only the strongest edges.',
    tip: 'For portraits, raise Masking until the skin stays smooth.'
  },
  'detail.luminance': {
    what: 'Smooths grainy brightness noise.',
    expect: 'High values make surfaces look plastic.',
    tip: 'Raise it until the grain is gone at 100%, then back off a little.'
  },
  'detail.color': {
    what: 'Removes coloured speckles from noise.',
    expect: 'Safe to raise to 25 or so; very high values bleed colour at edges.'
  },
  'detail.ai': {
    what: 'A trained model removes the noise once; Strength then blends its result with the original.',
    expect:
      'Much cleaner than classic noise reduction at high ISO. The result is kept with the photo, so undo, redo and Strength never run the model again.',
    tip: 'Run it once, then fine-tune with Strength.'
  },
  'detail.ai.raw': {
    what: 'On a RAW, the model works on the developed, linear pixels: white balance, profile and tone stay as editable as before.',
    expect:
      'The result is kept losslessly, so pushing it later shows no compression; undo, redo and Strength never run the model again.',
    tip: 'Run it once the exposure is roughly right, before fine colour work.'
  },
  'detail.ai.lossless': {
    what: 'Keeps each AI result exactly, at about six times the size of near-lossless.',
    expect:
      'Near-lossless (the default) cannot be told apart, but leaves a little less room for very strong exposure or shadow pushes.'
  },

  // ── Effects ────────────────────────────────────────────────────────
  effects: {
    what: 'Finishing touches: a vignette, film grain and a colour wash.',
    expect: 'These run after the crop, on the finished picture.'
  },
  'effects.vignette': {
    what: 'Darkens (left) or brightens (right) the corners after the crop.',
    expect: 'A small negative amount draws the eye to the centre.',
    tip: 'Raise Feather for a vignette nobody notices but everybody feels.'
  },
  'effects.grain': {
    what: 'Adds film-like grain.',
    expect: 'Hides banding and noise and adds texture; Size and Roughness shape its character.',
    tip: 'Judge it at 100%: grain that looks right fitted is usually too strong.'
  },
  'grading.add': {
    what: 'Adds coloured light to the whole scene, as a gel on a lamp would, after exposure.',
    expect: 'Unlike the wheels it tints by adding light, so shadows warm without going muddy.',
    tip: 'Neutralise turns a colour you click grey; Match turns one colour into another.'
  },
  'grading.add.mask': {
    what: 'Adds coloured light only where the mask selects.',
    expect: 'A warm glow on a face, a cooler sky, without touching the rest.',
    tip: 'Neutralise turns a colour you click grey; Match turns one colour into another.'
  },
  'effects.wash': {
    what: 'Lifts the whole finished picture toward one colour, blacks as much as whites.',
    expect: 'A gentle wash, a light leak or a faded print.'
  },

  // ── Optics ─────────────────────────────────────────────────────────
  optics: {
    what: 'Corrects what the lens did: distortion, dark corners, colour fringes.',
    expect: 'Straighter lines near the edges and even brightness corner to corner.',
    tip: 'Turn on profile corrections for nearly every photo.'
  },
  'optics.profile': {
    what: 'Corrects distortion and vignetting from a measured profile of your lens.',
    expect: 'The sliders scale the correction: 100 is as measured.'
  },
  'optics.ca': {
    what: 'Removes the red and blue fringes along high-contrast edges.',
    expect: 'Most visible near the corners of wide lenses.'
  },
  'optics.defringe': {
    what: 'Removes purple and green fringes around bright edges.',
    expect: 'Only along edges; flat areas of the same hue are left alone.',
    tip: 'Use the picker on a fringe to set the hue for you.'
  },
  'optics.manual': {
    what: 'Corrects distortion and vignetting by hand.',
    expect: 'A correction that warps the frame crops its empty edges.'
  },

  // ── Geometry ───────────────────────────────────────────────────────
  geometry: {
    what: 'Straightens verticals and horizons, and corrects perspective.',
    expect: 'Buildings stop leaning backwards; the crop fits the corrected picture.',
    tip: 'Try Auto first; Guided lets you draw the lines that should be straight.'
  },
  'geometry.upright': {
    what: 'Levels the photo and makes it upright from the straight lines in it.',
    expect:
      'Auto picks the most the lines support. The crop then fits the corrected picture; Transform adds to it.',
    tip: 'Guided: draw two to four lines that should be upright or level.'
  },
  'geometry.transform': {
    what: 'Perspective by hand: tilt, turn, rotate, stretch and move the picture.',
    expect: 'Added on top of Upright. Reset puts the sliders back and keeps the Upright mode.'
  },
  'geometry.vertical': {
    what: 'Tilts the picture forward or back to fix converging verticals.',
    expect: 'Leaning buildings stand up straight; some of the frame is cropped.'
  },
  'geometry.horizontal': {
    what: 'Turns the picture left or right in perspective.',
    expect: 'A wall shot at an angle faces you more squarely.'
  },

  // ── Calibration ────────────────────────────────────────────────────
  calibration: {
    what: 'Shifts how the camera’s red, green and blue primaries are read.',
    expect: 'Broad, subtle colour changes across the whole palette.',
    tip: 'Blue primary saturation up is a well-known trick for richer, cleaner colour.'
  },

  // ── Enhance ────────────────────────────────────────────────────────
  enhance: {
    what: 'One-off AI steps on the pixels: JPEG repair, deblur and upscaling.',
    expect: 'They run once and are kept with the photo; undo takes them away.'
  },
  'enhance.jpeg': {
    what: 'Repairs the blocks and colour smearing of heavily compressed JPEGs.',
    expect:
      'Rebuild works from the file’s own compressed data, changing nothing it states; the AI methods repaint the damage.',
    tip: 'Rebuild first; the AI suits pictures saved from the web or messaging apps.'
  },
  'enhance.deblur': {
    what: 'Reduces motion blur from camera shake or a moving subject.',
    expect: 'It cannot bring back focus that was missed.'
  },
  'enhance.apply': {
    what: 'Runs the steps above once and keeps the result in the photo’s project as a step.',
    expect:
      'Undo, redo and History never run the models again, and no file is written beside the photo. An upscale makes the photo larger from this step on; crop, masks and spots keep their places.'
  },
  'enhance.upscale': {
    what: 'Makes the photo larger with a model that adds believable detail.',
    expect: '×2 is a safe default; ×4 makes very large files.'
  }
} satisfies Record<string, Tip>

export type TipId = keyof typeof TIPS
