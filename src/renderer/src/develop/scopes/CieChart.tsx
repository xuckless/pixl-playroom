/**
 * The CIE 1976 u′v′ chromaticity chart. The spectral locus is painted in its
 * own colours and PixlRGB, the engine's working space, frames the chart and is
 * always drawn: its primaries enclose the whole locus. The Reference tab lays
 * the other gamuts over it (off until chosen).
 *
 * The photo's own chromaticity (its cloud and hull, before and after) needs
 * the engine to measure it, which Playroom has asked for (TODO.md, ENGINE
 * REQUEST: u′v′ and gamut coverage metrics); until then the Image tab shows
 * the chart and says so, and draws nothing that is not measured.
 */
import { useEffect, useRef, useState } from 'react'
import {
  PIXLRGB,
  REFERENCE_GAMUTS,
  SPECTRAL_LOCUS,
  WHITE_POINT,
  chartBounds,
  gamutPoints,
  uvToRgb,
  type Gamut,
  type Uv
} from '../../../../shared/cie'
import { t } from '../../lib/i18n'

const SIZE = 560
const B = chartBounds()
const px = (p: Uv): { x: number; y: number } => ({
  x: ((p.u - B.u0) / (B.u1 - B.u0)) * SIZE,
  y: (1 - (p.v - B.v0) / (B.v1 - B.v0)) * SIZE
})
const path = (pts: Uv[], close = true): string =>
  pts
    .map((p, i) => {
      const { x, y } = px(p)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ') + (close ? ' Z' : '')

const GAMUT_COLOUR: Record<Gamut['id'], string> = {
  pixlrgb: '#ffffff',
  srgb: '#e8e6f2',
  p3: '#69c3ff',
  adobe: '#ffb458',
  rec2020: '#c79bff'
}

/** The horseshoe: every chromaticity inside the locus, painted in its colour, dimmed. */
function paintHorseshoe(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const n = 280
  const off = document.createElement('canvas')
  off.width = n
  off.height = n
  const octx = off.getContext('2d')
  if (!octx) return
  const img = octx.createImageData(n, n)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const u = B.u0 + ((i + 0.5) / n) * (B.u1 - B.u0)
      const v = B.v0 + (1 - (j + 0.5) / n) * (B.v1 - B.v0)
      const [r, g, b] = uvToRgb(u, v)
      const k = (j * n + i) * 4
      img.data[k] = r
      img.data[k + 1] = g
      img.data[k + 2] = b
      img.data[k + 3] = 255
    }
  octx.putImageData(img, 0, 0)
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.save()
  ctx.beginPath()
  SPECTRAL_LOCUS.forEach((p, i) => {
    const { x, y } = px(p)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.clip()
  ctx.globalAlpha = 0.5
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(off, 0, 0, SIZE, SIZE)
  ctx.restore()
}

type Sub = 'image' | 'reference'

export function CieChart(): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [sub, setSub] = useState<Sub>('image')
  const [shown, setShown] = useState<Set<Gamut['id']>>(new Set())
  useEffect(() => {
    if (canvas.current) paintHorseshoe(canvas.current)
  }, [])
  const grid: number[] = []
  for (let g = Math.ceil(B.u0 * 10) / 10; g <= B.u1; g += 0.1) grid.push(Math.round(g * 10) / 10)
  const gridV: number[] = []
  for (let g = Math.ceil(B.v0 * 10) / 10; g <= B.v1; g += 0.1) gridV.push(Math.round(g * 10) / 10)
  const white = px(WHITE_POINT)
  const toggle = (id: Gamut['id']): void =>
    setShown((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="cie">
      <div className="cie-side">
        <div className="seg" role="group" aria-label={t('Chart contents')}>
          <button className={sub === 'image' ? 'on' : ''} onClick={() => setSub('image')}>
            {t('Image')}
          </button>
          <button className={sub === 'reference' ? 'on' : ''} onClick={() => setSub('reference')}>
            {t('Reference')}
          </button>
        </div>
        {sub === 'image' ? (
          <>
            <div
              className="seg cie-ba"
              role="group"
              aria-label={t('Before or after')}
              title={t('Waiting for the engine')}
            >
              <button disabled>{t('Before')}</button>
              <button disabled className="on">
                {t('After')}
              </button>
            </div>
            <label className="check">
              <input type="checkbox" disabled /> {t('Before as a ghost')}
            </label>
            <label className="check">
              <input type="checkbox" disabled /> {t('The photo’s hull')}
            </label>
            <p className="cie-note">
              {t(
                'The photo’s own colours will plot here once the engine reports them in u′v′. Playroom has asked for that, and for how much of the photo each gamut covers; nothing is estimated in the meantime.'
              )}
            </p>
          </>
        ) : (
          <>
            <p className="micro">{t('Lay over the chart')}</p>
            {REFERENCE_GAMUTS.map((g) => (
              <label key={g.id} className="check">
                <input type="checkbox" checked={shown.has(g.id)} onChange={() => toggle(g.id)} />{' '}
                <span className="cie-key" style={{ background: GAMUT_COLOUR[g.id] }} />
                {g.name}
              </label>
            ))}
            <p className="cie-note">
              {t(
                'PixlRGB is always drawn: its primaries enclose the whole visible range, so it is the chart’s frame. Rec.2020 and Display P3 reach beyond sRGB; the horseshoe is every colour the eye sees.'
              )}
            </p>
          </>
        )}
      </div>
      <figure className="cie-plot">
        <canvas ref={canvas} width={SIZE} height={SIZE} aria-hidden />
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={t('CIE 1976 u′v′ chromaticity chart')}
        >
          {grid.map((u) => (
            <g key={`u${u}`}>
              <line
                x1={px({ u, v: 0 }).x}
                x2={px({ u, v: 0 }).x}
                y1={0}
                y2={SIZE}
                className="cie-grid"
              />
              <text x={px({ u, v: 0 }).x + 3} y={SIZE - 4} className="cie-axis">
                {u.toFixed(1)}
              </text>
            </g>
          ))}
          {gridV.map((v) => (
            <g key={`v${v}`}>
              <line
                x1={0}
                x2={SIZE}
                y1={px({ u: 0, v }).y}
                y2={px({ u: 0, v }).y}
                className="cie-grid"
              />
              <text x={4} y={px({ u: 0, v }).y - 3} className="cie-axis">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          <path d={path(SPECTRAL_LOCUS)} className="cie-locus" />
          {sub === 'reference' &&
            REFERENCE_GAMUTS.filter((g) => shown.has(g.id)).map((g) => (
              <g key={g.id}>
                <path
                  d={path(gamutPoints(g))}
                  fill="none"
                  stroke={GAMUT_COLOUR[g.id]}
                  strokeWidth={1.4}
                />
                {gamutPoints(g).map((p, i) => (
                  <circle key={i} cx={px(p).x} cy={px(p).y} r={3} fill={GAMUT_COLOUR[g.id]} />
                ))}
              </g>
            ))}
          <path d={path(gamutPoints(PIXLRGB))} className="cie-frame" />
          <g>
            <line
              x1={white.x - 6}
              x2={white.x + 6}
              y1={white.y}
              y2={white.y}
              className="cie-white"
            />
            <line
              x1={white.x}
              x2={white.x}
              y1={white.y - 6}
              y2={white.y + 6}
              className="cie-white"
            />
            <text x={white.x + 9} y={white.y - 6} className="cie-axis">
              D65
            </text>
          </g>
          <text x={SIZE - 8} y={18} textAnchor="end" className="cie-axis">
            u′ → v′ ↑ · {t('PixlRGB frame')}
          </text>
        </svg>
      </figure>
    </div>
  )
}
