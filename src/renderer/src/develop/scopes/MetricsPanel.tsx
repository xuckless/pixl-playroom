/**
 * The expanded scope's numbers, before and after, and the accessibility
 * views: how the photo's tone and colour measure (range, contrast, clipping,
 * cast), how a person with a colour-vision deficiency would see it and which
 * hues would fall together, and its dominant colours with their values.
 * Gamut coverage needs the engine to measure it (TODO.md, ENGINE REQUEST) and
 * is shown as waiting.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ImageStats } from '../../../../shared/engine-types'
import { dominantColours, type Swatch as SwatchData } from '../../../../shared/palette'
import {
  VISION_LABEL,
  collidingHues,
  contrastVerdict,
  hueShares,
  scopeMetrics,
  simulateVision,
  visionFilterValues,
  type ScopeMetrics,
  type VisionKind
} from '../../../../shared/scopemetrics'
import { bandOfHue } from '../../lib/helpers'

const KINDS: VisionKind[] = ['protan', 'deutan', 'tritan']

const pct = (v: number): string => `${(v * 100).toFixed(v > 0 && v < 0.0005 ? 3 : 2)}%`
const stops = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)} stops`)
const ratio = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}:1`)

/** One row of the before/after table. */
function Row({
  label,
  now,
  then,
  note
}: {
  label: string
  now: string
  then?: string
  note?: string
}): React.JSX.Element {
  return (
    <tr>
      <th>{label}</th>
      <td>{now}</td>
      {then !== undefined && <td className="muted">{then}</td>}
      {note !== undefined && <td className="muted small">{note}</td>}
    </tr>
  )
}

