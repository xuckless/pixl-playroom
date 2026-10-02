/**
 * Finding a look by what it is called, what inspired it, or what it is
 * like. Every word typed has to match somewhere; a match in the name counts
 * most, then the source, then tags and the collection, then the
 * description. A longer word forgives one typo.
 */
import type { Preset } from '../ipc'
import { COLLECTION_BY_ID } from './collections'

export interface LookFilter {
  /** Only these collections (ids). */
  collections?: string[]
  /** Only these ids (My Looks). */
  ids?: string[]
}

/** Lower case, accents dropped, punctuation as spaces. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()
}

/** Whether `a` and `b` are at most one edit apart (insert, delete, change, swap neighbours). */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length === b.length && a[i] === b[j + 1] && a[i + 1] === b[j]) {
      // Two letters typed the wrong way round: one slip.
      i += 2
      j += 2
    } else if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** How well one query word matches a field's words: 0 none, up to 1. */
function wordScore(token: string, words: string[], phrase: string): number {
  let best = 0
  for (const w of words) {
    if (w === token) return 1
    // A whole word anywhere beats the start of one in the name ("portra" is a
    // stock, not the start of "portrait").
    if (w.startsWith(token)) best = Math.max(best, 0.6)
    else if (token.length >= 4 && w.includes(token)) best = Math.max(best, 0.35)
    else if (token.length >= 5 && oneEdit(token, w.slice(0, token.length + 1)))
      best = Math.max(best, 0.3)
    else if (token.length >= 5 && oneEdit(token, w)) best = Math.max(best, 0.3)
  }
  // "classic chrome" typed as one word still finds "Classic Chrome".
  if (best < 0.35 && token.length >= 4 && phrase.replace(/ /g, '').includes(token)) best = 0.35
  return best
}

interface Indexed {
  preset: Preset
  fields: { words: string[]; phrase: string; weight: number }[]
}

function index(p: Preset): Indexed {
  const field = (text: string, weight: number): Indexed['fields'][number] => {
    const phrase = fold(text)
    return { words: phrase.split(' ').filter(Boolean), phrase, weight }
  }
  const m = p.meta
  const shelf = m ? (COLLECTION_BY_ID.get(m.collection)?.label ?? '') : p.group
  return {
    preset: p,
    fields: [
      field(p.name, 4),
      field(m?.inspiredBy ?? '', 3),
      field((m?.tags ?? []).join(' '), 2),
      field(shelf, 2),
      field(m?.description ?? '', 1)
    ]
  }
}

/** The presets matching `query` and `filter`, best first (catalog order when the query is empty). */
export function searchLooks<P extends Preset>(
  list: P[],
  query: string,
  filter: LookFilter = {}
): P[] {
  const allowed = list.filter(
    (p) =>
      (!filter.collections || (p.meta && filter.collections.includes(p.meta.collection))) &&
      (!filter.ids || filter.ids.includes(p.id))
  )
  const tokens = fold(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return allowed
  const scored: { p: P; score: number; at: number }[] = []
  allowed.forEach((p, at) => {
    const ix = index(p)
    let score = 0
    for (const t of tokens) {
      let best = 0
      for (const f of ix.fields) best = Math.max(best, wordScore(t, f.words, f.phrase) * f.weight)
      if (best === 0) return
      score += best
    }
    scored.push({ p, score, at })
  })
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.p)
}
