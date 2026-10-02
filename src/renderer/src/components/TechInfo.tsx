import { useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons'
import { Popover } from './Popover'

/**
 * A </> beside an option: the numbers behind it (a measurement, a version,
 * what the engine did), in a small popover, for whoever wants them. Nobody
 * needs them to use the option, so they stay out of the panel.
 */
export function TechInfo({
  title,
  children,
  align = 'right'
}: {
  title: string
  children: ReactNode
  align?: 'left' | 'right'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`icon sm tech-info${open ? ' on' : ''}`}
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
      >
        <Icon name="engine" />
      </button>
      {open && (
        <Popover anchor={btn} onClose={() => setOpen(false)} align={align} className="tech-pop">
          <span className="micro">{title}</span>
          <div className="tech-body">{children}</div>
        </Popover>
      )}
    </>
  )
}
