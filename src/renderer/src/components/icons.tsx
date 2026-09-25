/** Line icons drawn on a 24-unit grid with the current colour. */
const PATHS = {
  library: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  enhance: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  ),
  export: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19h16" />
    </>
  ),
  presets: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" className="fill-bg" />
      <circle cx="15" cy="12" r="2" className="fill-bg" />
      <circle cx="7" cy="18" r="2" className="fill-bg" />
    </>
  ),
  snapshots: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  folder: <path d="M3 7h6l2 2h10v11H3z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.1A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.9-1.3" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  picker: (
    <>
      <path d="m3 21 8-8" />
      <circle cx="15" cy="9" r="5" />
    </>
  ),
  crop: <path d="M6 2v16h16M2 6h16v16" />,
  rotateLeft: (
    <>
      <path d="M20 10a8 8 0 0 0-14-4L4 8" />
      <path d="M4 3v5h5" />
      <rect x="11" y="14" width="9" height="7" />
    </>
  ),
  rotateRight: (
    <>
      <path d="M4 10a8 8 0 0 1 14-4l2 2" />
      <path d="M20 3v5h-5" />
      <rect x="4" y="14" width="9" height="7" />
    </>
  ),
  flip: <path d="M12 3v18M5 8l-2 4 2 4M19 8l2 4-2 4" />,
  reset: (
    <>
      <path d="M4 12a8 8 0 1 0 3-6.3" />
      <path d="M4 3v5h5" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
  brush: (
    <>
      <path d="M4 20c2-6 8-6 10-12" />
      <circle cx="16" cy="6" r="3" />
    </>
  ),
  lasso: <path d="M4 12c0-4 4-7 8-7s8 3 8 7-4 7-8 7c-2 0-3 2-3 3" />,
  linear: (
    <>
      <path d="M3 6h18" strokeDasharray="0" />
      <path d="M3 12h18" strokeDasharray="2 2.5" />
      <path d="M3 18h18" />
    </>
  ),
  radial: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="7" />
      <ellipse cx="12" cy="12" rx="5" ry="3.6" strokeDasharray="2 2" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  colourRange: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16" />
    </>
  ),
  lumRange: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  depth: (
    <>
      <path d="M3 18 9 8l4 6 3-4 5 8z" />
    </>
  ),
  subject: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21c1-4.5 3.5-7 7-7s6 2.5 7 7" />
      <path d="M2 6V2h4M18 2h4v4M22 18v4h-4M6 22H2v-4" />
    </>
  ),
  sky: (
    <>
      <path d="M7 17a4 4 0 1 1 1-7.9A5.5 5.5 0 0 1 18.5 11 3 3 0 0 1 18 17z" />
      <path d="M2 21h20" />
    </>
  ),
  background: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <circle cx="12" cy="11" r="3" />
      <path d="M7 20c1-3 3-4.5 5-4.5s4 1.5 5 4.5" />
    </>
  ),
  invert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" className="fill-cur" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" />
      <path d="M4 16V4h12" />
    </>
  ),
  rename: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </>
  ),
  pin: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
    </>
  ),
  overlay: (
    <>
      <rect x="3" y="5" width="14" height="14" />
      <rect x="7" y="3" width="14" height="14" className="fill-acc" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  )
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  className,
  title
}: {
  name: IconName
  className?: string
  title?: string
}): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={`icon-svg ${className ?? ''}`} aria-hidden={!title}>
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  )
}

/** A glyph from an SVG path string (the tool registry's icons). */
export function PathIcon({ d, className }: { d: string; className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={`icon-svg ${className ?? ''}`} aria-hidden>
      <path d={d} />
    </svg>
  )
}
