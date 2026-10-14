/** The checking languages' text (PLAYROOM_PSEUDO_LOCALE): pure, for tests. */

const ACCENTED: Record<string, string> = {
  a: 'á',
  e: 'ë',
  i: 'ï',
  o: 'ö',
  u: 'ü',
  y: 'ÿ',
  c: 'ç',
  n: 'ñ',
  A: 'Á',
  E: 'Ë',
  I: 'Ï',
  O: 'Ö',
  U: 'Ü',
  Y: 'Ÿ',
  C: 'Ç',
  N: 'Ñ'
}

/**
 * A string as a longer language would set it (PLAYROOM_PSEUDO_LOCALE=expand):
 * its letters accented, padded to 1.4 times its length, ⟦bracketed⟧, its
 * `{{placeholders}}` untouched. What overflows like this overflows in German.
 */
export function pseudoExpand(s: string): string {
  const parts = s.split(/(\{\{[^}]*\}\})/)
  const accented = parts
    .map((p) => (p.startsWith('{{') ? p : p.replace(/[a-zA-Z]/g, (ch) => ACCENTED[ch] ?? ch)))
    .join('')
  const pad = Math.ceil(s.length * 0.4)
  return `⟦${accented}${'·'.repeat(pad)}⟧`
}
