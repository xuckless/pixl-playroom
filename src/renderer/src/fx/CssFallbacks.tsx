import { useId } from 'react'

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
