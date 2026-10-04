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
  {
    version: '0.3.0-beta',
    headline: 'PIXL’s own colour engine, and a clearer way to export.',
    sections: [
      {
        title: 'Colour',
        items: [
          'The engine now works in PixlRGB, PIXL’s own wide working space.',
          'Edits that act on the colour channels themselves (curves, colour mixing, per-channel gain, HSL) can look a little different. Open any photo you edited before to see it before and after; remove the old previews whenever you like.',
          'HDR exports use the engine’s own tone mapping, gamut compression and gain maps.'
        ]
      },
      {
        title: 'Changes',
        items: [
          'HEIC export is replaced by AVIF (HEIC files still open).',
          'Select Subject uses one model now (U²-Netp); JPEG restore keeps the automatic mode.'
        ]
      }
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
