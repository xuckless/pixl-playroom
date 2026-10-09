import type { CSSProperties } from 'react'
import './apertureElement'
import type { ApertureState, PixlAperture } from './apertureElement'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'pixl-aperture': {
        ref?: React.Ref<PixlAperture>
        size?: number
        state?: ApertureState
        progress?: number
        tone?: 'flat' | 'glass' | 'mono'
        ink?: string
        mode?: 'mark' | 'overlay'
        glow?: boolean
        class?: string
        style?: CSSProperties
        'aria-hidden'?: boolean | 'true' | 'false'
      }
    }
  }
}

/**
 * The aperture loader (fx/apertureElement.ts): spinning while the share is unknown,
 * the ring filling once it is (`progress` 0–1). Inline 16–24 px, a panel
 * 96–160 px with `tone="glass"` and `glow`.
 */
export function Aperture({
  size,
  progress = null,
  state,
  tone = 'flat',
  glow = false,
  className
}: {
  size: number
  /** 0–1, or null while it can't be known (it spins). */
  progress?: number | null
  /** Overrides what `progress` implies (idle, closed). */
  state?: ApertureState
  tone?: 'flat' | 'glass' | 'mono'
  glow?: boolean
  className?: string
}): React.JSX.Element {
  const known = progress !== null
  return (
    <pixl-aperture
      size={size}
      tone={tone}
      glow={glow}
      state={state ?? (known ? 'progress' : 'spin')}
      progress={known ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : 0}
      class={className}
      aria-hidden="true"
    />
  )
}
