/** What the Library's filters are called, shared by the filter bar and the More… popover. */
import type { FlagFilter } from '../../../../shared/filter'
import { t, tk } from '../../lib/i18n'

export const FLAGS: [FlagFilter, string][] = [
  ['notRejected', tk('Hide rejected')],
  ['all', tk('All photos')],
  ['pick', tk('Picks')],
  ['unflagged', tk('Unflagged')],
  ['reject', tk('Rejected only')]
]

const LABEL_NAME: Record<string, string> = {
  red: tk('Red'),
  yellow: tk('Yellow'),
  green: tk('Green'),
  blue: tk('Blue'),
  purple: tk('Purple')
}

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1)

/** A colour label's name, to show (the label itself is the key). */
export const labelName = (l: string): string => (LABEL_NAME[l] ? t(LABEL_NAME[l]) : cap(l))
