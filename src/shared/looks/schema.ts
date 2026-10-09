/**
 * A look as a file: what a look shared to the PIXL marketplace (later), or
 * exported and imported by hand, travels as. Only the sliders it sets go in
 * (`values`, by dotted path), never a whole recipe, so a file cannot carry a
 * photo's white balance, crop, masks or anything else that is the photo's.
 *
 *   { "format": "pixl-look", "schema": 1, "recipeVersion": 2,
 *     "look": { "id": "market:…", "name": "…", "version": 1,
 *               "author": { "kind": "community", "id": "…", "name": "…" },
 *               "collection": "creative", "tags": ["…"],
 *               "values": { "basic.contrast": 15, "toneCurve.master": [ … ] } } }
 *
 * Ids: `builtin:<slug>` for PIXL's own looks, a plain id for the user's
 * saved presets, `market:<uuid>` for the marketplace's. A file read from
 * outside never keeps a `builtin:` id (it would shadow ours).
 */
import type { Preset } from '../ipc'
import { defaultRecipe, RECIPE_VERSION, type Recipe } from '../recipe'
import { COLLECTION_BY_ID } from './collections'
import { groupsOf } from './dsl'
import { allowedPath, CURVE_PATHS, rangeOf } from './ranges'
import { readSmart, type SmartPart } from './smart'
import { LOOK_SCHEMA, type LookApproximation, type LookAuthor, type LookMeta } from './types'
import { t } from '../i18n'

export const LOOK_FILE_FORMAT = 'pixl-look'

export interface LookFile {
  format: typeof LOOK_FILE_FORMAT
  schema: number
  /** The recipe version the values were written against. */
  recipeVersion: number
  look: {
    id: string
    name: string
    version: number
    author: LookAuthor
    collection: string
    tags: string[]
    inspiredBy?: string
    description?: string
    approximates?: LookApproximation[]
    /** Each field the look sets, by dotted path. */
    values: Record<string, unknown>
    /** The masks and AI steps it makes (`smart.ts`). */
    smart?: SmartPart
  }
}

/** A look read from a file, and what was left out of it. */
export interface ReadLook {
  look: Preset & { fields: string[][]; meta: LookMeta }
  /** Paths dropped (not a look's to set, unknown, or malformed), and values clamped. */
  dropped: string[]
  clamped: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function at(root: unknown, path: string[]): unknown {
  let node = root
  for (const k of path) node = isObj(node) ? node[k] : undefined
  return node
}

/** A look (anything with `fields` and `meta`) as a file. */
export function lookToFile(look: Preset & { fields: string[][]; meta: LookMeta }): LookFile {
  const values: Record<string, unknown> = {}
  for (const f of look.fields) values[f.join('.')] = structuredClone(at(look.recipe, f))
  const m = look.meta
  return {
    format: LOOK_FILE_FORMAT,
    schema: LOOK_SCHEMA,
    recipeVersion: RECIPE_VERSION,
    look: {
      id: look.id,
      name: look.name,
      version: m.version,
      author: m.author,
      collection: m.collection,
      tags: [...m.tags],
      ...(m.inspiredBy ? { inspiredBy: m.inspiredBy } : {}),
      ...(m.description ? { description: m.description } : {}),
      ...(m.approximates?.length ? { approximates: [...m.approximates] } : {}),
      values,
      ...(look.smart ? { smart: structuredClone(look.smart) } : {})
    }
  }
}

/** Why a file is not a look we can read. */
export class LookFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LookFileError'
  }
}

const MAX_NAME = 80
const MAX_TAGS = 24
const MAX_TEXT = 400

/** A curve a look may carry: 2–16 points, x rising within 0…1, y within 0…1. */
function curveOk(v: unknown): boolean {
  if (!Array.isArray(v) || v.length < 2 || v.length > 16) return false
  let last = -1
  for (const p of v) {
    if (!isObj(p) || typeof p.x !== 'number' || typeof p.y !== 'number') return false
    if (!(p.x > last) || p.x > 1 || p.y < 0 || p.y > 1) return false
    last = p.x
  }
  return true
}

const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

function authorOf(v: unknown): LookAuthor {
  if (isObj(v) && v.kind === 'pixl') return { kind: 'pixl' }
  if (isObj(v) && v.kind === 'community' && typeof v.id === 'string')
    return { kind: 'community', id: v.id, name: text(v.name, MAX_NAME) ?? 'Unknown' }
  return { kind: 'user' }
}

const APPROXIMATIONS: LookApproximation[] = [
  'halation',
  'bloom',
  'chromaGrain',
  'selectiveColour',
  'hueSwap'
]

