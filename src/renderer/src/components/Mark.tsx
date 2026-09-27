import { useId } from 'react'

/**
 * The Pixl Playroom mark, in glass: a pixel-stepped aperture of six blades
 * around a lit sphere, with a highlight pixel on the sphere. Drawn from the
 * PIXL Brand Kit's Mark component (build/brand/marks holds the SVG masters).
 * `small` is the coarse eight-cell outline for 32 px and under; `full` adds
 * the lit seams and, unless `pixels` is off, three loose pixels leaving the
 * top-right corner.
 */
interface Geometry {
  outer: string
  hex: string
  blades: string[]
  /** The cuts between blades, as x1, y1, x2, y2. */
  seams: [number, number, number, number][]
  /** How wide the cuts are. */
  gap: number
  /** The sphere's radius. */
  sphere: number
}

const GEO: Record<'full' | 'small', Geometry> = {
  full: {
    outer:
      'M16 80 L16 160 L32 160 L32 192 L48 192 L48 208 L80 208 L80 224 L160 224 L160 208 L192 208 L192 192 L208 192 L208 160 L224 160 L224 80 L208 80 L208 48 L192 48 L192 32 L160 32 L160 16 L80 16 L80 32 L48 32 L48 48 L32 48 L32 80 Z',
    hex: 'M170 120 L145 163.3 L95 163.3 L70 120 L95 76.7 L145 76.7 Z',
    blades: [
      'M145 163.3 L208 163.3 L208 160 L224 160 L224 80 L208 80 L208 54.18 Z',
      'M95 163.3 L130.04 224 L160 224 L160 208 L192 208 L192 192 L208 192 L208 163.3 L145 163.3 Z',
      'M70 120 L32 185.82 L32 192 L48 192 L48 208 L80 208 L80 224 L130.04 224 L95 163.3 Z',
      'M95 76.7 L32 76.7 L32 80 L16 80 L16 160 L32 160 L32 185.82 Z',
      'M145 76.7 L109.96 16 L80 16 L80 32 L48 32 L48 48 L32 48 L32 76.7 Z',
      'M170 120 L208 54.18 L208 48 L192 48 L192 32 L160 32 L160 16 L109.96 16 Z'
    ],
    seams: [
      [170, 120, 208, 54.18],
      [145, 163.3, 208, 163.3],
      [95, 163.3, 130.04, 224],
      [70, 120, 32, 185.82],
      [95, 76.7, 32, 76.7],
      [145, 76.7, 109.96, 16]
    ],
    gap: 2.6,
    sphere: 38
  },
  small: {
    outer:
      'M30 60 L30 180 L60 180 L60 210 L180 210 L180 180 L210 180 L210 60 L180 60 L180 30 L60 30 L60 60 Z',
    hex: 'M180 120 L150 171.96 L90 171.96 L60 120 L90 68.04 L150 68.04 Z',
    blades: [
      'M150 171.96 L210 171.96 L210 68.04 L180 120 Z',
      'M90 171.96 L111.96 210 L180 210 L180 180 L210 180 L210 171.96 Z',
      'M60 120 L30 171.96 L30 180 L60 180 L60 210 L111.96 210 Z',
      'M90 68.04 L30 68.04 L30 171.96 L60 120 Z',
      'M150 68.04 L128.04 30 L60 30 L60 60 L30 60 L30 68.04 L90 68.04 Z',
      'M180 120 L210 68.04 L210 60 L180 60 L180 30 L128.04 30 L150 68.04 Z'
    ],
    seams: [
      [180, 120, 210, 68.04],
      [150, 171.96, 210, 171.96],
      [90, 171.96, 111.96, 210],
      [60, 120, 30, 171.96],
      [90, 68.04, 30, 68.04],
      [150, 68.04, 128.04, 30]
    ],
    gap: 5,
    sphere: 48
  }
}

/** Each blade's opacity, so the aperture reads as lit from the top left. */
const BLADE_OPACITY = [1, 0.82, 0.92, 0.74, 0.88, 0.8]

