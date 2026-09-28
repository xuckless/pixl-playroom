/**
 * Keywords are paths, `|` between levels ("Places|Canada|Winnipeg"), as
 * Lightroom's `lr:hierarchicalSubject` holds them. A flat keyword is a path
 * of one level.
 */

/** A keyword path tidied: levels trimmed, empty levels dropped; '' when nothing is left. */
export function normaliseKeyword(path: string): string {
  return path
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .join('|')
}

/** Tidied, without empties and duplicates, in their first order. */
export function normaliseKeywords(paths: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    const k = normaliseKeyword(p)
    if (k && !seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

/** A path and every ancestor: "A|B|C" → "A", "A|B", "A|B|C". */
export function keywordPrefixes(path: string): string[] {
  const levels = path.split('|')
  return levels.map((_, i) => levels.slice(0, i + 1).join('|'))
}

/** Whether `path` is `under` itself or somewhere beneath it. */
export const isUnder = (path: string, under: string): boolean =>
  path === under || path.startsWith(under + '|')

/**
 * The flat keywords a hierarchy stands for, Lightroom-style: every level's
 * name, so "Places|Canada" gives "Places" and "Canada" (for `dc:subject` and
 * IPTC Keywords, which have no levels).
 */
export function flatSubjects(paths: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    for (const name of p.split('|')) {
      if (name && !seen.has(name)) {
        seen.add(name)
        out.push(name)
      }
    }
  }
  return out
}

// ── what the keyword field takes and offers ──

/**
 * Keywords as typed: levels by `>` or `|` ("Places > Canada" or
 * "Places|Canada"), several at once by commas or semicolons.
 */
export function parseKeywordInput(text: string): string[] {
  return normaliseKeywords(text.split(/[,;]/).map((k) => k.replace(/>/g, '|')))
}

/** A path for reading: "Places › Canada". */
export const keywordLabel = (path: string): string => path.split('|').join(' › ')

interface PathNode {
  path: string
  children: PathNode[]
}

/** Every path of a keyword tree, parents before their children. */
export function keywordPaths(nodes: PathNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...keywordPaths(n.children)])
}

/**
 * Paths worth offering for what is typed: those with a level starting with
 * it first, then those containing it anywhere, leaving out `taken`.
 */
export function suggestKeywords(
  paths: string[],
  typed: string,
  taken: string[] = [],
  limit = 8
): string[] {
  const want = normaliseKeyword(typed.replace(/>/g, '|')).toLowerCase()
  if (!want) return []
  const skip = new Set(taken)
  const starts: string[] = []
  const contains: string[] = []
  for (const p of paths) {
    if (skip.has(p)) continue
    const s = p.toLowerCase()
    if (s.startsWith(want) || s.split('|').some((l) => l.startsWith(want))) starts.push(p)
    else if (s.includes(want)) contains.push(p)
  }
  return [...starts, ...contains].slice(0, limit)
}