/**
 * Read a look file. Refuses (throws `LookFileError`) a file that is not one
 * or is of a newer schema; otherwise keeps what a look may set and drops
 * the rest, clamping numbers into their sliders' ranges. `trusted` keeps
 * the file's id as it is (our own catalog, a round trip); a file from
 * outside gets a `market:` id unless it has one.
 */
export function lookFromFile(
  raw: unknown,
  opts: { trusted?: boolean; newId?: () => string } = {}
): ReadLook {
  if (!isObj(raw) || raw.format !== LOOK_FILE_FORMAT) throw new LookFileError(t('Not a PIXL look.'))
  if (typeof raw.schema !== 'number' || raw.schema > LOOK_SCHEMA)
    throw new LookFileError(t('This look was made by a newer PIXL. Update to use it.'))
  const l = raw.look
  if (!isObj(l) || !isObj(l.values)) throw new LookFileError(t('The look file is damaged.'))
  const name = text(l.name, MAX_NAME)
  if (!name) throw new LookFileError(t('The look has no name.'))

  const recipe: Recipe = defaultRecipe(false)
  const fields: string[][] = []
  const dropped: string[] = []
  const clamped: string[] = []
  for (const [dotted, value] of Object.entries(l.values)) {
    const path = dotted.split('.')
    const parent = at(recipe, path.slice(0, -1))
    const last = path[path.length - 1]
    const was = isObj(parent) ? parent[last] : undefined
    // Only what a look may set, and only fields a recipe has.
    if (!allowedPath(path) || !isObj(parent) || !(last in parent) || was === undefined) {
      dropped.push(dotted)
      continue
    }
    let v: unknown = value
    if (CURVE_PATHS.includes(dotted)) {
      if (!curveOk(v)) {
        dropped.push(dotted)
        continue
      }
    } else if (typeof was === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        dropped.push(dotted)
        continue
      }
      const range = rangeOf(path)
      if (range && (v < range[0] || v > range[1])) {
        v = Math.min(range[1], Math.max(range[0], v))
        clamped.push(dotted)
      }
    } else if (dotted === 'treatment') {
      if (v !== 'color' && v !== 'bw') {
        dropped.push(dotted)
        continue
      }
    } else if (Array.isArray(was)) {
      // The parametric curve's splits: numbers, as many as it has.
      if (
        !Array.isArray(v) ||
        v.length !== was.length ||
        !v.every((x) => typeof x === 'number' && Number.isFinite(x))
      ) {
        dropped.push(dotted)
        continue
      }
    } else if (typeof v !== typeof was || isObj(was)) {
      // A whole group by one path (an object) is not a field: fields are its leaves.
      dropped.push(dotted)
      continue
    }
    parent[last] = structuredClone(v)
    fields.push(path)
  }

  const collection =
    typeof l.collection === 'string' && COLLECTION_BY_ID.has(l.collection)
      ? l.collection
      : 'creative'
  const tags = Array.isArray(l.tags)
    ? l.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toLowerCase().slice(0, MAX_NAME))
        .slice(0, MAX_TAGS)
    : []
  const meta: LookMeta = {
    collection,
    tags,
    author: authorOf(l.author),
    version: typeof l.version === 'number' && l.version >= 1 ? Math.floor(l.version) : 1
  }
  const inspiredBy = text(l.inspiredBy, MAX_TEXT)
  const description = text(l.description, MAX_TEXT)
  if (inspiredBy) meta.inspiredBy = inspiredBy
  if (description) meta.description = description
  const approx = Array.isArray(l.approximates)
    ? l.approximates.filter((a): a is LookApproximation =>
        APPROXIMATIONS.includes(a as LookApproximation)
      )
    : []
  if (approx.length) meta.approximates = approx
  const smart = readSmart(l.smart)
  for (const d of smart.dropped) dropped.push(`smart.${d}`)

  const fileId = typeof l.id === 'string' ? l.id : ''
  const id =
    opts.trusted && fileId
      ? fileId
      : /^market:[0-9a-f-]{8,}$/i.test(fileId)
        ? fileId
        : `market:${(opts.newId ?? (() => crypto.randomUUID()))()}`
  return {
    look: {
      id,
      name,
      group: COLLECTION_BY_ID.get(collection)!.label,
      builtin: false,
      groups: groupsOf(fields),
      recipe,
      fields,
      meta,
      ...(smart.smart ? { smart: smart.smart } : {})
    },
    dropped,
    clamped
  }
}
