import { PathIcon } from '../components/icons'
import { useUi } from '../state/ui'
import { ToolWheel } from './ToolWheel'
import { selectPanel, TOOLS } from './tools'
import { withKey } from '../lib/commands'

/** The chosen tool's name, glyph and purpose beside the thumb-wheel, with a tick for each tool. */
export function ToolDial(): React.JSX.Element {
  const panel = useUi((s) => s.panel)
  const index = Math.max(
    0,
    TOOLS.findIndex((t) => t.id === panel)
  )
  const t = TOOLS[index]
  return (
    <div className="dial sweep">
      <div className="dial-info" key={t.id}>
        <div className="dial-name">
          <span className="dial-glyph">
            <PathIcon d={t.icon} />
          </span>
          <span>{t.name}</span>
        </div>
        <div className="dial-desc">{t.desc}</div>
        <div className="dial-index" role="tablist" aria-label="Tools">
          {TOOLS.map((x, i) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={i === index}
              aria-label={x.name}
              title={withKey(x.name, `tool.${x.id}`)}
              className={i === index ? 'on' : ''}
              onClick={() => selectPanel(x.id)}
            />
          ))}
        </div>
      </div>
      <ToolWheel />
    </div>
  )
}
