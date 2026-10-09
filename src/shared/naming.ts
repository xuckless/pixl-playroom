/**
 * Gemma names what is in a photo, and nothing else (engine 0.19's guide
 * §1a, corrected 2026-10-09 for E56): its names are suggestions shown as
 * chips atop the Masks pane, and words the Library's search finds. Playroom's
 * own map, here, turns each name into one of its tools (§1b); Gemma's own
 * finder choice and boxes are never used, and it never judges a mask.
 *
 * Pure, for tests/naming.test.ts.
 */
import type { PartTarget, SceneTarget } from './ai'
import type { FacePart } from './faceparts'

/**
 * The user text, word for word as the engine's PC check sent it (the guide's
 * `NAME_PROMPT`): its names are what was measured. Until pixl-auto has
 * `brain.name()` (0.20) with a terse answer, the answer is the plan schema
 * with no edits. A whitespace-free grammar was tried (2026-10-09) and Gemma
 * wrote the field syntax into its labels: the speed has to come from a
 * shorter answer, not a tighter one.
 */
export const NAME_PROMPT = [
  'List everything in this photo worth masking for an editor, one target per entry (up to 8), the most important first.',
  'Mark the photo\'s main subject with "subject": true, whatever it is (a person, a group, a building, a boat, an animal); exactly one target is the subject.',
  'For each target choose a finder: a named plane (sky, vegetation, water, hair, face_skin, body_skin, clothes, subject); face_part with the part name as the prompt; text with a short noun phrase as the prompt; or box with [x, y, width, height] as fractions of the photo.',
  'Give a prompt only for text and face_part (null otherwise) and a box only when you can place it (null otherwise). "intent" says in a few words why an editor would mask it.',
  '"describe" is one sentence on what the photo shows. "edits" stays empty: nothing is edited here.',
  'Answer with the JSON only.'
].join('\n')

/** Gemma pretty-prints its JSON: under 3000 tokens a plan is cut off (the guide). */
export const NAME_MAX_TOKENS = 3000

/** The system text: only the first line of pixl-auto's, then the finders' listing (no workers). */
export function namingSystem(system: string, workersText: string): string {
  return `${system.split('\n')[0]}\n\n${workersText.split('\nWorkers')[0]}`
}

/** One thing in the photo, as a chip. */
export interface NamedThing {
  label: string
  /** Why an editor would mask it, in Gemma's few words ('' for one the user typed). */
  intent: string
  /** The photo's main subject (★). */
  subject: boolean
  /** Typed by the user, not suggested. */
  user?: boolean
}

/** What a photo is named, kept in the index and its `.pixl` project. */
export interface PhotoNames {
  v: 1
  /** Who named it: the brain's id. */
  by: string
  /** ISO time. */
  at: string
  /** Gemma's one sentence on the photo (searched too). */
  describe: string
  things: NamedThing[]
  /** The user changed the list: naming again never overwrites it. */
  edited?: boolean
}

const MAX_THINGS = 12
const MAX_LABEL = 40

/** The finder names Gemma sometimes gives as a label: not names of things (the guide §1b). */
const FINDER_WORDS = new Set([
  'subject',
  'main subject',
  'face skin',
  'body skin',
  'face part',
  'text',
  'box',
  'global',
  'background'
])

