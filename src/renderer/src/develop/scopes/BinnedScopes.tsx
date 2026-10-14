/**
 * Resolve's scopes drawn from the picture's binned pixels (lib/scopes/live.ts):
 * the waveform (luma, or the three channels over one another), the RGB
 * parade and the vectorscope. Each is a canvas of log density under an SVG
 * graticule, the scale on Resolve's 10-bit 0…1023 (and room above it where
 * the picture has headroom).
 */
import { useEffect, useRef } from 'react'
import { SKIN_LINE, paintDensity, vectorTargets, type ScopeBins } from '../../../../shared/scopes'
import { t } from '../../lib/i18n'

const RED = [255, 84, 100] as const
const GREEN = [90, 228, 128] as const
const BLUE = [96, 140, 255] as const
const LUMA = [214, 222, 240] as const

/** Paints `draw` into the canvas at `w × h` whenever `deps` change. */
function useDensityCanvas(
  w: number,
  h: number,
  draw: ((out: Uint8ClampedArray) => void) | null
): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    c.width = w
    c.height = h
    const img = ctx.createImageData(w, h)
    draw?.(img.data)
    ctx.putImageData(img, 0, 0)
  }, [w, h, draw])
  return ref
}

/** The graticule's rows: 0…1023 every 128, and each quarter unit above white. */
function levelsOf(top: number): { at: number; label: string; white?: boolean }[] {
  const rows: { at: number; label: string; white?: boolean }[] = []
  for (let v = 0; v <= 1023; v += 128) rows.push({ at: v / 1023, label: String(v) })
  rows.push({ at: 1, label: '1023', white: top > 1 })
  for (let v = 1.25; v <= top + 1e-6; v += 0.25) rows.push({ at: v, label: `${v.toFixed(2)}×` })
  return rows
}

function Graticule({ top, panes = 1 }: { top: number; panes?: number }): React.JSX.Element {
  const rows = levelsOf(top)
  const y = (v: number): number => 100 - (v / top) * 100
  return (
    <svg className="scope-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {top > 1 && <rect className="scope-headroom" x={0} y={0} width={100} height={y(1)} />}
      {rows.map((r) => (
        <line
          key={r.label}
          x1={0}
          x2={100}
          y1={y(r.at)}
          y2={y(r.at)}
          className={r.white ? 'scope-line white' : 'scope-line'}
        />
      ))}
      {Array.from({ length: panes - 1 }, (_, i) => (
        <line
          key={i}
          x1={((i + 1) * 100) / panes}
          x2={((i + 1) * 100) / panes}
          y1={0}
          y2={100}
          className="scope-line pane"
        />
      ))}
    </svg>
  )
}

function Labels({ top }: { top: number }): React.JSX.Element {
  return (
    <div className="scope-labels" aria-hidden>
      {levelsOf(top)
        // Black, the middle and white; above white only its top, so a short scope stays legible.
        .filter((r) => ['0', '512', '1023'].includes(r.label) || r.at === top)
        .map((r) => (
          <span key={r.label} style={{ bottom: `${(r.at / top) * 100}%` }}>
            {r.label}
          </span>
        ))}
    </div>
  )
}

export function WaveformScope({
  bins,
  mode
}: {
  bins: ScopeBins | null
  mode: 'luma' | 'rgb'
}): React.JSX.Element {
  const w = bins?.columns ?? 1
  const h = bins?.levels ?? 1
  const ref = useDensityCanvas(
    w,
    h,
    bins
      ? (out) => {
          if (mode === 'luma' && bins.waveform)
            paintDensity(out, bins.waveform, w, h, LUMA, { flip: true })
          else if (bins.parade) {
            const plane = w * h
            paintDensity(out, bins.parade, w, h, RED, { flip: true, gain: 0.8 })
            paintDensity(out, bins.parade, w, h, GREEN, { offset: plane, flip: true, gain: 0.8 })
            paintDensity(out, bins.parade, w, h, BLUE, { offset: 2 * plane, flip: true, gain: 0.8 })
          }
        }
      : null
  )
  return (
    <div className="scope-plot waveform" role="img" aria-label={t('Waveform')}>
      <canvas ref={ref} />
      <Graticule top={bins?.top ?? 1} />
      <Labels top={bins?.top ?? 1} />
    </div>
  )
}

export function ParadeScope({ bins }: { bins: ScopeBins | null }): React.JSX.Element {
  const cols = bins?.columns ?? 1
  const h = bins?.levels ?? 1
  const ref = useDensityCanvas(
    cols * 3,
    h,
    bins?.parade
      ? (out) => {
          // Each channel's columns in its own third, side by side.
          const plane = cols * h
          const one = new Uint8ClampedArray(cols * h * 4)
          ;[RED, GREEN, BLUE].forEach((colour, k) => {
            one.fill(0)
            paintDensity(one, bins.parade!, cols, h, colour, { offset: k * plane, flip: true })
            for (let y = 0; y < h; y++)
              out.set(one.subarray(y * cols * 4, (y + 1) * cols * 4), (y * cols * 3 + k * cols) * 4)
          })
        }
      : null
  )
  return (
    <div className="scope-plot parade" role="img" aria-label={t('RGB parade')}>
      <canvas ref={ref} />
      <Graticule top={bins?.top ?? 1} panes={3} />
      <Labels top={bins?.top ?? 1} />
    </div>
  )
}

export function VectorScope({
  bins,
  zoom,
  skinLine
}: {
  bins: ScopeBins | null
  zoom: 1 | 2
  skinLine: boolean
}): React.JSX.Element {
  const n = bins?.vectorSize ?? 1
  const ref = useDensityCanvas(
    n,
    n,
    bins?.vector
      ? (out) => {
          if (zoom === 1) return paintDensity(out, bins.vector!, n, n, LUMA, { gain: 1.1 })
          // 2×: the middle half of the bins, each drawn twice the size.
          const half = new Uint32Array(n * n)
          for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++)
              half[y * n + x] = bins.vector![(n / 4 + (y >> 1)) * n + n / 4 + (x >> 1)]
          paintDensity(out, half, n, n, LUMA, { gain: 1.1 })
        }
      : null
  )
  // Cb/Cr ±0.5 fill the circle at 1×; 2× shows ±0.25.
  const r = 48 * zoom
  const at = (cb: number, cr: number): { x: number; y: number } => ({
    x: 50 + (cb / 0.5) * r,
    y: 50 - (cr / 0.5) * r
  })
  return (
    <div className="scope-plot vector" role="img" aria-label={t('Vectorscope')}>
      <canvas ref={ref} />
      <svg className="scope-grid" viewBox="0 0 100 100" aria-hidden>
        <circle cx={50} cy={50} r={48} className="scope-line" fill="none" />
        <circle cx={50} cy={50} r={24} className="scope-line" fill="none" />
        <line x1={2} x2={98} y1={50} y2={50} className="scope-line" />
        <line x1={50} x2={50} y1={2} y2={98} className="scope-line" />
        {skinLine && (
          <line
            x1={50}
            y1={50}
            x2={50 + Math.cos(SKIN_LINE) * 48}
            y2={50 - Math.sin(SKIN_LINE) * 48}
            className="scope-skin"
          />
        )}
        {vectorTargets().map((tg) => {
          const p = at(tg.cb, tg.cr)
          if (Math.hypot(p.x - 50, p.y - 50) > 49) return null
          return (
            <g key={tg.name}>
              <rect x={p.x - 2.5} y={p.y - 2.5} width={5} height={5} className="scope-target" />
              <text x={p.x + 4} y={p.y - 3} className="scope-target-label">
                {tg.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
