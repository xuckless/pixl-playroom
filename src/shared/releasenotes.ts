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
  // Engine 0.21.0 (TODO.md Phase P): one set of colour tools on the engine's
  // exact ops, film effects, cancellable RAW develops, the engine's scopes,
  // masks that follow geometry, the security audit (branch feat/engine-0.21).
  {
    version: '0.6.0-beta',
    headline: tk(
      'One set of colour tools, film that glows, RAWs that stop when you walk away, and masks that finally stay where you put them.'
    ),
    sections: [
      {
        title: tk('One set of colour tools'),
        items: [
          tk(
            'The Lightroom or Resolve switch is gone. There’s one set now, Playroom’s, and it does everything the Lightroom set did. Nobody has to pick a side at dinner any more.'
          ),
          tk(
            'The tone curve moved into Curves, region sliders and all. HSL has Point colour back, and Add colour sits under the Primaries’ wheels.'
          ),
          tk(
            'Lightroom’s Colour grading wheels only show on a photo that already uses them. They still work there; reset them and they bow out politely.'
          ),
          tk(
            'Every built-in look was rebuilt on the new tools. They look the same (about ΔE 1 on average, which is squinting territory), and a few gained a gentler roll-off in the highlights.'
          )
        ]
      },
      {
        title: tk('Colour, exactly'),
        items: [
          tk(
            'Hue vs Lum and Sat vs Sat work. Curves you drew while they waited start to show, so a photo or two may look a little different the first time you open it. That’s them, finally doing their job.'
          ),
          tk(
            'The Log wheels are the real thing now: graded in log, as Resolve’s are, with Low and High range where Resolve puts them. Edits that used them change, more than a little; they were an approximation, and the card said so.'
          ),
          tk(
            'Temp and Tint in the Primaries sit beside the wheels, a gain on the graded colour that keeps greys as bright as they were, instead of a second white balance. On a black-and-white photo they tone it.'
          ),
          tk(
            'Lum Mix, Resolve’s, beside Temp and Tint: raise it and the Y rings brighten or darken without touching the colour. It starts at 0, so nothing you made moves.'
          ),
          tk(
            'The tone curve’s region sliders can no longer fold the tones back, however hard you pull them in opposite directions.'
          ),
          tk(
            'Smoothing reaches Highlights, Shadows, Whites, Blacks and the Color Mixer again, now that the engine no longer paints white patches there. Edits with Smoothing on look a touch smoother in the shadows.'
          ),
          tk(
            'Saved edits take the new maths, and edited photos’ thumbnails are made again once so the library agrees with them.'
          )
        ]
      },
      {
        title: tk('Film, minus the chemicals'),
        items: [
          tk(
            'Halation, in Effects: the warm red glow film gets around bright lights, with its own Threshold, Size and Hue.'
          ),
          tk(
            'Bloom, right beside it: Diffusion softens the whole picture like a filter on the lens, Glow haloes just the lights.'
          ),
          tk(
            'Grain gained a Colour slider and a Response: Film (the midtones, as before), Even, or Scanned negative, strongest in the shadows.'
          ),
          tk(
            'HSL has a Density tab, for colours that feel thick and rich, as on slide film, rather than just louder.'
          ),
          tk(
            'The looks use all of it: twenty halation and bloom looks are the real thing now, colour negatives have colour grain, slide looks are denser, and three false-colour looks swap their colours the whole way.'
          )
        ]
      },
      {
        title: tk('RAWs, faster and more honest'),
        items: [
          tk(
            'Leave a photo while its RAW develops and the develop stops. Unless it’s about 70% done: then it finishes quietly, so coming back is instant.'
          ),
          tk(
            'The Developing RAW bar shows real progress and, once it knows, about how long is left. Enhance and AI Denoise show real progress too.'
          ),
          tk(
            'Zoom to 100% on a fresh RAW and it’s sharp in a second or two. Panning at 100% over a mask snapped to edges is several times quicker.'
          ),
          tk(
            'PIXL Enhance sees the detail in a RAW’s highlights around white instead of a flat plateau. And on a Mac the AI models start sooner: each is prepared for your chip once and kept.'
          ),
          tk(
            'Most RAWs our demosaic developed in 0.5.0 are developed once more when you open them. AI steps made on the old develop are marked, and Rebuild offers to make them again.'
          ),
          tk(
            'A RAW’s noise is never borrowed from another camera’s. If Playroom can’t tell, that photo takes the standard develop and says why.'
          ),
          tk(
            'A heal with Edge snap on a flat patch, with no edge to snap to, now heals anyway and tells you so, instead of quietly doing nothing.'
          )
        ]
      },
      {
        title: tk('Opening and browsing'),
        items: [
          tk(
            'A photo shows up the moment you open it, from the camera’s own preview, and melts into Playroom’s develop when that’s ready. An edited photo shows its thumbnail instead; the camera has no idea what you did.'
          ),
          tk(
            'Thumbnails are sharper and quicker, especially from Sony, Nikon and Fujifilm RAWs, whose full-size previews we now use.'
          ),
          tk('Large JPEGs open sooner.'),
          tk(
            'DNG camera profiles, in White balance: Adobe’s are found for you if you have Lightroom or the DNG Converter, and Import .dcp… takes your own. Only ones made for your camera are offered.'
          ),
          tk(
            'A third vignette style, Colour priority: the corners brighten without washing out to white.'
          ),
          tk('About names the exact engine build, for the curious and for bug reports.')
        ]
      },
      {
        title: tk('Scopes, now with fewer opinions'),
        items: [
          tk(
            'Let go of a slider and the scopes switch to the engine’s exact measurement of every pixel shown.'
          ),
          tk(
            'Every scope agrees on what brightness means (BT.709, as Resolve has it), so they’ve stopped arguing with each other.'
          ),
          tk('Metrics → Gamut coverage shows real numbers for how far the photo’s colours reach.'),
          tk(
            'Gamut warning (Shift+J), beside Clipping, paints green where the photo holds colours your export can’t. Soft proofing, part one.'
          )
        ]
      },
      {
        title: tk('Masks that stay put'),
        items: [
          tk(
            'Masks no longer drift under Upright or Transform: the overlay, the brush and Auto Mask follow the warp exactly.'
          ),
          tk(
            'No stale mask after a crop or a turn: you see the mask for the picture in front of you.'
          ),
          tk('Switch Crop & straighten or Geometry off and the masks stay where they belong.'),
          tk(
            'AI masks are found on the picture as you see it, so a click lands on what you clicked.'
          ),
          tk('Change the lens correction and the masks stay on their subject, in the export too.'),
          tk(
            'Strokes stay on their subject when you change the lens corrections or Upright, or switch Optics off, like every other mask. Painting into a mask a model found with Optics off lands where you paint, too.'
          )
        ]
      },
      {
        title: tk('Brushes, sharper'),
        items: [
          tk(
            'Brush strokes are vectors now, so a stroke is as crisp on a full-size export as it was on screen. Density says how strong a stroke is: scrubbing back and forth in one stroke adds nothing, a second stroke on top does. Flow has left the building. Brushes you painted before render as they always did.'
          ),
          tk(
            'Paint into a mask that already does something and the adjustment appears under the brush as you go, not just the overlay.'
          )
        ]
      },
      {
        title: tk('Safe and sound'),
        items: [
          tk(
            'A shared project or sidecar can’t read or write anything outside Playroom’s cache, and can’t send Playroom to a network share or a folder you haven’t added. Double-click away.'
          ),
          tk(
            'LUTs are found by name in Playroom’s LUT folder, so a project from another computer finds yours, and says when one is missing.'
          ),
          tk(
            'Updates are checked against Pixl’s own signature before they download. No signature, no update.'
          ),
          tk('Release builds ship without the developer tools. Those were for us.'),
          tk('Thumbnails that failed because of us, not your file, get another go.')
        ]
      }
    ],
    next: [
      {
        title: tk('Light above white, kept'),
        text: tk('PIXL Enhance keeping the highlights it makes, not only the ones it reads.')
      },
      {
        title: tk('Drags on the graphics chip'),
        text: tk(
          'The new colour tools and film effects on the graphics chip too, so slider drags fly again, once the engine can.'
        )
      },
      { title: tk('And yet another cookie'), text: tk('Three for three. Respect. 🍪🍪🍪') }
    ]
  },
  // Engine 0.20.0 (PIXL's own models), the Resolve colour tools and
  // scopes, History and Versions, the themes (branch feat/engine-dev-demosaic).
  {
    version: '0.5.0-beta',
    headline: tk(
      'Our own AI models, colour tools borrowed from Hollywood, scopes that actually scope, and a History you can read without a magnifying glass.'
    ),
    sections: [
      {
        title: tk('PIXL’s own models'),
        items: [
          tk(
            'PIXL demosaic: RAW files are now built by a model we trained ourselves, and it takes the grain out in the same step. Cleaner than anything Playroom used before, about 9 seconds for a 25 MP RAW on a Mac. It downloads by itself; Settings → AI models turns it off if you miss the old grain.'
          ),
          tk(
            'PIXL Enhance: our other model, for compression mush, noise and mild blur. It lives in Detail now, as a little AI box beside Sharpening, Noise reduction and the new Clean up artefacts. Tick one and it works quietly in the background; untick it and it’s gone. No Apply buttons, no ceremony.'
          ),
          tk(
            'The boxes stack sensibly: AI sharpening includes the noise reduction and the clean-up, so ticking it ticks the others for you. One step on the photo, never three fighting each other.'
          ),
          tk(
            'An HDR photo asks before AI touches it: the models work on its SDR picture, so we say so and switch it with your blessing instead of quietly flattening your highlights.'
          ),
          tk(
            'On a computer whose graphics chip can’t run them, Playroom asks once before using the processor, because a RAW then takes about 40 seconds and we’d rather you decide than find out. Change your mind in Settings → AI models.'
          ),
          tk(
            'When our demosaic can’t develop a photo and another one stands in, the photo says so, in the engine’s own words. No silent swaps.'
          ),
          tk('Enhance is now just Super resolution, which is what it was mostly for anyway.')
        ]
      },
      {
        title: tk('Colour like a colourist'),
        items: [
          tk(
            'Settings → Interface → Colour tools: Lightroom or Resolve. Pick Resolve and you get DaVinci Resolve’s way of grading in Playroom’s clothes: Lift, Gamma, Gain and Offset wheels with numbers you can type, Log wheels, Curves with Hue vs Hue, Hue vs Sat and Lum vs Sat, and a Qualifier that picks a colour and grades just that, inside a mask too.'
          ),
          tk(
            'The friendly Lightroom HSL sits right under the Primaries, because sometimes you just want the greens a bit less green.'
          ),
          tk(
            'Every Resolve control has an (i) that explains it in plain words. Nobody is born knowing what Pivot does.'
          ),
          tk(
            'A node view of your masks, for the brave: Settings → Interface → Node view (advanced). Off by default; it won’t ambush anyone.'
          ),
          tk(
            'Curves presets in both worlds: the tone curve’s Medium and Strong contrast are now as gentle as the ones you know from Lightroom (the old ones were about twice as strong, sorry), and Resolve’s curves have starting points like Even skin tones, Teal skies and Clean shadows.'
          ),
          tk(
            'The Essentials, Creative and B&W looks were rebuilt on the new colour tools. Same names, same spirit, better bones.'
          )
        ]
      },
      {
        title: tk('Scopes'),
        items: [
          tk(
            'Histogram, Colours, Waveform, RGB Parade, Vectorscope and a CIE chart, one at a time with ◀ ▶ (or Alt+[ and Alt+]), or up to four at once in the big view. They follow the picture while you drag.'
          ),
          tk('“In mask” shows only what the selected mask covers. Very handy, very nerdy.')
        ]
      },
      {
        title: tk('A tidier right column'),
        items: [
          tk(
            'One section at a time, picked from one dropdown, instead of a tower of folding cards. A dot says which sections hold changes.'
          ),
          tk(
            'Basic corrections: Treatment, Profile, White balance, Light and Presence together, as Lightroom’s Basic panel has them. Vibrance and Saturation moved into Presence, where they always secretly belonged.'
          ),
          tk(
            'Then the curves, then HSL, then the other colour tools, in both Lightroom and Resolve mode. ⌘1 to ⌘9 now jump like they do in Lightroom Classic.'
          )
        ]
      },
      {
        title: tk('History, Versions and Edits'),
        items: [
          tk(
            'The Edits list shows what you changed, not how many times you nudged it, and every edit has an eye to switch it off and on.'
          ),
          tk(
            'History is a short timeline grouped by editing session, with plain Undo and Redo. Changed your mind about one change from twenty steps ago? Delete just that one; everything after it stays.'
          ),
          tk(
            'Versions sit at the top of History: name your own, and Playroom keeps some for you, at the start of each session, before a look or an AI step, when you paste settings and when you export. Restoring one is a new step, so you can always come back.'
          ),
          tk(
            'Rebuild with the latest develop: an older project is redeveloped with today’s methods, its AI steps made again, in one undoable step. Playroom suggests it when it’s worth it.'
          )
        ]
      },
      {
        title: tk('Masks'),
        items: [
          tk(
            'The classic overlay is back, with handles on the photo, because the glass looked lovely and showed the feather badly. Function wins.'
          )
        ]
      },
      {
        title: tk('Looks and feel'),
        items: [
          tk(
            'Themes, in Settings → Interface: Playroom Signature (the new default, in layered blacks that melt into the dark workspace), Playroom Modern (black, purple and electric cyan, with a glow), Playroom Studio (neutral greys, for colour-critical work) and High contrast. The purple stays in every one; we have principles.'
          ),
          tk('Panels hold their own beside a bright HDR picture instead of disappearing into it.'),
          tk(
            'Text that doesn’t fit ends in “…”, and hovering it shows the whole thing. German, we see you.'
          )
        ]
      },
      {
        title: tk('Small but honest'),
        items: [
          tk(
            'Before now always starts from the Neutral profile, so you compare against the photo, not against our taste.'
          ),
          tk(
            'A RAW whose camera is in PIXL’s colour database uses PIXL’s colour unless you chose otherwise.'
          ),
          tk(
            'Some RAWs whose noise the engine couldn’t measure used to fall back to the old develop, and then kept every RAW after them on it too. Now it’s that one photo at most, and usually not even that.'
          )
        ]
      }
    ],
    next: [
      {
        title: tk('AI in HDR'),
        text: tk('PIXL Enhance on HDR photos and on a RAW’s highlights, without the SDR detour.')
      },
      {
        title: tk('The last two curves'),
        text: tk(
          'Hue vs Lum and Sat vs Sat already keep what you draw; they start working as soon as the engine catches up.'
        )
      },
      {
        title: tk('Sharper models'),
        text: tk('A fine-tuned PIXL Enhance, and scopes read from the full-size picture.')
      },
      { title: tk('And another cookie'), text: tk('You read the whole thing again. Respect. 🍪🍪') }
    ]
  },
  // Engines 0.18 and 0.19 together (TODO.md Phases N and O). Gemma, its
  // llama.cpp server and SAM 3 are held out of this release (the owner).
  {
    version: '0.4.0-beta',
    headline: tk(
      'Playroom in six languages, HDR while you edit, masks you can ask for by name, suggested rejects, and menus with every tool.'
    ),
    sections: [
      {
        title: tk('In your language'),
        items: [
          tk(
            'Playroom now speaks English, French, German, Simplified Chinese, Japanese and Vietnamese. It starts in your computer’s language when it is one of these, and in English otherwise; Settings → General → Language changes it.'
          ),
          tk(
            'The translations are new and ours, not yet checked by native speakers: Report wording, beside the language, tells us where one reads wrong.'
          )
        ]
      },
      {
        title: tk('Menus and windows'),
        items: [
          tk(
            'The menu bar holds the whole app: File, Edit, Photo, Develop, Masks and View, with every panel, tool and mask, and your own shortcuts beside them. What doesn’t apply where you are is greyed.'
          ),
          tk(
            'Right-click a photo, the picture, a mask or a text field for what you can do with it.'
          ),
          tk('Settings has a gear at the right of the top bar.'),
          tk(
            'On a Mac, the window’s buttons sit in the top bar instead of a title bar above it. On Windows, the menus and the window’s buttons share the top bar.'
          ),
          tk(
            'The flat look is the default now; turn off Settings → Interface → Always flat for the glass.'
          ),
          tk(
            'Labels, buttons and the logo no longer get selected or dragged by accident; the text in the info panes still can be.'
          )
        ]
      },
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
            'While Playroom is minimised or another app is in front, it lets its engine rest, which is lighter on the battery and frees memory; the top bar says Engine offline, in yellow, until you come back.'
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
      },
      // Engine 0.19.2 (Phase A of 0.20), added to this entry (the owner: no
      // entry of its own, the speed-ups last).
      {
        title: tk('Performance'),
        items: [
          tk(
            'On a Retina screen, pausing in the middle of a drag no longer makes the next move wait: a held slider rests at the draft’s size and sharpens when you let go.'
          ),
          tk(
            'Slider drags can run on the graphics chip, at the full preview size (Settings → Projects & interface → Performance): for now on photos that are not RAW, with the simpler edits. RAW photos still drag on the processor.'
          ),
          tk(
            '1:1 stays seamless under heavier edits: each part of the picture now reads as far around itself as the edit needs.'
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
