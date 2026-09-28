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
