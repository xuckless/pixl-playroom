import { useId } from 'react'

/**
 * The sphere without WebGL: an SVG turbulence field displacing a lit disc,
 * breathing and turning in CSS. Still under reduced motion.
 */
export function CssSphere({ still = false }: { still?: boolean }): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg className={`css-sphere${still ? ' still' : ''}`} viewBox="0 0 220 220" aria-hidden>
      <defs>
        <radialGradient id={`s-${id}`} cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#e9e2ff" />
          <stop offset="0.35" stopColor="#b7a4ff" />
          <stop offset="0.7" stopColor="#7b68d8" />
          <stop offset="1" stopColor="#2b1f66" />
        </radialGradient>
        <radialGradient id={`r-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0.78" stopColor="rgba(233,226,255,0)" />
          <stop offset="1" stopColor="rgba(233,226,255,0.55)" />
        </radialGradient>
        <filter id={`d-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="3">
            {!still && (
              <animate
                attributeName="baseFrequency"
                dur="9s"
                values="0.016;0.024;0.016"
                repeatCount="indefinite"
              />
            )}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="30" />
        </filter>
      </defs>
      <g filter={`url(#d-${id})`}>
        <circle cx="110" cy="110" r="78" fill={`url(#s-${id})`} />
        <circle cx="110" cy="110" r="78" fill={`url(#r-${id})`} />
      </g>
    </svg>
  )
}

/** The ambient gradient without WebGL: soft purple light drifting on black, with grain. */
export function CssAmbient({
  still = false,
  intensity = 1
}: {
  still?: boolean
  intensity?: number
}): React.JSX.Element {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <div className={`css-ambient${still ? ' still' : ''}`} style={{ opacity: intensity }}>
      <span className="blob a" />
      <span className="blob b" />
      <span className="blob c" />
      <span className="blob d" />
      <svg className="grain" aria-hidden>
        <filter id={`g-${id}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g-${id})`} />
      </svg>
    </div>
  )
}