/** A label as a chip shows it: lower case, `_` → space, no article, or null (a finder's name, empty). */
export function cleanLabel(label: string): string | null {
  const s = label
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[^\p{L}\p{N}' &/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .slice(0, MAX_LABEL)
    .trim()
  if (!s || FINDER_WORDS.has(s)) return null
  return s
}

interface PlanLike {
  describe?: unknown
  targets?: unknown
}

/**
 * The names from Gemma's answer: each target's label, subject and intent
 * only (its finder and box ignored), a target `checkPlan()` flagged dropped
 * (`problems`' paths name it), labels cleaned and each kept once.
 */
export function namesFromPlan(
  plan: PlanLike,
  problems: { path: string }[],
  by: string,
  at: string
): PhotoNames {
  const flagged = new Set<number>()
  for (const p of problems) {
    const m = /^\/targets\/(\d+)/.exec(p.path)
    if (m) flagged.add(Number(m[1]))
  }
  const things: NamedThing[] = []
  const seen = new Set<string>()
  const targets = Array.isArray(plan.targets) ? (plan.targets as Record<string, unknown>[]) : []
  targets.forEach((t, i) => {
    if (flagged.has(i) || !t || typeof t.label !== 'string') return
    const label = cleanLabel(t.label)
    if (!label || seen.has(label)) return
    seen.add(label)
    things.push({
      label,
      intent: typeof t.intent === 'string' ? t.intent.trim().slice(0, 160) : '',
      subject: t.subject === true
    })
  })
  // One subject at most: the first Gemma marked.
  let starred = false
  for (const t of things) {
    if (t.subject && starred) t.subject = false
    if (t.subject) starred = true
  }
  return {
    v: 1,
    by,
    at,
    describe: typeof plan.describe === 'string' ? plan.describe.trim().slice(0, 300) : '',
    things: things.slice(0, MAX_THINGS)
  }
}

/** Names read back from the index or a project: anything odd is none. */
export function readNames(v: unknown): PhotoNames | null {
  let o: unknown = v
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  if (r.v !== 1 || !Array.isArray(r.things)) return null
  const things: NamedThing[] = []
  for (const t of r.things as Record<string, unknown>[]) {
    const label = t && typeof t.label === 'string' ? cleanLabel(t.label) : null
    if (!label || things.some((x) => x.label === label)) continue
    things.push({
      label,
      intent: typeof t.intent === 'string' ? t.intent.slice(0, 160) : '',
      subject: t.subject === true,
      ...(t.user === true ? { user: true } : {})
    })
  }
  return {
    v: 1,
    by: typeof r.by === 'string' ? r.by : '',
    at: typeof r.at === 'string' ? r.at : '',
    describe: typeof r.describe === 'string' ? r.describe.slice(0, 300) : '',
    things: things.slice(0, MAX_THINGS),
    ...(r.edited === true ? { edited: true } : {})
  }
}

/** The list with one name added by the user (cleaned; at the end; once). */
export function withAdded(n: PhotoNames | null, label: string, at: string): PhotoNames | null {
  const clean = cleanLabel(label)
  if (!clean) return n
  const base: PhotoNames = n ?? { v: 1, by: 'user', at, describe: '', things: [] }
  if (base.things.some((t) => t.label === clean)) return base
  return {
    ...base,
    edited: true,
    things: [...base.things, { label: clean, intent: '', subject: false, user: true }].slice(
      0,
      MAX_THINGS
    )
  }
}

/** The list without a name (the user took the chip off). */
export function withRemoved(n: PhotoNames, label: string): PhotoNames {
  return { ...n, edited: true, things: n.things.filter((t) => t.label !== label) }
}

// ── The map: a name to a tool (the guide §1b) ──

export type NameRoute =
  | { kind: 'scene'; target: SceneTarget }
  /** The photo's subject, whatever it is: the subject plane. */
  | { kind: 'subject' }
  | { kind: 'part'; part: PartTarget }
  | { kind: 'face'; part: FacePart }
  /** One person among several: SAM 2.1 on the user's click. */
  | { kind: 'person' }
  /** Anything else: the name as a phrase (Find by name). */
  | { kind: 'phrase'; text: string }

const words = (s: string): string[] => s.split(/[\s/&,-]+/).filter(Boolean)
const any = (label: string, set: Set<string>): boolean =>
  set.has(label) || words(label).some((w) => set.has(w))

const SKY = new Set(['sky', 'skies', 'clouds', 'cloud', 'sunset sky', 'overcast'])
const VEGETATION = new Set([
  'vegetation',
  'tree',
  'trees',
  'grass',
  'plants',
  'plant',
  'foliage',
  'forest',
  'bushes',
  'bush',
  'shrubs',
  'leaves',
  'greenery',
  'hedge',
  'lawn',
  'treeline'
])
const WATER = new Set([
  'water',
  'lake',
  'sea',
  'ocean',
  'river',
  'creek',
  'pond',
  'waves',
  'stream',
  'waterfall',
  'bay',
  'harbour',
  'harbor'
])
const PERSON = new Set([
  'person',
  'man',
  'woman',
  'boy',
  'girl',
  'child',
  'kid',
  'baby',
  'people',
  'men',
  'women',
  'guy',
  'lady',
  'bride',
  'groom'
])
/** Words that point at one person among others ("the man on the left"). */
const WHICH = new Set([
  'left',
  'right',
  'middle',
  'center',
  'centre',
  'front',
  'back',
  'behind',
  'second',
  'third',
  'first',
  'other',
  'background',
  'foreground'
])

/**
 * Which tool a name goes to. A name of the scene, a person's part or a
 * face part goes to its model whatever Gemma marked (it has called the sky
 * the subject); the subject, to the subject plane; one person among others,
 * to a click; anything else, to Find by name.
 */
export function routeName(t: Pick<NamedThing, 'label' | 'subject'>, people = 1): NameRoute {
  const l = t.label
  const w = words(l)
  const has = (...xs: string[]): boolean => xs.some((x) => w.includes(x) || l === x)
  // A person's part or a face's, first: "woman's hair" is hair, not a woman.
  if (has('hair', 'hairstyle')) return { kind: 'part', part: 'hair' }
  if (has('eyes', 'eye')) return { kind: 'face', part: 'eyes' }
  if (has('lips', 'lip', 'mouth')) return { kind: 'face', part: 'lips' }
  if (has('brows', 'eyebrows', 'eyebrow', 'brow')) return { kind: 'face', part: 'brows' }
  if (has('teeth', 'smile')) return { kind: 'face', part: 'teeth' }
  if (has('face', 'faces') || l === 'face skin') return { kind: 'part', part: 'face' }
  if (has('skin', 'arms', 'legs', 'hands')) return { kind: 'part', part: 'skin' }
  if (has('clothes', 'clothing', 'outfit')) return { kind: 'part', part: 'clothes' }
  if (any(l, SKY)) return { kind: 'scene', target: 'sky' }
  if (any(l, WATER)) return { kind: 'scene', target: 'water' }
  if (any(l, VEGETATION)) return { kind: 'scene', target: 'vegetation' }
  const person = any(l, PERSON)
  if (person && (people > 1 || w.some((x) => WHICH.has(x)))) return { kind: 'person' }
  if (t.subject) return { kind: 'subject' }
  return { kind: 'phrase', text: l }
}

/** How many of the names are people (two or more: each is picked by a click). */
export function peopleIn(things: Pick<NamedThing, 'label'>[]): number {
  return things.filter((t) => any(t.label, PERSON)).length
}

/** The words a name is also found by in the Library ("ocean" by "sea"; "forest" by "trees"). */
const ALIASES: [Set<string>, string[]][] = [
  [new Set(['ocean', 'sea', 'seaside', 'beach', 'waves']), ['sea', 'ocean']],
  [new Set(['man', 'woman', 'boy', 'girl', 'child', 'kid', 'baby', 'guy', 'lady']), ['person']],
  [new Set(['men', 'women', 'people', 'crowd', 'group']), ['people', 'person']],
  [new Set(['dog', 'cat', 'bird', 'horse', 'cow', 'crow', 'duck', 'sheep']), ['animal']],
  [new Set(['car', 'truck', 'bus', 'van', 'bicycle', 'bike', 'motorcycle']), ['vehicle']],
  [new Set(['house', 'houses', 'building', 'buildings', 'tower', 'church']), ['building']],
  [new Set(['mountain', 'mountains', 'hills', 'hill']), ['mountain']],
  [new Set(['forest', 'woods', 'foliage', 'treeline', 'tree', 'trees']), ['tree', 'trees']]
]

/** A word's other number, roughly ("tree" ↔ "trees"), so either finds it. */
function otherNumber(w: string): string | null {
  if (w.length < 3 || !/^\p{L}+$/u.test(w)) return null
  if (w.endsWith('ss')) return null
  return w.endsWith('s') ? w.slice(0, -1) : `${w}s`
}

/**
 * What the Library's search finds a named photo by: each name and its
 * words' other number, its scene class (a "lake" is water), a few close
 * words, and Gemma's sentence.
 */
export function searchWords(n: PhotoNames | null): string[] {
  if (!n) return []
  const out = new Set<string>()
  for (const t of n.things) {
    out.add(t.label)
    for (const w of words(t.label)) {
      const o = otherNumber(w)
      if (o) out.add(o)
    }
    const r = routeName({ label: t.label, subject: false })
    if (r.kind === 'scene') out.add(r.target)
    for (const [set, extra] of ALIASES) if (any(t.label, set)) extra.forEach((x) => out.add(x))
  }
  if (n.describe) out.add(n.describe.toLowerCase())
  return [...out]
}
