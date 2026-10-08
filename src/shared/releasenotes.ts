/**
 * What each release brings, said to the people who use it: shown once after
 * an update, in the What's new popup (views/WhatsNew.tsx), and again from
 * Settings → Updates. Newest first. A release's notes are written before it
 * is cut and are shown only by builds of that version or newer. Pure, for
 * tests/releasenotes.test.ts; main/whatsnew.ts remembers what was shown.
 */
import { compareVersions } from './policy'

export interface ReleaseNotes {
  version: string
  /** One line under the title. */
  headline: string
  sections: { title: string; items: string[] }[]
  /** What is on its way, said last. */
  next?: { title: string; text: string }[]
}

export const RELEASE_NOTES: ReleaseNotes[] = [
  // Draft (engine 0.18's half): 0.4.0-beta ships with engine 0.19 as well,
  // whose notes join these before it is cut (TODO.md, Phase N and after).
  {
    version: '0.4.0-beta',
    headline: 'A cleaner Dehaze, smoother colour, and noise reduction that matches your export.',
    sections: [
      {
        title: 'Dials',
        items: [
          'Dehaze has been rebuilt. It brings back local contrast where the air is hazy and keeps each area’s brightness and colour, instead of darkening and tinting the whole picture. The same value looks gentler on brightness and colour and stronger on detail; for the old, denser result add some Contrast or a Tone Curve. Negative Dehaze is unchanged.',
          'The Color Mixer’s Luminance sliders feel even across their range: all the way down darkens a colour strongly but no longer turns it black, so skies keep their tone.',
          'A new Smoothing slider, under Dehaze, keeps colour and tone changes smooth across sea, sky and skin, so they don’t go blotchy or show a JPEG’s blocks. It shows when you let go of a slider. Photos you edited before start with it off, so they look as they did.'
        ]
      },
      {
        title: 'Detail',
        items: [
          'Noise Reduction looks the same in the preview, at 100% and in the exported file. Exports of noisy photos are cleaner than before at the same settings, most in bright, even areas such as walls and skies.',
          'RAW sharpening now sharpens edges and leaves flat areas alone. When sharpening is too fine to show at the current zoom, the Sharpening panel says so.'
        ]
      },
      {
        title: 'Masks',
        items: [
          'Depth range: select by distance. Playroom maps the photo’s depth once (a small model you download the first time); click the photo to take what is at that distance, then set Near, Far and Softness, with the depth map in the card.',
          'Small objects picked with Objects keep their mask instead of fading out.'
        ]
      },
      {
        title: 'Changes',
        items: [
          'Super Resolution has a Source choice: Clean stays closest to a sharp original, with a new, much faster model; Damaged repairs compression and noise as it enlarges; Keep texture leaves the grain.',
          'Retired AI models are removed from your disk, and so is the before-and-after with the previous engine from 0.3.',
          'If an adjustment ever breaks the picture, the slider responsible turns red and says so; your edit is kept.',
          'AI work runs on your Mac’s performance cores, where it is fastest.'
        ]
      }
    ]
  },
  {
    version: '0.3.0-beta',
    headline: 'PIXL’s own colour, a clearer way to export, and scopes at full size.',
    sections: [
      {
        title: 'Colour',
        items: [
          'The engine now works in PixlRGB, PIXL’s own wide working space.',
          'Edits that act on the colour channels themselves (curves, colour mixing, per-channel gain, HSL) can look a little different. Open any photo you edited before to see it before and after; remove the old previews whenever you like.',
          'HDR exports use the engine’s own tone mapping, gamut compression and gain maps.',
          'RAW files use PIXL’s own camera colour for the 46 bodies it knows (the others keep the file’s own). RAWs you edited before can shift a little, and heals, denoise and enhance made on the old colour are marked, because their pixels moved. Your white balance keeps its look. Switch any photo back under Colour in the develop panel.'
        ]
      },
      {
        title: 'Export',
        items: [
          'Export in four steps: Format, Size & colour, Metadata & HDR, and Review, built from the editor’s own cards and sliders.',
          'Review shows the first photo as it will be exported, and what would go wrong before it does: a setting that cannot work, a folder that cannot be written, a full disk, files that would be replaced.',
          'Fit a photo inside a width and height, and read what each rendering intent does next to the choice.'
        ]
      },
      {
        title: 'Scopes',
        items: [
          'The histogram and the colour chart open at full size: overlay, parade, one channel or luma, with the before picture behind and HDR in stops.',
          'A CIE 1976 chart with PixlRGB and the gamuts you compare it to.',
          'Metrics before and after (range, contrast, clipping, colour cast), the photo’s dominant colours with their values, and how it reads with a colour-vision deficiency.'
        ]
      },
      {
        title: 'Masks',
        items: [
          'Object detection has its own button beside the brush, gradients and lasso.',
          'A mask’s edge is one crisp line at any zoom.',
          'The pins over the photo are gone; gradient and lasso handles show when the pointer is over the photo.'
        ]
      },
      {
        title: 'Changes',
        items: [
          'HEIC export is replaced by AVIF (HEIC files still open).',
          'Select Subject is moving to one smaller model (U²-Netp). If you already have U²-Net or the exact JPEG repair, they are listed under AI models as being retired: U²-Net keeps making Subject and Background masks until the next update, and either can be removed to free the space.'
        ]
      }
    ],
    next: [
      {
        title: 'Better models',
        text: 'Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.'
      },
      {
        title: 'Smart looks, reimagined',
        text: 'Looks that understand more of the photo and adjust each part on its own.'
      },
      {
        title: 'An MCP server for the editor',
        text: 'Let an AI assistant work in Playroom with you, on your own computer.'
      },
      { title: 'And much more', text: 'This is a beta: there is a lot more on the way.' }
    ]
  },
  {
    version: '0.2.0-beta',
    headline: 'Looks, a new way to make masks, and a new RAW engine.',
    sections: [
      {
        title: 'Looks',
        items: [
          'Over 300 looks, from film stocks and cinema to camera makers’ own, browsed on your photo with live previews, search and shelves.',
          'Hover a look to see it on the photo, then dial it in with Amount. Clicking another swaps it.',
          'Smart looks find the subject, the sky or an object and adjust just that part.',
          'Save your own looks with their masks and AI steps: they are made again on every photo you use them on.'
        ]
      },
      {
        title: 'Masks',
        items: [
          'Objects: point at anything and Playroom selects it. Hover and click, draw a box or scribble over it; Shift adds a part, Alt takes one away.',
          'The sky in a click, and a lasso that finds the object inside it.',
          'Snap to edges for brushes, lassos and AI masks, and crisper Subject and Background edges.',
          'A bidirectional gradient, and gradients that stay exact at any size.',
          'A clearer masks panel, and Molten glass draws a solid line along sharp edges.'
        ]
      },
      {
        title: 'Develop',
        items: [
          'A new RAW engine (LibRaw): more cameras, and RAW files that would not open before are tried again.',
          'Sharp 1:1 zoom on straightened, cropped and lens-corrected photos.',
          'Defish fisheye lenses with their lens profiles.',
          'Faster RAW previews, using a third of the memory on large files.',
          'New sliders: drag the bar, click the value to type one, double-click to reset.'
        ]
      }
    ],
    next: [
      {
        title: 'Better models',
        text: 'Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.'
      },
      {
        title: 'Our own colour science',
        text: 'Colour from PIXL’s own science, from the sensor to your screen.'
      },
      { title: 'And much more', text: 'This is a beta: there is a lot more on the way.' }
    ]
  }
]

/**
 * The notes to show at launch, newest first: those newer than the last
 * seen and no newer than this build. None seen yet: on an install from
 * before the popup (`hadInstall`) the newest, on a fresh one nothing.
 */
export function notesToShow(
  current: string,
  seen: string | null,
  hadInstall: boolean,
  notes: ReleaseNotes[] = RELEASE_NOTES
): ReleaseNotes[] {
  const built = notes.filter((n) => compareVersions(n.version, current) <= 0)
  if (seen) return built.filter((n) => compareVersions(n.version, seen) > 0)
  return hadInstall ? built.slice(0, 1) : []
}

/** This build's notes (Settings → What's new): the newest no newer than it. */
export function latestNotes(
  current: string,
  notes: ReleaseNotes[] = RELEASE_NOTES
): ReleaseNotes | null {
  return notes.find((n) => compareVersions(n.version, current) <= 0) ?? null
}

/** A version as people read it: 0.2.0-beta → 0.2.0 beta, 0.2.0-beta.3 → 0.2.0 beta 3. */
export function versionLabel(v: string): string {
  return v.replace(/-beta(?:\.(\d+))?$/, (_, n?: string) => (n ? ` beta ${n}` : ' beta'))
}
