/**
 * The expanded histogram: every channel of what the engine measured, as an
 * overlay, a parade (one panel each, as a colourist's scopes lay them out), a
 * single channel or luma, on a scale with labels, with the numbers under it:
 * each channel's mean and clipping, and the luma's percentiles. For a PQ/HLG
 * photo it can draw the HDR measurement in stops.
 */
import { useMemo, useState } from 'react'
import type { ImageStats } from '../../../../shared/engine-types'
import { HDR_FLOOR_STOPS, stopsBins, stopsX } from '../../../../shared/scopes'
import { areaPath } from '../../components/charts'

type Mode = 'overlay' | 'parade' | 'red' | 'green' | 'blue' | 'luma'

const MODES: { value: Mode; label: string }[] = [
  { value: 'overlay', label: 'Overlay' },
  { value: 'parade', label: 'Parade' },
  { value: 'red', label: 'R' },
  { value: 'green', label: 'G' },
  { value: 'blue', label: 'B' },
  { value: 'luma', label: 'Luma' }
]

const COLOURS = ['#ff5a6e', '#5ee08a', '#6d8cff']
const NAMES = ['Red', 'Green', 'Blue']
const W = 900
const H = 300

/** Where the readings are taken from: the screen measurement, or the HDR one in stops. */
interface Source {
  stats: ImageStats
  hdr: boolean
}

function seriesOf(src: Source): { chans: number[][]; luma: number[] } {
  const { stats, hdr } = src
  const bin = (c: number[]): number[] => (hdr ? stopsBins(c, stats.range_max) : c)
  return {
    chans: stats.histograms.slice(0, 3).map((x) => bin(x.counts)),
    luma: bin(stats.luma_histogram.counts)
  }
}

/** The tallest bar, leaving out the end bins: a clipped end would flatten the rest. */
const inner = (c: number[]): number => Math.max(1, ...c.slice(1, -1))

const pct = (v: number): string => `${(v * 100).toFixed(v > 0 && v < 0.0005 ? 3 : 2)}%`

