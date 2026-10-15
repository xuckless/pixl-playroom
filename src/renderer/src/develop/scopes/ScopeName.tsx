import { SCOPE_LABEL } from './labels'
import type { ExpandedScope } from '../../../../shared/scopes'
import { t } from '../../lib/i18n'

/**
 * The scope's name between ◀ and ▶, as wide as the widest of the names it
 * cycles through (in this language): every name sits in one grid cell and
 * only the shown one is visible, so the arrows never move and a run of
 * clicks lands on the same spot.
 */
export function ScopeName({
  kind,
  kinds = Object.keys(SCOPE_LABEL) as ExpandedScope[]
}: {
  kind: ExpandedScope
  kinds?: readonly ExpandedScope[]
}): React.JSX.Element {
  return (
    <span className="scope-name">
      {kinds.map((k) => (
        <span key={k} className={k === kind ? 'on' : undefined} aria-hidden={k !== kind}>
          {t(SCOPE_LABEL[k])}
        </span>
      ))}
    </span>
  )
}