export function Mark({
  size,
  detail = 'full',
  pixels = true,
  glow = false,
  drift = false,
  label,
  className
}: {
  size: number
  detail?: 'full' | 'small'
  /** The loose pixels (full detail only). */
  pixels?: boolean
  glow?: boolean
  /** The loose pixels drift, as on the splash. */
  drift?: boolean
  /** Read out by assistive tech; without it the mark is decoration. */
  label?: string
  className?: string
}): React.JSX.Element {
  const u = useId().replace(/:/g, '')
  const geo = GEO[detail]
  const full = detail === 'full'
  const r = geo.sphere
  const s = r * 0.24
  const url = (id: string): string => `url(#${u}${id})`
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        display: 'block',
        overflow: 'visible',
        filter: glow
          ? `drop-shadow(0 0 ${Math.max(2, Math.round(size * 0.05))}px rgba(157,139,234,.45))`
          : undefined
      }}
    >
      <defs>
        <radialGradient id={`${u}sp`} cx="36%" cy="30%" r="75%">
          <stop offset="0" stopColor="#f1ecff" />
          <stop offset="0.22" stopColor="#bba9ff" />
          <stop offset="0.55" stopColor="#7b68d8" />
          <stop offset="0.85" stopColor="#2b1f66" />
          <stop offset="1" stopColor="#0d0a1f" />
        </radialGradient>
        <radialGradient id={`${u}rim`} cx="50%" cy="50%" r="50%">
          <stop offset="0.8" stopColor="#c8b9ff" stopOpacity="0" />
          <stop offset="0.97" stopColor="#c8b9ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}bl`} gradientUnits="userSpaceOnUse" cx="96" cy="84" r="150">
          <stop offset="0" stopColor="#7d69dc" />
          <stop offset="0.45" stopColor="#3f3290" />
          <stop offset="1" stopColor="#120e28" />
        </radialGradient>
        {full &&
          geo.seams.map(([x1, y1, x2, y2], i) => (
            <linearGradient
              key={i}
              id={`${u}s${i}`}
              gradientUnits="userSpaceOnUse"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            >
              <stop offset="0" stopColor="#e6dfff" />
              <stop offset="0.35" stopColor="#9d8bea" stopOpacity="0.55" />
              <stop offset="1" stopColor="#9d8bea" stopOpacity="0" />
            </linearGradient>
          ))}
        <mask id={`${u}rm`} maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">
          <path d={geo.outer} fill="#fff" />
          {geo.seams.map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#000"
              strokeWidth={geo.gap}
              strokeLinecap="square"
            />
          ))}
          <path d={geo.hex} fill="#000" />
        </mask>
      </defs>
      <g mask={url('rm')}>
        <path d={geo.outer} fill="#0b0816" />
        {geo.blades.map((d, i) => (
          <path key={i} d={d} fill={url('bl')} opacity={BLADE_OPACITY[i]} />
        ))}
      </g>
      {full && (
        <>
          {geo.seams.map(([x1, y1, x2, y2], i) => (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={url(`s${i}`)}
              strokeWidth="2.2"
              strokeLinecap="square"
            />
          ))}
          <path d={geo.outer} fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="1" />
          {pixels && (
            <g className={drift ? 'mark-drift' : undefined}>
              <rect x="200" y="24" width="12" height="12" fill="#9d8bea" />
              <rect x="218" y="10" width="8" height="8" fill="#9d8bea" opacity="0.6" />
              <rect x="230" y="2" width="5" height="5" fill="#9d8bea" opacity="0.3" />
            </g>
          )}
        </>
      )}
      <circle cx="120" cy="120" r={r} fill={url('sp')} />
      <circle cx="120" cy="120" r={r} fill={url('rim')} />
      <rect
        x={120 - r * 0.42 - s / 2}
        y={120 - r * 0.44 - s / 2}
        width={s}
        height={s}
        fill="#fff"
        opacity="0.94"
      />
    </svg>
  )
}