export function BigHistogram({
  stats,
  hdr,
  before,
  clipping,
  onClipping
}: {
  stats: ImageStats | null
  hdr: ImageStats | null
  before: ImageStats | null
  clipping: boolean
  onClipping: (on: boolean) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('overlay')
  const [log, setLog] = useState(true)
  const [ghost, setGhost] = useState(true)
  const [wantHdr, setWantHdr] = useState(true)
  const showHdr = wantHdr && hdr !== null
  const now: Source | null = showHdr
    ? { stats: hdr, hdr: true }
    : stats
      ? { stats, hdr: false }
      : null
  // The ungraded picture is measured on the screen scale only.
  const then: Source | null = !showHdr && ghost && before ? { stats: before, hdr: false } : null

  const chart = useMemo(() => {
    if (!now) return null
    const a = seriesOf(now)
    const b = then ? seriesOf(then) : null
    const all = [...a.chans, a.luma, ...(b ? [...b.chans, b.luma] : [])]
    const max = Math.max(...all.map(inner))
    return { a, b, max }
  }, [now, then])

  if (!now || !chart) return <p className="muted">Nothing measured yet.</p>
  const { stats: shown } = now
  const { a, b, max } = chart
  const top = Math.log2(Math.max(shown.range_max, 1))
  const whiteX = now.hdr ? stopsX(1, shown.range_max) : null

  /** The series drawn in a panel `x0 … x0 + w` wide. */
  const panel = (
    key: string,
    series: { counts: number[]; colour: string; ghost?: boolean; line?: boolean }[],
    x0: number,
    w: number
  ): React.JSX.Element => (
    <g key={key} transform={`translate(${x0} 0)`}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={f * w} x2={f * w} y1={0} y2={H} className="bh-grid" />
      ))}
      <g style={{ mixBlendMode: 'screen' }}>
        {series.map((s, i) =>
          s.line ? (
            <path
              key={i}
              d={areaPath(s.counts, w, H, max, log)}
              fill="none"
              stroke={s.colour}
              strokeOpacity={s.ghost ? 0.4 : 0.8}
              strokeWidth={s.ghost ? 1 : 1.4}
              strokeDasharray={s.ghost ? '4 3' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <path
              key={i}
              d={areaPath(s.counts, w, H, max, log)}
              fill={s.colour}
              fillOpacity={0.5}
            />
          )
        )}
      </g>
    </g>
  )

  const drawn: React.JSX.Element[] = []
  const ghostOf = (
    i: number
  ): { counts: number[]; colour: string; ghost: boolean; line: boolean }[] =>
    b ? [{ counts: b.chans[i], colour: COLOURS[i], ghost: true, line: true }] : []
  if (mode === 'overlay') {
    drawn.push(
      panel(
        'o',
        [
          ...a.chans.map((c, i) => ({ counts: c, colour: COLOURS[i] })),
          { counts: a.luma, colour: '#ebe9f3', line: true },
          ...(b ? [{ counts: b.luma, colour: '#ebe9f3', ghost: true, line: true }] : [])
        ],
        0,
        W
      )
    )
  } else if (mode === 'parade') {
    const gap = 14
    const w = (W - gap * 2) / 3
    a.chans.forEach((c, i) =>
      drawn.push(
        panel(`p${i}`, [{ counts: c, colour: COLOURS[i] }, ...ghostOf(i)], i * (w + gap), w)
      )
    )
  } else if (mode === 'luma') {
    drawn.push(
      panel(
        'l',
        [
          { counts: a.luma, colour: '#ebe9f3' },
          ...(b ? [{ counts: b.luma, colour: '#ebe9f3', ghost: true, line: true }] : [])
        ],
        0,
        W
      )
    )
  } else {
    const i = mode === 'red' ? 0 : mode === 'green' ? 1 : 2
    drawn.push(panel(mode, [{ counts: a.chans[i], colour: COLOURS[i] }, ...ghostOf(i)], 0, W))
  }

  // The scale under the chart: percent of the range, or stops with white marked.
  const ticks: { x: number; label: string }[] = now.hdr
    ? Array.from({ length: Math.floor(top - HDR_FLOOR_STOPS) + 1 }, (_, k) => HDR_FLOOR_STOPS + k)
        .filter((s) => s % 2 === 0)
        .map((s) => ({
          x: ((s - HDR_FLOOR_STOPS) / (top - HDR_FLOOR_STOPS)) * 100,
          label: `${s > 0 ? '+' : ''}${s}`
        }))
    : [0, 25, 50, 75, 100].map((p) => ({
        x: p,
        label: p === 0 ? '0' : p === 100 ? '100%' : `${p}%`
      }))
  const paradeLabels = mode === 'parade'

  return (
    <div className="big-histogram">
      <div className="bh-bar">
        <div className="seg" role="group" aria-label="Channels">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={mode === m.value ? 'on' : ''}
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log
        </label>
        {before && !showHdr && (
          <label className="check">
            <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />{' '}
            Before
          </label>
        )}
        {hdr && (
          <label className="check" title="The graded photo as an HDR export holds it, in stops">
            <input
              type="checkbox"
              checked={wantHdr}
              onChange={(e) => setWantHdr(e.target.checked)}
            />{' '}
            HDR (stops)
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={clipping}
            onChange={(e) => onClipping(e.target.checked)}
          />{' '}
          Show clipping on the photo
        </label>
      </div>
      <div className="bh-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Histogram">
          {whiteX !== null && (
            <rect className="hdr-headroom" x={whiteX * W} y={0} width={W - whiteX * W} height={H} />
          )}
          {drawn}
          {whiteX !== null && (
            <line className="hdr-white" x1={whiteX * W} x2={whiteX * W} y1={0} y2={H} />
          )}
        </svg>
        {paradeLabels && (
          <div className="bh-parade-names" aria-hidden>
            {NAMES.map((n, i) => (
              <span key={n} style={{ color: COLOURS[i] }}>
                {n}
              </span>
            ))}
          </div>
        )}
        <div className="bh-scale" aria-hidden>
          {mode === 'parade'
            ? null
            : ticks.map((t) => (
                <span key={t.label} style={{ left: `${t.x}%` }}>
                  {t.label}
                </span>
              ))}
        </div>
      </div>
      {now.hdr && (
        <p className="muted small">
          Stops from reference white (203 nits); everything right of the line is headroom, up to the
          photo’s peak (+{top.toFixed(1)} EV).
        </p>
      )}
      <table className="bh-table">
        <thead>
          <tr>
            <th />
            <th>Mean</th>
            <th>Clipped low</th>
            <th>Clipped high</th>
          </tr>
        </thead>
        <tbody>
          {shown.histograms.slice(0, 3).map((_, i) => (
            <tr key={i}>
              <th style={{ color: COLOURS[i] }}>{NAMES[i]}</th>
              <td>{shown.channel_mean[i]?.toFixed(3)}</td>
              <td className={shown.clipped_low[i] > 0.001 ? 'hot' : ''}>
                {pct(shown.clipped_low[i] ?? 0)}
              </td>
              <td className={shown.clipped_high[i] > 0.001 ? 'hot' : ''}>
                {pct(shown.clipped_high[i] ?? 0)}
              </td>
            </tr>
          ))}
          <tr>
            <th>Luma</th>
            <td>{shown.luma_mean.toFixed(3)}</td>
            <td colSpan={2} className="muted">
              spread {shown.luma_stddev.toFixed(3)}
            </td>
          </tr>
        </tbody>
      </table>
      {shown.luma_percentiles.length > 0 && (
        <div className="bh-percentiles">
          <span className="micro">Luma percentiles</span>
          {[...shown.luma_percentiles]
            .sort((x, y) => x.percentile - y.percentile)
            .map((p) => (
              <span key={p.percentile}>
                <em>{p.percentile}%</em> {p.value.toFixed(3)}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
