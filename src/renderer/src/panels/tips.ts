import type { Tip } from '../components/InfoTip'
import { tk } from '../lib/i18n'

/**
 * What each adjustment does, what to expect from it and a habit worth
 * having: the notes behind the (i)s. Keyed by card (`light`) and by slider
 * (`light.exposure`). Written for someone who edits photos, not for
 * someone who wrote the engine.
 */
export const TIPS = {
  // ── White balance ──────────────────────────────────────────────────
  wb: {
    what: tk('Sets what counts as neutral white, so colours read as they did in the light you shot in.'),
    expect: tk('The whole picture shifts warmer or cooler, greener or pinker.'),
    tip: tk('Pick a grey or white with the eyedropper first, then season by eye.')
  },
  'wb.temp': {
    what: tk('Cools (left) or warms (right) the picture.'),
    expect: tk('Daylight sits near 5500 K; tungsten rooms want around 3200 K.'),
    tip: tk('Warm a touch past neutral for golden hour, cool for night and snow.')
  },
  'wb.tint': {
    what: tk('Pulls a green (left) or magenta (right) cast out.'),
    expect: tk('Small moves matter: fluorescent and LED light usually need some magenta.'),
    tip: tk('Fix Temp first; Tint is for the cast that remains in skin and greys.')
  },

  // ── Light ──────────────────────────────────────────────────────────
  light: {
    what: tk('Brightness and contrast, from the overall level down to the deepest blacks.'),
    expect: tk('The order top to bottom is the order most edits go in.'),
    tip: tk('Try Auto, then adjust Exposure and recover Highlights and Shadows by hand.')
  },
  'light.exposure': {
    what: tk('Brightens or darkens the whole picture, in stops.'),
    expect: tk('+1 doubles the light; highlights are the first to clip.'),
    tip: tk('Set it for the subject’s midtones, then pull Highlights back if the sky burns.')
  },
  'light.contrast': {
    what: tk('Spreads the tones apart (right) or draws them together (left).'),
    expect: tk('More contrast deepens shadows, brightens highlights and saturates colour a little.'),
    tip: tk('Keep it modest here; the Tone curve gives finer control.')
  },
  'light.highlights': {
    what: tk('Darkens or brightens only the bright parts of the picture.'),
    expect: tk('Left brings back clouds and bright skin; far left can look flat or grey.'),
    tip: tk('Lower it whenever the clipping warning (J) shows red in the sky.')
  },
  'light.shadows': {
    what: tk('Lifts or deepens only the dark parts of the picture.'),
    expect: tk('Right opens up detail in shade; too far looks HDR and lifts noise.'),
    tip: tk('Pair a Shadows lift with a slight Blacks drop to keep depth.')
  },
  'light.whites': {
    what: tk('Sets where the brightest tones end.'),
    expect: tk('Right adds sparkle; past the edge, pure white areas lose detail.'),
    tip: tk('Push it until the clipping warning (J) just shows, then back off a touch.')
  },
  'light.blacks': {
    what: tk('Sets where the darkest tones end.'),
    expect: tk('Left gives punch and deep blacks; right gives a faded, matte look.'),
    tip: tk('A little clipping in true blacks (shadows under a car) is fine.')
  },

  // ── Presence ───────────────────────────────────────────────────────
  presence: {
    what: tk('Local contrast at three scales: fine texture, midtone punch and haze.'),
    expect: tk('These change how sharp and deep a picture feels without moving its overall brightness.')
  },
  'presence.texture': {
    what: tk('Brings out or smooths fine detail: skin pores, foliage, fabric.'),
    expect: tk('Left smooths skin without blurring edges; right adds crispness.'),
    tip: tk('Around −15 is a gentle portrait smoother.')
  },
  'presence.clarity': {
    what: tk('Adds or removes contrast in the midtones, around edges.'),
    expect: tk('Right gives grit and depth; left gives a soft glow.'),
    tip: tk('Landscapes and architecture like +10 to +25; portraits rarely want more than +5.')
  },
  'presence.dehaze': {
    what: tk('Cuts through haze and fog by bringing back local contrast where the air is thick.'),
    expect:
      tk('Hazy areas regain depth and detail and keep their own brightness and colour; it does not darken the whole picture.'),
    tip: tk('For a denser, darker look add Contrast or a Tone Curve. Go negative for a soft, misty look.')
  },
  'hsl.luminance': {
    what: tk('Brightens or darkens one colour at a time.'),
    expect:
      tk('Even in feel across the range: all the way down halves a colour’s brightness, so a sky deepens without going black.')
  },
  'presence.smoothing': {
    what: tk('Keeps colour and tone changes smooth across flat areas such as sea, sky and skin, so they don’t go blotchy or show the file’s compression blocks.'),
    expect:
      tk('Works on Dehaze, Highlights and Shadows, Vibrance, Point Color and Color Grading. It shows when you let go of a slider, not while you drag.'),
    tip: tk('Turn it down only if you want each pixel to follow an adjustment exactly.')
  },

  // ── Colour ─────────────────────────────────────────────────────────
  colour: {
    what: tk('How strong colour is overall.'),
    expect:
      tk('Vibrance protects skin and already-strong colours; Saturation treats every colour alike.')
  },
  'colour.vibrance': {
    what: tk('Boosts muted colours more than strong ones, and protects skin.'),
    expect: tk('A natural lift that rarely looks overdone.'),
    tip: tk('Reach for Vibrance first, and Saturation only for a deliberate look.')
  },
  'colour.saturation': {
    what: tk('Makes every colour stronger or weaker by the same amount.'),
    expect: tk('−100 is black and white; past +30, skin turns orange.'),
    tip: tk('Lower Saturation with higher Vibrance gives a modern, muted look.')
  },
  'colour.hue': {
    what: tk('Turns every colour inside the mask around the colour wheel.'),
    expect: tk('Small moves recolour; big moves look surreal.')
  },

  // ── Colour mixer ───────────────────────────────────────────────────
  mixer: {
    what: tk('Changes the hue, saturation and brightness of one colour family at a time.'),
    expect: tk('Only that band moves: oranges for skin, blues for sky, greens for foliage.'),
    tip: tk('Use the target tool in the photo: drag on a colour to change the band under it.')
  },
  'mixer.bw': {
    what: tk('Sets how bright each original colour becomes in black and white.'),
    expect: tk('Darker blues give dramatic skies; brighter oranges give luminous skin.')
  },
  'mixer.point': {
    what: tk('Picks one exact colour from the photo and shifts only it.'),
    expect: tk('Tighter than the bands: a single jacket or a sign.'),
    tip: tk('Raise Range to catch the colour’s shadows and highlights too.')
  },

  // ── Colour grading ─────────────────────────────────────────────────
  grading: {
    what: tk('Tints shadows, midtones and highlights separately, as in film and cinema grading.'),
    expect: tk('Classic looks: teal shadows with warm highlights, or a warm overall wash.'),
    tip: tk('Keep saturation low (under 20) and let Blending soften the joins.')
  },
  'grading.blending': {
    what: tk('How much the three tints overlap.'),
    expect: tk('Higher is smoother and subtler; lower keeps each range’s colour distinct.')
  },
  'grading.balance': {
    what: tk('Moves the point where shadows hand over to highlights.'),
    expect: tk('Left lets the highlight tint reach deeper; right lets the shadow tint climb.')
  },

  // ── Tone curve ─────────────────────────────────────────────────────
  curve: {
    what: tk('Maps every input brightness to an output brightness, for full control of contrast.'),
    expect: tk('An S shape adds contrast; lifting the bottom-left point fades the blacks.'),
    tip: tk('Region sliders are the gentle way in; the point curve is for precise shapes and colour.')
  },
  'curve.region': {
    what: tk('Bends the curve in four broad ranges without placing points.'),
    expect: tk('Smooth, safe changes that never cross over.')
  },
  'curve.point': {
    what: tk('Places points on the curve itself, for all channels or red, green and blue alone.'),
    expect:
      tk('Lifting blue in the shadows and cutting it in the highlights gives a cross-processed look.'),
    tip: tk('Turn on the target tool and drag up or down on the photo to bend the curve there.')
  },

  // ── Detail ─────────────────────────────────────────────────────────
  detail: {
    what: tk('Sharpening and noise reduction.'),
    expect: tk('Both are only judged right at 100% (Z); fitted to the screen they look weaker.'),
    tip: tk('Reduce noise first, then sharpen what remains.')
  },
  'detail.amount': {
    what: tk('How strongly edges are sharpened.'),
    expect: tk('Past about 60, edges halo and noise grows.')
  },
  'detail.radius': {
    what: tk('How wide the sharpened edge is.'),
    expect: tk('Fine detail wants under 1; soft or large subjects can take more.')
  },
  'detail.detail': {
    what: tk('How much fine texture is sharpened, beyond the main edges.'),
    expect: tk('Higher brings out texture, and noise with it.')
  },
  'detail.masking': {
    what: tk('Keeps sharpening off smooth areas such as sky and skin.'),
    expect: tk('Higher sharpens only the strongest edges.'),
    tip: tk('For portraits, raise Masking until the skin stays smooth.')
  },
  'detail.luminance': {
    what: tk('Smooths grainy brightness noise.'),
    expect: tk('High values make surfaces look plastic.'),
    tip: tk('Raise it until the grain is gone at 100%, then back off a little.')
  },
  'detail.color': {
    what: tk('Removes coloured speckles from noise.'),
    expect: tk('Safe to raise to 25 or so; very high values bleed colour at edges.')
  },
  'detail.ai': {
    what: tk('A trained model removes the noise once; Strength then blends its result with the original.'),
    expect:
      tk('Much cleaner than classic noise reduction at high ISO. The result is kept with the photo, so undo, redo and Strength never run the model again.'),
    tip: tk('Run it once, then fine-tune with Strength.')
  },
  'detail.ai.raw': {
    what: tk('On a RAW, the model works on the developed, linear pixels: white balance, profile and tone stay as editable as before.'),
    expect:
      tk('The result is kept losslessly, so pushing it later shows no compression; undo, redo and Strength never run the model again.'),
    tip: tk('Run it once the exposure is roughly right, before fine colour work.')
  },
  'detail.rawDenoise': {
    what: tk('Takes the grain out of the camera’s raw sensor data before it becomes a picture, with an AI model (PMRID) that reads how noisy this photo is by itself.'),
    expect:
      tk('Best on high-ISO shots. Fine texture such as bark or fabric can look a little crisper or flatter. It works on the full-size picture, so judge it at 100%; the export has it too. Most cameras only: not Fujifilm X-Trans.')
  },
  'detail.ai.lossless': {
    what: tk('Keeps each AI result exactly, at about six times the size of near-lossless.'),
    expect:
      tk('Near-lossless (the default) cannot be told apart, but leaves a little less room for very strong exposure or shadow pushes.')
  },

  // ── Effects ────────────────────────────────────────────────────────
  effects: {
    what: tk('Finishing touches: a vignette, film grain and a colour wash.'),
    expect: tk('These run after the crop, on the finished picture.')
  },
  'effects.vignette': {
    what: tk('Darkens (left) or brightens (right) the corners after the crop.'),
    expect: tk('A small negative amount draws the eye to the centre.'),
    tip: tk('Raise Feather for a vignette nobody notices but everybody feels.')
  },
  'effects.grain': {
    what: tk('Adds film-like grain.'),
    expect: tk('Hides banding and noise and adds texture; Size and Roughness shape its character.'),
    tip: tk('Judge it at 100%: grain that looks right fitted is usually too strong.')
  },
  'grading.add': {
    what: tk('Adds coloured light to the whole scene, as a gel on a lamp would, after exposure.'),
    expect: tk('Unlike the wheels it tints by adding light, so shadows warm without going muddy.'),
    tip: tk('Neutralise turns a colour you click grey; Match turns one colour into another.')
  },
  'grading.add.mask': {
    what: tk('Adds coloured light only where the mask selects.'),
    expect: tk('A warm glow on a face, a cooler sky, without touching the rest.'),
    tip: tk('Neutralise turns a colour you click grey; Match turns one colour into another.')
  },
  'effects.wash': {
    what: tk('Lifts the whole finished picture toward one colour, blacks as much as whites.'),
    expect: tk('A gentle wash, a light leak or a faded print.')
  },

  // ── Optics ─────────────────────────────────────────────────────────
  optics: {
    what: tk('Corrects what the lens did: distortion, dark corners, colour fringes.'),
    expect: tk('Straighter lines near the edges and even brightness corner to corner.'),
    tip: tk('Turn on profile corrections for nearly every photo.')
  },
  'optics.profile': {
    what: tk('Corrects distortion and vignetting from a measured profile of your lens.'),
    expect: tk('The sliders scale the correction: 100 is as measured.')
  },
  'optics.ca': {
    what: tk('Removes the red and blue fringes along high-contrast edges.'),
    expect: tk('Most visible near the corners of wide lenses.')
  },
  'optics.defringe': {
    what: tk('Removes purple and green fringes around bright edges.'),
    expect: tk('Only along edges; flat areas of the same hue are left alone.'),
    tip: tk('Use the picker on a fringe to set the hue for you.')
  },
  'optics.manual': {
    what: tk('Corrects distortion and vignetting by hand.'),
    expect: tk('A correction that warps the frame crops its empty edges.')
  },

  // ── Geometry ───────────────────────────────────────────────────────
  geometry: {
    what: tk('Straightens verticals and horizons, and corrects perspective.'),
    expect: tk('Buildings stop leaning backwards; the crop fits the corrected picture.'),
    tip: tk('Try Auto first; Guided lets you draw the lines that should be straight.')
  },
  'geometry.upright': {
    what: tk('Levels the photo and makes it upright from the straight lines in it.'),
    expect:
      tk('Auto picks the most the lines support. The crop then fits the corrected picture; Transform adds to it.'),
    tip: tk('Guided: draw two to four lines that should be upright or level.')
  },
  'geometry.transform': {
    what: tk('Perspective by hand: tilt, turn, rotate, stretch and move the picture.'),
    expect: tk('Added on top of Upright. Reset puts the sliders back and keeps the Upright mode.')
  },
  'geometry.vertical': {
    what: tk('Tilts the picture forward or back to fix converging verticals.'),
    expect: tk('Leaning buildings stand up straight; some of the frame is cropped.')
  },
  'geometry.horizontal': {
    what: tk('Turns the picture left or right in perspective.'),
    expect: tk('A wall shot at an angle faces you more squarely.')
  },

  // ── Calibration ────────────────────────────────────────────────────
  calibration: {
    what: tk('Shifts how the camera’s red, green and blue primaries are read.'),
    expect: tk('Broad, subtle colour changes across the whole palette.'),
    tip: tk('Blue primary saturation up is a well-known trick for richer, cleaner colour.')
  },

  // ── Enhance ────────────────────────────────────────────────────────
  enhance: {
    what: tk('One-off AI steps on the pixels: JPEG repair, deblur and upscaling.'),
    expect: tk('They run once and are kept with the photo; undo takes them away.')
  },
  'enhance.jpeg': {
    what: tk('Repairs the blocks and colour smearing of heavily compressed JPEGs.'),
    expect:
      tk('Rebuild works from the file’s own compressed data, changing nothing it states; the AI methods repaint the damage.'),
    tip: tk('Rebuild first; the AI suits pictures saved from the web or messaging apps.')
  },
  'enhance.deblur': {
    what: tk('Reduces motion blur from camera shake or a moving subject.'),
    expect: tk('It cannot bring back focus that was missed.')
  },
  'enhance.apply': {
    what: tk('Runs the steps above once and keeps the result in the photo’s project as a step.'),
    expect:
      tk('Undo, redo and History never run the models again, and no file is written beside the photo. An upscale makes the photo larger from this step on; crop, masks and spots keep their places.')
  },
  'enhance.upscale': {
    what: tk('Makes the photo larger with a model that adds believable detail.'),
    expect:
      tk('×2 is a safe default; ×4 makes very large files. Source picks the model: Clean stays closest to a sharp original, Damaged repairs a compressed or noisy one as it enlarges, Keep texture leaves its grain.')
  }
} satisfies Record<string, Tip>

export type TipId = keyof typeof TIPS
