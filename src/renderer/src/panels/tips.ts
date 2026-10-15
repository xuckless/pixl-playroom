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
    what: tk(
      'Sets what counts as neutral white, so colours read as they did in the light you shot in.'
    ),
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
    expect: tk(
      'More contrast deepens shadows, brightens highlights and saturates colour a little.'
    ),
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
  'light.toneBase': {
    what: tk(
      'Where Highlights, Shadows, Whites and Blacks read the photo. None reads each pixel as it is; Keep texture reads a smoothed version, so fine detail keeps its contrast where they pull.'
    ),
    expect: tk(
      'With Keep texture, strong Shadows or Highlights look less flat and less haloed. It renders a little slower; while you drag you may see a quicker version, and the full one when you let go.'
    ),
    tip: tk('It applies to the whole photo and its masks.')
  },

  // ── Presence ───────────────────────────────────────────────────────
  presence: {
    what: tk(
      'Local contrast at three scales (fine texture, midtone punch and haze), then how strong colour is.'
    ),
    expect: tk(
      'Texture, Clarity and Dehaze change how sharp and deep a picture feels without moving its brightness; Vibrance protects skin and already-strong colours, Saturation treats every colour alike.'
    )
  },
  basic: {
    what: tk(
      'The first corrections nearly every photo gets: its treatment and profile, white balance, light and presence.'
    ),
    expect: tk(
      'Work top to bottom: set the colour, then the brightness and contrast, then texture and colour strength.'
    ),
    tip: tk('The reset and eye at the top act on all of it; each part has its own too.')
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
    expect: tk(
      'Hazy areas regain depth and detail and keep their own brightness and colour; it does not darken the whole picture.'
    ),
    tip: tk(
      'For a denser, darker look add Contrast or a Tone Curve. Go negative for a soft, misty look.'
    )
  },
  'hsl.luminance': {
    what: tk('Brightens or darkens one colour at a time.'),
    expect: tk(
      'Even in feel across the range: all the way down halves a colour’s brightness, so a sky deepens without going black.'
    )
  },
  'presence.smoothing': {
    what: tk(
      'Keeps colour and tone changes smooth across flat areas such as sea, sky and skin, so they don’t go blotchy or show the file’s compression blocks.'
    ),
    expect: tk(
      'Works on Highlights, Shadows, Whites and Blacks, the Color Mixer, Dehaze, Vibrance, Point Color and Color Grading. It shows when you let go of a slider, not while you drag.'
    ),
    tip: tk('Turn it down only if you want each pixel to follow an adjustment exactly.')
  },

  // ── Presence's colour sliders ─────────────────────────────────────
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

  // ── Curves (Custom is the tone curve) ─────────────────────────────
  'curve.region': {
    what: tk('Bends the curve in four broad ranges without placing points.'),
    expect: tk('Smooth, safe changes that never cross over.')
  },
  'curve.point': {
    what: tk('Places points on the curve itself, for all channels or red, green and blue alone.'),
    expect: tk(
      'Lifting blue in the shadows and cutting it in the highlights gives a cross-processed look.'
    ),
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

  'detail.ai.sharpen': {
    what: tk(
      'PIXL Enhance, our own model, sharpens what is soft from slight shake, missed focus or the lens, and takes out noise and compression damage on the way.'
    ),
    expect: tk(
      'It restores what the photo holds and invents no detail. It runs once, in the background, and is kept with the photo: the sliders above still work on top, and unticking takes it away.'
    ),
    tip: tk('Judge it at 100% (Z). It includes AI noise reduction and clean up.')
  },
  'detail.ai.noise': {
    what: tk(
      'Our model removes the noise once, in the background, and keeps the result with the photo.'
    ),
    expect: tk(
      'Much cleaner than the sliders at high ISO, with texture kept. Undo, redo and History never run it again; unticking takes it away.'
    ),
    tip: tk('A RAW that PIXL demosaic develops is already clean: it rarely needs this.')
  },
  'detail.clean': {
    what: tk(
      'Repairs the blocks, ringing and halos that compression and over-sharpening leave, as in photos saved from the web or messaging apps.'
    ),
    expect: tk('A clean photo comes back as it was.')
  },
  'detail.ai.clean': {
    what: tk('PIXL Enhance at its lightest: compression damage only, noise and softness left.'),
    expect: tk(
      'It runs once, in the background, and is kept with the photo; unticking takes it away.'
    )
  },
  'detail.rawDenoise': {
    what: tk(
      'Takes the grain out of the camera’s raw sensor data before it becomes a picture, with an AI model (PMRID) that reads how noisy this photo is by itself.'
    ),
    expect: tk(
      'Best on high-ISO shots. Fine texture such as bark or fabric can look a little crisper or flatter. It works on the full-size picture, so judge it at 100%; the export has it too. Most cameras only: not Fujifilm X-Trans.'
    )
  },
  'detail.ai.lossless': {
    what: tk('Keeps each AI result exactly, at about six times the size of near-lossless.'),
    expect: tk(
      'Near-lossless (the default) cannot be told apart, but leaves a little less room for very strong exposure or shadow pushes.'
    )
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
    expect: tk(
      'Auto picks the most the lines support. The crop then fits the corrected picture; Transform adds to it.'
    ),
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
  primaries: {
    what: tk(
      'DaVinci Resolve’s primary correction. Lift moves the blacks, Gamma the midtones, Gain the whites, Offset everything alike; each wheel’s disc sets its colour, the ring under it its brightness.'
    ),
    expect: tk(
      'The numbers are Resolve’s: Y for all three channels, then R, G and B. Contrast turns about the Pivot; Sat and Hue are at 50 untouched.'
    ),
    tip: tk(
      'Balance with Offset first, then shape with Lift, Gamma and Gain while watching the parade. Shift makes any drag finer; double-click a wheel’s name to reset it.'
    )
  },
  logwheels: {
    what: tk(
      'DaVinci Resolve’s Log wheels: Shadow, Midtone and Highlight each move only their part of the tones, Offset all of them. Low and High range say where the parts meet.'
    ),
    expect: tk('Small, contained moves: warming only the shadows, cooling only the highlights.'),
    tip: tk(
      'Use them after the Primaries, for the finer split. They grade in log, as Resolve’s do, so a push is the same number of stops however bright the tone.'
    )
  },
  qualifier: {
    what: tk(
      'DaVinci Resolve’s qualifier: pick a colour in the photo and the correction here (Gain, Sat, Hue) changes only what is like it, by hue, saturation and luminance.'
    ),
    expect: tk(
      'Key shows what it selects, white on black. Widen a band or soften its edge until the key is clean, then correct.'
    ),
    tip: tk('Blur smooths a noisy key; Invert corrects everything except the colour.')
  },
  curve: {
    what: tk(
      'DaVinci Resolve’s curves. Custom is the tone curve (Y, R, G, B); the others change one thing by another: Hue vs Hue turns a colour, Hue vs Lum brightens or darkens it, and Hue vs Sat, Lum vs Sat and Sat vs Sat make colours richer or quieter by hue, brightness or saturation.'
    ),
    expect: tk('The line in the middle changes nothing. Click it to add a point, then drag.'),
    tip: tk(
      'On a hue curve, the colour dots add three points at that hue: drag the middle one to change only that colour.'
    )
  },
  // ── Resolve: Primaries ─────────────────────────────────────────────
  'primaries.lift': {
    what: tk(
      'Lift raises or lowers the blacks. White stays where it is, and everything between moves less the brighter it is. Its disc tints the shadows.'
    ),
    expect: tk(
      'The ring to the right lifts the blacks toward a faded, matte look; to the left deepens them. Push the disc away from a cast in the shadows to make them neutral.'
    ),
    tip: tk('Watch the bottom of the parade: neutral shadows put red, green and blue level.')
  },
  'primaries.gamma': {
    what: tk(
      'Gamma bends the midtones: black and white stay put, the middle gets brighter or darker. Its disc tints the midtones.'
    ),
    expect: tk(
      'The gentlest way to change brightness or colour, because the ends do not move: skin, foliage and walls live here.'
    ),
    tip: tk('Most colour balance is done on Gamma; small numbers go a long way.')
  },
  'primaries.gain': {
    what: tk(
      'Gain scales everything toward white: black stays put and the brightest parts move the most. Its disc tints the highlights.'
    ),
    expect: tk('The ring to the right brightens (watch the highlights clip), to the left dims.'),
    tip: tk('Neutralise a cast in the whites here, checking the top of the parade.')
  },
  'primaries.offset': {
    what: tk(
      'Offset adds the same amount to every value: shadows, midtones and highlights move together, so the whole picture shifts in brightness or colour.'
    ),
    expect: tk('Shown about 25, as Resolve shows it: above 25 brighter, below darker.'),
    tip: tk(
      'Balance the colour here first, like a white balance, then shape with Lift, Gamma and Gain.'
    )
  },
  'primaries.contrast': {
    what: tk('Spreads the values apart from the Pivot (above 1) or draws them together (below 1).'),
    expect: tk('Darks get darker and brights brighter about the pivot; 1.000 changes nothing.')
  },
  'primaries.pivot': {
    what: tk('The brightness Contrast turns about: a value at the pivot does not move.'),
    expect: tk(
      'A lower pivot makes added contrast brighten the picture overall; a higher one darkens it.'
    ),
    tip: tk('0.435, Resolve’s default, is about middle grey.')
  },
  'primaries.sat': {
    what: tk('How colourful everything is: 50 untouched, 0 grey, 100 twice the colour.'),
    expect: tk('Every colour alike, unlike Vibrance, which spares what is already rich.')
  },
  'primaries.hue': {
    what: tk(
      'Turns every colour around the colour wheel together: 50 untouched, 0 and 100 half a turn either way.'
    ),
    expect: tk('Small moves shift the whole palette; big ones are an effect.')
  },
  'primaries.temp': {
    what: tk('Warmer or cooler, on top of the white balance.'),
    expect: tk(
      'Like Resolve’s Temp: a gain on the graded colour, beside the Primaries, that keeps greys as bright as they were. On a black-and-white photo it tones the grey.'
    )
  },
  'primaries.tint': {
    what: tk('Toward magenta or toward green, on top of the white balance.'),
    expect: tk('For the green of fluorescent light, or a magenta cast.')
  },
  'primaries.lumMix': {
    what: tk(
      'How much the Y rings of Lift, Gamma and Gain change brightness alone. At 0 they move red, green and blue alike; at 100 they keep every colour’s hue and saturation.'
    ),
    expect: tk(
      'At 0 a lifted black fades the colour too, the matte look; higher keeps the shadows’ colour as you lift them. 0 is how every photo was made; Resolve starts at 100.'
    )
  },

  // ── Resolve: Log wheels ────────────────────────────────────────────
  'log.shadow': {
    what: tk('Adds colour or brightness only to the tones below Low range.'),
    expect: tk('Contained: the midtones and highlights do not move.')
  },
  'log.midtone': {
    what: tk('Adds colour or brightness only between Low and High range.'),
    expect: tk('A warmer or cooler middle with the ends left alone.')
  },
  'log.highlight': {
    what: tk('Adds colour or brightness only above High range.'),
    expect: tk('Cool skies or warm lamps without touching the shadows.')
  },
  'log.offset': {
    what: tk('Adds the same colour or brightness to every tone.'),
    expect: tk(
      'In log an offset is an exposure: every tone moves by the same number of stops, so a balance set here holds from the shadows to the highlights.'
    )
  },
  'log.low': {
    what: tk('Where the shadows end: the Shadow wheel works below it, the Midtone wheel above.'),
    expect: tk('Higher gives the Shadow wheel more of the picture.'),
    tip: tk(
      '0.268 sits about a stop and a half under middle grey, where Resolve’s 0.333 sits in ACEScct.'
    )
  },
  'log.high': {
    what: tk('Where the highlights begin: the Highlight wheel works above it.'),
    expect: tk('Lower gives the Highlight wheel more of the picture.'),
    tip: tk(
      '0.660 sits just under white, where Resolve’s 0.550 sits in ACEScct: the Highlight wheel takes the brightest parts. Lower it to reach the bright midtones too.'
    )
  },

  // ── Resolve: Curves ────────────────────────────────────────────────
  'rcurves.custom': {
    what: tk(
      'The tone curve: input brightness along the bottom, output up the side. Y moves all three channels, R, G and B one each.'
    ),
    expect: tk('An S makes contrast; lifting the bottom-left end fades the blacks.')
  },
  'rcurves.hueHue': {
    what: tk(
      'Turns one colour into another: points along the hues, and pulling one up or down turns that hue around the wheel.'
    ),
    expect: tk('Greens toward teal, oranges toward red, without touching the rest.')
  },
  'rcurves.hueSat': {
    what: tk('Makes one colour richer or quieter: up for more saturation, down for less.'),
    expect: tk('Quiet a loud green, deepen a sky.')
  },
  'rcurves.hueLum': {
    what: tk('Makes one colour brighter or darker: up to a stop either way at the top and bottom.'),
    expect: tk(
      'Darken a sky or brighten skin without touching greys. It finds a colour by the hue it had before Hue vs Hue turned it.'
    )
  },
  'rcurves.lumSat': {
    what: tk('Saturation by brightness: shadows along the left, highlights along the right.'),
    expect: tk('Pull the ends down for clean blacks and whites without colour noise.')
  },
  'rcurves.satSat': {
    what: tk(
      'Saturation by saturation: lift the dull colours without pushing the already rich ones.'
    ),
    expect: tk(
      'Greys along the left, the richest colours along the right; up for more, down for less. Pull the right end down to tame colours that are already loud.'
    )
  },

  // ── Resolve: Qualifier ─────────────────────────────────────────────
  'qualifier.hue': {
    what: tk('Which hues the key takes: its centre on the strip, its width, and its soft edge.'),
    expect: tk('Off, every hue counts and the key goes by saturation and luminance alone.')
  },
  'qualifier.sat': {
    what: tk('How saturated a colour must be to be keyed: from grey on the left to full colour.'),
    expect: tk('Raise the centre to leave out greys and pale versions of the colour.')
  },
  'qualifier.lum': {
    what: tk('How bright a colour must be to be keyed: from black on the left to white.'),
    expect: tk('Narrow it to take only the sunlit or only the shaded part.')
  },
  'qualifier.blur': {
    what: tk('Softens the key’s edge, so a correction blends in rather than cutting out.'),
    expect: tk('Raise it when Key shows speckle or a hard edge.')
  },
  'qualifier.correction': {
    what: tk(
      'What the key lets through: Gain brightens or tints what it selects, Sat and Hue change its colour (50 untouched).'
    ),
    expect: tk('Only the white of the key changes; the black stays as it was.')
  },
  calibration: {
    what: tk('Shifts how the camera’s red, green and blue primaries are read.'),
    expect: tk('Broad, subtle colour changes across the whole palette.'),
    tip: tk('Blue primary saturation up is a well-known trick for richer, cleaner colour.')
  },

  // ── Enhance ────────────────────────────────────────────────────────
  enhance: {
    what: tk('Makes the photo larger, ×2 or ×4, with a model that adds believable detail.'),
    expect: tk('It runs once and is kept with the photo; undo takes it away.'),
    tip: tk('AI sharpening, noise reduction and clean up are in Detail.')
  },

  'enhance.upscale': {
    what: tk('Makes the photo larger with a model that adds believable detail.'),
    expect: tk(
      '×2 is a safe default; ×4 makes very large files. Source picks the model: Clean stays closest to a sharp original, Damaged repairs a compressed or noisy one as it enlarges, Keep texture leaves its grain.'
    )
  }
} satisfies Record<string, Tip>

export type TipId = keyof typeof TIPS
