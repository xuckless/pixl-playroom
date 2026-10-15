import { readout, type NudgeRow as Row } from '../../../../shared/quickdevelop'
import { t } from '../../lib/i18n'
import { nudge } from '../../lib/quickdevelop'

/**
 * One of Quick develop's rows: `<<` `<` the change made so far `>` `>>`.
 * Focused (the drawer's ↑/↓), ←/→ nudge it a step and ⇧ a big one.
 */
export function NudgeRow({
  row,
  change,
  mixed,
  disabled
}: {
  row: Row
  /** What this row changed on the targets so far, in its units. */
  change: number
  /** RAWs and other photos together: Temp says Warmer or Cooler. */
  mixed: boolean
  disabled: boolean
}): React.JSX.Element {
  const name = t(row.label)
  const shown = readout(row.id, change, mixed)
  const button = (dir: 1 | -1, big: boolean, glyph: string, title: string): React.JSX.Element => (
    <button
      className="icon sm qd-step"
      tabIndex={-1}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={() => nudge(row.id, dir, big)}
    >
      {glyph}
    </button>
  )
  return (
    <div
      className={`qd-row${change !== 0 ? ' changed' : ''}`}
      data-qd-row={row.id}
      tabIndex={disabled ? -1 : 0}
      role="group"
      aria-label={t('{{name}}: {{change}}', { name, change: shown })}
    >
      <span className="qd-name">{name}</span>
      {button(-1, true, '«', t('{{name}}: a big step down', { name }))}
      {button(-1, false, '‹', t('{{name}}: a step down', { name }))}
      <span className="qd-change t-num" aria-live="polite">
        {shown}
      </span>
      {button(1, false, '›', t('{{name}}: a step up', { name }))}
      {button(1, true, '»', t('{{name}}: a big step up', { name }))}
    </div>
  )
}
