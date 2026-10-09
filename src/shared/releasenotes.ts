/**
 * What each release brings, said to the people who use it: shown once after
 * an update, in the What's new popup (views/WhatsNew.tsx), and again from
 * Settings → Updates. Newest first. A release's notes are written before it
 * is cut and are shown only by builds of that version or newer. Pure, for
 * tests/releasenotes.test.ts; main/whatsnew.ts remembers what was shown.
 */
import { compareVersions } from './policy'
import { tk } from './i18n'

export interface ReleaseNotes {
  version: string
  /** One line under the title. */
  headline: string
  sections: { title: string; items: string[] }[]
  /** What is on its way, said last. */
  next?: { title: string; text: string }[]
}

export const RELEASE_NOTES: ReleaseNotes[] = [
  // Engines 0.18 and 0.19 together (TODO.md Phases N and O). Gemma, its
  // llama.cpp server and SAM 3 are held out of this release (the owner).
  {
    version: '0.4.0-beta',
    headline: tk(
      'HDR while you edit, masks you can ask for by name, suggested rejects, and noise reduction that matches your export.'
    ),
    sections: [
      {
        title: 'HDR',
        items: [
          tk(
            'Full HDR, on the top bar: on a display with headroom, such as a MacBook Pro’s or an HDR monitor, the photo shows its highlights brighter than white while you edit, as an HDR export holds them. The eyedropper, scopes and overlays still read the SDR picture.'
          ),
          tk(
            'Settings → Display says what Playroom reads from your screen, or lets you state its white and peak yourself.'
          ),
          tk(
            'RAW files keep their highlights: blown areas are rebuilt from the channels that still hold detail, and the brightest parts roll softly into white instead of clipping. RAWs you edited before are developed again the first time you open them.'
          )
        ]
      },
      {
        title: tk('Dials'),
        items: [
          tk(
            'Dehaze has been rebuilt. It brings back local contrast where the air is hazy and keeps each area’s brightness and colour, instead of darkening and tinting the whole picture. The same value looks gentler on brightness and colour and stronger on detail; for the old, denser result add some Contrast or a Tone Curve. Negative Dehaze is unchanged.'
          ),
          tk(
            'The Color Mixer’s Luminance sliders feel even across their range: all the way down darkens a colour strongly but no longer turns it black, so skies keep their tone.'
          ),
          tk(
            'A new Smoothing slider, under Dehaze, keeps colour and tone changes smooth across sea, sky and skin, so they don’t go blotchy or show a JPEG’s blocks. It shows when you let go of a slider. Photos you edited before start with it off, so they look as they did.'
          )
        ]
      },
      {
        title: tk('Detail'),
        items: [
          tk(
            'Noise Reduction looks the same in the preview, at 100% and in the exported file. Exports of noisy photos are cleaner than before at the same settings, most in bright, even areas such as walls and skies.'
          ),
          tk(
            'RAW sharpening now sharpens edges and leaves flat areas alone. When sharpening is too fine to show at the current zoom, the Sharpening panel says so.'
          ),
          tk(
            'RAWs are developed at full size with an AI model for crisper fine detail and fewer colour fringes, at 100%, for AI tools and in the export. The model (2 MB) downloads by itself; without it, a better classic method than before is used. Fujifilm X-Trans gets its own the first time you open one.'
          ),
          tk(
            'Denoise the RAW data, under Noise reduction → AI: an AI model takes the grain out of a RAW’s sensor data before it becomes a picture, measuring each photo’s noise by itself. Off unless you turn it on; it shows at 100% and in the export.'
          )
        ]
      },
      {
        title: tk('Masks'),
        items: [
          tk(
            'Depth range: select by distance. Playroom maps the photo’s depth once (a small model you download the first time); click the photo to take what is at that distance, then set Near, Far and Softness, with the depth map in the card.'
          ),
          tk(
            'Fine subject: a finer cut-out that keeps hair, fur and feathers (a larger model, downloaded when you first use it; about ten seconds a photo).'
          ),
          tk(
            'Sky in one click, found by a model instead of a click on the sky, and two new ones beside it: Vegetation (trees, grass, plants) and Water (sea, lakes, rivers).'
          ),
          tk(
            'People: Face, Hair, Skin and Clothes in one click each, found by a small model. They work best when the person fills a good part of the frame.'
          ),
          tk(
            'Find by name: type what you want masked (“red car”, “the trees”) at the top of the New mask menu, and every one in the photo is found (a 385 MB model, downloaded when you first use it).'
          ),
          tk(
            'Eyes, Brows, Lips and Teeth in one click, outlined on every face in the photo, small faces in a group too. With several faces, pick one under the mask. Brows are rough for now.'
          ),
          tk('Small objects picked with Objects keep their mask instead of fading out.'),
          tk(
            'The masks panel sits in the left pane, beside your presets and history, instead of floating over the photo.'
          )
        ]
      },
      {
        title: tk('Library'),
        items: [
          tk(
            'Suggested rejects: photos that look like rejects (a soft frame in a burst, a subject softer than its background, too dark or too bright, closed eyes, a duplicate) show dimmed and grey. Hover one for why, then Keep or Reject it; Filters → Suggested rejects only lists them, and Reject all flags them in one go. Nothing is ever deleted, a star or a pick means a photo is never suggested, and what you keep and reject tunes the suggestions. Measured on your computer while it is idle and plugged in; Settings → Projects & interface turns it off.'
          )
        ]
      },
      {
        title: tk('Heal'),
        items: [
          tk(
            'Remove: paint over something, or click it with Find object, and an AI model fills it with what was likely behind it — people, signs, wires. It is baked into the photo like your other heal strokes.'
          )
        ]
      },
      {
        title: tk('Changes'),
        items: [
          tk(
            'Super Resolution has a Source choice: Clean stays closest to a sharp original, with a new, much faster model; Damaged repairs compression and noise as it enlarges; Keep texture leaves the grain.'
          ),
          tk(
            'Retired AI models are removed from your disk, and so is the before-and-after with the previous engine from 0.3.'
          ),
          tk(
            'If an adjustment ever breaks the picture, the slider responsible turns red and says so; your edit is kept.'
          ),
          tk('AI work runs on your Mac’s performance cores, where it is fastest.'),
          tk(
            'Work running in the background (AI jobs, exports, model downloads) shows on the top bar with how far it has come; click it to see the queue, go to a photo or stop a job.'
          ),
          tk(
            'Settings → AI models → Use AI models turns every AI model off at once (RAW files still develop with theirs).'
          ),
          tk(
            'While Playroom is minimised or another app is in front, it lets its engine rest and draws flat, still panels, which is lighter on the battery and frees memory; the top bar says Engine offline, in yellow, until you come back. Settings → Interface → Always flat keeps the flat look all the time.'
          ),
          tk(
            'Settings opens wide, in sections across the top like Export: General, Projects & interface, Display, AI models, Key bindings, and Privacy & about.'
          ),
          tk(
            'Work in the background no longer slows the app: opening a large folder, masks and the HDR preview keep their pixel work off the window’s thread.'
          )
        ]
      },
      {
        title: tk('Local AI, honestly'),
        items: [
          tk(
            'We tried a local language model inside Playroom, one that would look at your photos and name what is in them so a mask is a tap away, all on your own computer. It works, but today it needs 3 to 4 GB of memory and 10 to 20 seconds a photo on a fast Mac, and more on an older one. That is too heavy to switch on for everyone, so it is not in this release.'
          ),
          tk(
            'We are still working out how a local model best fits your workflow without slowing your computer down: when it should run, how much it may use, and what is worth its time. Until we have that right, every AI tool in Playroom is a small, focused model that does one job quickly, and Settings → AI models turns them all off at once.'
          )
        ]
      }
    ],
    next: [
      {
        title: tk('Our own language models'),
        text: tk(
          'Small models of our own, made to understand photos and editing, light enough for a laptop.'
        )
      },
      {
        title: 'MCP',
        text: tk(
          'Let an AI assistant you already use work in Playroom with you, on your own computer, through an MCP server.'
        )
      },
      {
        title: tk('More of the tools you know'),
        text: tk('Features you would reach for in Photoshop or Lightroom, the PIXL way.')
      },
      {
        title: tk('Faster, again'),
        text: tk(
          'The next engine brings its own speed-ups, and we keep making Playroom lighter on your computer.'
        )
      },
      { title: tk('And a cookie'), text: tk('For reading this far. 🍪') }
    ]
  },
  {
    version: '0.3.0-beta',
    headline: tk('PIXL’s own colour, a clearer way to export, and scopes at full size.'),
    sections: [
      {
        title: tk('Colour'),
        items: [
          tk('The engine now works in PixlRGB, PIXL’s own wide working space.'),
          tk(
            'Edits that act on the colour channels themselves (curves, colour mixing, per-channel gain, HSL) can look a little different. Open any photo you edited before to see it before and after; remove the old previews whenever you like.'
          ),
          tk('HDR exports use the engine’s own tone mapping, gamut compression and gain maps.'),
          tk(
            'RAW files use PIXL’s own camera colour for the 46 bodies it knows (the others keep the file’s own). RAWs you edited before can shift a little, and heals, denoise and enhance made on the old colour are marked, because their pixels moved. Your white balance keeps its look. Switch any photo back under Colour in the develop panel.'
          )
        ]
      },
      {
        title: tk('Export'),
        items: [
          tk(
            'Export in four steps: Format, Size & colour, Metadata & HDR, and Review, built from the editor’s own cards and sliders.'
          ),
          tk(
            'Review shows the first photo as it will be exported, and what would go wrong before it does: a setting that cannot work, a folder that cannot be written, a full disk, files that would be replaced.'
          ),
          tk(
            'Fit a photo inside a width and height, and read what each rendering intent does next to the choice.'
          )
        ]
      },
      {
        title: tk('Scopes'),
        items: [
          tk(
            'The histogram and the colour chart open at full size: overlay, parade, one channel or luma, with the before picture behind and HDR in stops.'
          ),
          tk('A CIE 1976 chart with PixlRGB and the gamuts you compare it to.'),
          tk(
            'Metrics before and after (range, contrast, clipping, colour cast), the photo’s dominant colours with their values, and how it reads with a colour-vision deficiency.'
          )
        ]
      },
      {
        title: tk('Masks'),
        items: [
          tk('Object detection has its own button beside the brush, gradients and lasso.'),
          tk('A mask’s edge is one crisp line at any zoom.'),
          tk(
            'The pins over the photo are gone; gradient and lasso handles show when the pointer is over the photo.'
          )
        ]
      },
      {
        title: tk('Changes'),
        items: [
          tk('HEIC export is replaced by AVIF (HEIC files still open).'),
          tk(
            'Select Subject is moving to one smaller model (U²-Netp). If you already have U²-Net or the exact JPEG repair, they are listed under AI models as being retired: U²-Net keeps making Subject and Background masks until the next update, and either can be removed to free the space.'
          )
        ]
      }
    ],
    next: [
      {
        title: tk('Better models'),
        text: tk(
          'Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.'
        )
      },
      {
        title: tk('Smart looks, reimagined'),
        text: tk('Looks that understand more of the photo and adjust each part on its own.')
      },
      {
        title: tk('An MCP server for the editor'),
        text: tk('Let an AI assistant work in Playroom with you, on your own computer.')
      },
      { title: tk('And much more'), text: tk('This is a beta: there is a lot more on the way.') }
    ]
  },
  {
    version: '0.2.0-beta',
    headline: tk('Looks, a new way to make masks, and a new RAW engine.'),
    sections: [
      {
        title: tk('Looks'),
        items: [
          tk(
            'Over 300 looks, from film stocks and cinema to camera makers’ own, browsed on your photo with live previews, search and shelves.'
          ),
          tk(
            'Hover a look to see it on the photo, then dial it in with Amount. Clicking another swaps it.'
          ),
          tk('Smart looks find the subject, the sky or an object and adjust just that part.'),
          tk(
            'Save your own looks with their masks and AI steps: they are made again on every photo you use them on.'
          )
        ]
      },
      {
        title: tk('Masks'),
        items: [
          tk(
            'Objects: point at anything and Playroom selects it. Hover and click, draw a box or scribble over it; Shift adds a part, Alt takes one away.'
          ),
          tk('The sky in a click, and a lasso that finds the object inside it.'),
          tk(
            'Snap to edges for brushes, lassos and AI masks, and crisper Subject and Background edges.'
          ),
          tk('A bidirectional gradient, and gradients that stay exact at any size.'),
          tk('A clearer masks panel, and Molten glass draws a solid line along sharp edges.')
        ]
      },
      {
        title: tk('Develop'),
        items: [
          tk(
            'A new RAW engine (LibRaw): more cameras, and RAW files that would not open before are tried again.'
          ),
          tk('Sharp 1:1 zoom on straightened, cropped and lens-corrected photos.'),
          tk('Defish fisheye lenses with their lens profiles.'),
          tk('Faster RAW previews, using a third of the memory on large files.'),
          tk('New sliders: drag the bar, click the value to type one, double-click to reset.')
        ]
      }
    ],
    next: [
      {
        title: tk('Better models'),
        text: tk(
          'Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.'
        )
      },
      {
        title: tk('Our own colour science'),
        text: tk('Colour from PIXL’s own science, from the sensor to your screen.')
      },
      { title: tk('And much more'), text: tk('This is a beta: there is a lot more on the way.') }
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

/**
 * A release's notes as Markdown: the release feed's `releaseNotes`
 * (electron-builder `releaseInfo.releaseNotesFile`, written by
 * scripts/release-notes.mjs) and the GitHub release's body. An installed
 * build reads it back with `parseReleaseNotes` to show what an update
 * brings before it is installed.
 */
export function releaseNotesMarkdown(n: ReleaseNotes): string {
  const lines = [n.headline, '']
  for (const s of n.sections) {
    lines.push(`## ${s.title}`, '')
    for (const item of s.items) lines.push(`- ${item}`)
    lines.push('')
  }
  if (n.next?.length) {
    lines.push('## Coming soon', '')
    for (const x of n.next) lines.push(`- **${x.title}**: ${x.text}`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * The feed's notes read back: Markdown as `releaseNotesMarkdown` writes it
 * (a headline, `## ` sections of `- ` items, "Coming soon" last), or, from
 * a feed that holds something else, its text as one section. electron-updater
 * hands over a string, a list of `{ version, note }`, or nothing.
 */
export function parseReleaseNotes(raw: unknown, version: string): ReleaseNotes | null {
  const text = Array.isArray(raw)
    ? (raw as { version?: string; note?: string | null }[])
        .filter((r) => !r.version || r.version === version)
        .map((r) => r.note ?? '')
        .join('\n\n')
    : typeof raw === 'string'
      ? raw
      : ''
  // Some feeds (GitHub's) carry HTML: its text is enough to read.
  const plain = text
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<h\d>/gi, '## ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
  if (!plain) return null
  const notes: ReleaseNotes = { version, headline: '', sections: [] }
  let section: { title: string; items: string[] } | null = null
  let coming = false
  for (const raw of plain.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const h = /^#{1,3}\s+(.*)$/.exec(line)
    if (h) {
      coming = /^coming soon$/i.test(h[1].trim())
      section = coming ? null : { title: h[1].trim(), items: [] }
      if (section) notes.sections.push(section)
      continue
    }
    const item = /^[-*]\s+(.*)$/.exec(line)
    if (item && coming) {
      const m = /^\*\*(.+?)\*\*:?\s*(.*)$/.exec(item[1])
      ;(notes.next ??= []).push(m ? { title: m[1], text: m[2] } : { title: item[1], text: '' })
      continue
    }
    if (item) {
      if (!section) notes.sections.push((section = { title: tk('What’s new'), items: [] }))
      section.items.push(item[1])
      continue
    }
    if (!notes.headline && !section) notes.headline = line
    else if (section) section.items.push(line)
    else notes.headline += ` ${line}`
  }
  return notes
}