export function MetricsPanel({
  stats,
  hdr,
  before,
  pictureUrl
}: {
  stats: ImageStats | null
  hdr: ImageStats | null
  before: ImageStats | null
  pictureUrl: string | null
}): React.JSX.Element {
  const [vision, setVision] = useState<VisionKind | null>(null)
  const now: ScopeMetrics | null = useMemo(() => (stats ? scopeMetrics(stats) : null), [stats])
  const then: ScopeMetrics | null = useMemo(() => (before ? scopeMetrics(before) : null), [before])
  const hues = useMemo(() => hueShares(stats), [stats])
  const collisions = useMemo(
    () => KINDS.map((k) => ({ kind: k, pairs: collidingHues(hues, k) })),
    [hues]
  )
  const palette = usePalette(pictureUrl)
  if (!now) return <p className="muted">Nothing measured yet.</p>
  const b = then !== null
  const name = (h: number): string => bandOfHue(h)

  return (
    <div className="metrics">
      <section className="metrics-card">
        <h4>Tone &amp; contrast</h4>
        <table>
          <thead>
            <tr>
              <th />
              <th>Now</th>
              {b && <th>Before</th>}
            </tr>
          </thead>
          <tbody>
            <Row
              label="Dynamic range"
              now={stops(now.rangeStops)}
              then={b ? stops(then.rangeStops) : undefined}
            />
            <Row
              label="Contrast (shadows to highlights)"
              now={
                now.contrast === null
                  ? '—'
                  : `${ratio(now.contrast)} · ${contrastVerdict(now.contrast)}`
              }
              then={
                b
                  ? then.contrast === null
                    ? '—'
                    : `${ratio(then.contrast)} · ${contrastVerdict(then.contrast)}`
                  : undefined
              }
            />
            <Row
              label="Mean brightness"
              now={now.meanLuma.toFixed(3)}
              then={b ? then.meanLuma.toFixed(3) : undefined}
            />
            <Row
              label="Spread"
              now={now.spread.toFixed(3)}
              then={b ? then.spread.toFixed(3) : undefined}
            />
            <Row
              label="Shadows clipped"
              now={pct(now.lowClip)}
              then={b ? pct(then.lowClip) : undefined}
            />
            <Row
              label="Highlights clipped"
              now={pct(now.highClip)}
              then={b ? pct(then.highClip) : undefined}
            />
            {hdr && (
              <Row
                label="HDR headroom"
                now={`+${Math.log2(Math.max(1, hdr.range_max)).toFixed(1)} EV`}
              />
            )}
          </tbody>
        </table>
        <p className="muted small">
          Contrast is the WCAG ratio between the 10% and 90% points of brightness; 4.5:1 and up
          reads as clearly separated.
        </p>
      </section>

      <div className="metrics-col">
        <section className="metrics-card">
          <h4>Colour</h4>
          <table>
            <thead>
              <tr>
                <th />
                <th>Now</th>
                {b && <th>Before</th>}
              </tr>
            </thead>
            <tbody>
              <Row
                label="Mean saturation"
                now={now.meanSaturation.toFixed(2)}
                then={b ? then.meanSaturation.toFixed(2) : undefined}
              />
              <Row label="Cast" now={castText(now)} then={b ? castText(then) : undefined} />
              {['Red', 'Green', 'Blue'].map((c, i) => (
                <Row
                  key={c}
                  label={`${c} mean`}
                  now={now.channelMeans[i]?.toFixed(3) ?? '—'}
                  then={b ? (then.channelMeans[i]?.toFixed(3) ?? '—') : undefined}
                />
              ))}
            </tbody>
          </table>
        </section>

        <section className="metrics-card wait">
          <h4>Gamut coverage</h4>
          <table>
            <tbody>
              {['sRGB', 'Display P3', 'Rec.2020', 'PixlRGB', 'Outside the visible range'].map(
                (g) => (
                  <Row key={g} label={g} now="—" />
                )
              )}
            </tbody>
          </table>
          <p className="muted small">
            Waiting for the engine: how much of the photo each space holds needs its own
            measurement, which Playroom has asked for.
          </p>
        </section>
      </div>

      <section className="metrics-card wide">
        <h4>Colour vision</h4>
        <div className="seg" role="group" aria-label="How it looks to">
          <button className={vision === null ? 'on' : ''} onClick={() => setVision(null)}>
            Normal
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              className={vision === k ? 'on' : ''}
              onClick={() => setVision(k)}
              title={VISION_LABEL[k]}
            >
              {k === 'protan' ? 'Protan' : k === 'deutan' ? 'Deutan' : 'Tritan'}
            </button>
          ))}
        </div>
        <svg width="0" height="0" aria-hidden className="cvd-defs">
          {KINDS.map((k) => (
            <filter key={k} id={`cvd-${k}`} colorInterpolationFilters="linearRGB">
              <feColorMatrix type="matrix" values={visionFilterValues(k)} />
            </filter>
          ))}
        </svg>
        <div className="cvd-body">
          {pictureUrl ? (
            <img
              className="cvd-picture"
              src={pictureUrl}
              alt={vision ? `The photo as ${VISION_LABEL[vision]} sees it` : 'The photo'}
              style={vision ? { filter: `url(#cvd-${vision})` } : undefined}
              draggable={false}
            />
          ) : (
            <p className="muted small">No picture yet.</p>
          )}
          <div className="cvd-notes">
            {collisions.every((c) => c.pairs.length === 0) ? (
              <p className="small">
                No hues in this photo fall together for protan, deutan or tritan viewers.
              </p>
            ) : (
              collisions
                .filter((c) => c.pairs.length > 0)
                .map((c) => (
                  <div key={c.kind}>
                    <span className="micro">{VISION_LABEL[c.kind]}</span>
                    <ul>
                      {c.pairs.map((p, i) => (
                        <li key={i}>
                          <span className="cvd-dots" aria-hidden>
                            <i style={{ background: `rgb(${p.a.rgb.join(' ')})` }} />
                            <i style={{ background: `rgb(${p.b.rgb.join(' ')})` }} />
                          </span>
                          {name((p.a.start + p.a.end) / 2)} ({Math.round(p.a.start)}–
                          {Math.round(p.a.end)}°) and {name((p.b.start + p.b.end) / 2)} (
                          {Math.round(p.b.start)}–{Math.round(p.b.end)}°) look alike
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
            )}
            <p className="muted small">
              Simulated with Machado et al. (2009) at full severity. Where two hues fall together,
              keep the difference in brightness or add a label.
            </p>
          </div>
        </div>
      </section>

      <section className="metrics-card wide">
        <h4>Dominant colours</h4>
        {palette.length === 0 ? (
          <p className="muted small">{pictureUrl ? 'Reading the photo…' : 'No picture yet.'}</p>
        ) : (
          <>
            <ul className="palette">
              {palette.map((s) => (
                <Swatch key={s.hex} s={s} vision={vision} />
              ))}
            </ul>
            <div className="palette-actions">
              <button
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    palette
                      .map(
                        (s) =>
                          `${s.hex}  Lab ${s.lab.map((v) => v.toFixed(1)).join(' ')}  ${(s.share * 100).toFixed(1)}%`
                      )
                      .join('\n')
                  )
                }
              >
                Copy all
              </button>
              <span className="muted small">Click a swatch to copy its hex.</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function castText(m: ScopeMetrics): string {
  return m.cast.label === 'neutral' ? 'Neutral' : `${m.cast.amount}% ${m.cast.label}`
}

function Swatch({ s, vision }: { s: SwatchData; vision: VisionKind | null }): React.JSX.Element {
  const seen = vision ? simulateVision(s.rgb, vision) : null
  const [copied, setCopied] = useState(false)
  return (
    <li>
      <button
        className="swatch"
        title={`Copy ${s.hex}`}
        onClick={() => {
          void navigator.clipboard?.writeText(s.hex)
          setCopied(true)
          setTimeout(() => setCopied(false), 900)
        }}
      >
        <span className="swatch-chip" style={{ background: s.hex }}>
          {seen && (
            <i style={{ background: `rgb(${seen.join(' ')})` }} title="As this viewer sees it" />
          )}
        </span>
        <span className="swatch-hex">{copied ? 'Copied' : s.hex}</span>
        <span className="muted small">
          L {s.lab[0].toFixed(0)} a {s.lab[1].toFixed(0)} b {s.lab[2].toFixed(0)}
        </span>
        <span className="muted small">{(s.share * 100).toFixed(1)}%</span>
      </button>
    </li>
  )
}

/** The photo's dominant colours, from the picture on screen, shrunk to a small sample. */
function usePalette(url: string | null): SwatchData[] {
  const [palette, setPalette] = useState<SwatchData[]>([])
  useEffect(() => {
    if (!url) return
    let live = true
    void (async () => {
      try {
        const bmp = await createImageBitmap(await (await fetch(url)).blob())
        const k = Math.min(1, 96 / Math.max(bmp.width, bmp.height))
        const w = Math.max(1, Math.round(bmp.width * k))
        const h = Math.max(1, Math.round(bmp.height * k))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(bmp, 0, 0, w, h)
        bmp.close()
        const sw = dominantColours(ctx.getImageData(0, 0, w, h).data, 6)
        if (live) setPalette(sw)
      } catch {
        // Unreadable: no palette, the rest of the tab stands.
      }
    })()
    return () => {
      live = false
    }
  }, [url])
  return palette
}
