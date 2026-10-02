import { useMemo, useState } from 'react'
import type { HueBin, ImageStats } from '../../../shared/engine-types'
import type { HslBand } from '../../../shared/recipe'
import { stopsBins, stopsX } from '../../../shared/scopes'
import { withKey } from '../lib/commands'
import { bandOfHue } from '../lib/helpers'
import { InfoTip, type Tip } from './InfoTip'
import { TechInfo } from './TechInfo'

const HISTOGRAM_TIP = (log: boolean): Tip => ({
  what: 'How much of the photo sits at each brightness, shadows on the left, highlights on the right.',
  expect:
    'The corner triangles light up when shadows or highlights clip; click one to see where on the photo.',
  tip: `Double-click to switch to a ${log ? 'linear' : 'log'} scale (now ${log ? 'log' : 'linear'}).`
})

const HUE_TIP: Tip = {
  what: 'How much of each colour the photo holds; the faint bars are the photo before your edits.',
  expect: 'Click a bar to open that colour in the Colour mixer.',
  tip: 'Shift-click a bar to make a mask of that colour.'
}

function areaPath(counts: number[], w: number, h: number, max: number, log: boolean): string {
  const n = counts.length
  if (n === 0) return ''
  const scale = (c: number): number => (log ? Math.log1p(c) / Math.log1p(max) : c / max)
  const pts = counts.map(
    (c, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - scale(c) * (h - 2)).toFixed(1)}`
  )
  return `M0,${h} L${pts.join(' L')} L${w},${h} Z`
}

/**
 * The histogram of what is on screen: red, green and blue added together
 * where they overlap, luma as a line, clipping marked at both ends. Clicking
 * a clipping marker toggles the clipping overlay.
 *
 * For a PQ/HLG photo `hdr` is the graded picture as an HDR export holds it;
 * the HDR chip switches to it, drawn in stops with reference white marked and
 * the headroom above it shaded.
 */
export function Histogram({
  stats,
  hdr = null,
  clipping,
  onClipping
}: {
  stats: ImageStats | null
  hdr?: ImageStats | null
  clipping: boolean
  onClipping: (on: boolean) => void
}): React.JSX.Element {
  const [log, setLog] = useState(true)
  const [wantHdr, setWantHdr] = useState(true)
  const showHdr = wantHdr && hdr !== null
  const shown = showHdr ? hdr : stats
  const w = 300
  const h = 110
  // Reference white on the stops axis; everything right of it is headroom.
  const whiteX = showHdr ? stopsX(1, hdr.range_max) * w : null
  const content = useMemo(() => {
    if (!shown) return null
    const bin = (c: number[]): number[] => (showHdr ? stopsBins(c, shown.range_max) : c)
    const chans = shown.histograms.slice(0, 3).map((x) => bin(x.counts))
    const luma = bin(shown.luma_histogram.counts)
    // Ignore the end bins when scaling: a clipped end would flatten the rest.
    const inner = (c: number[]): number => Math.max(1, ...c.slice(1, -1))
    const max = Math.max(...chans.map(inner), inner(luma))
    const colours = ['#ff5a6e', '#5ee08a', '#6d8cff']
    return (
      <>
        <g style={{ mixBlendMode: 'screen' }}>
          {chans.map((c, i) => (
            <path key={i} d={areaPath(c, w, h, max, log)} fill={colours[i]} fillOpacity={0.55} />
          ))}
        </g>
        <path
          d={areaPath(luma, w, h, max, log)}
          fill="none"
          stroke="#ebe9f3"
          strokeOpacity={0.55}
          strokeWidth={1}
        />
      </>
    )
  }, [shown, showHdr, log])
  const lowClip = shown ? Math.max(...shown.clipped_low) : 0
  const highClip = shown ? Math.max(...shown.clipped_high) : 0
  const peak = hdr ? hdr.range_max : 1
  return (
    <div className="histogram-box">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="histogram"
        onDoubleClick={() => setLog(!log)}
      >
        {whiteX !== null && (
          <rect className="hdr-headroom" x={whiteX} y={0} width={w - whiteX} height={h} />
        )}
        {(whiteX === null ? [0.25, 0.5, 0.75] : []).map((f) => (
          <line key={f} x1={f * w} x2={f * w} y1={0} y2={h} stroke="rgba(255,255,255,0.06)" />
        ))}
        {content}
        {whiteX !== null && <line className="hdr-white" x1={whiteX} x2={whiteX} y1={0} y2={h} />}
      </svg>
      <button
        className={`clip-marker low ${lowClip > 0.001 ? 'hot' : ''} ${clipping ? 'on' : ''}`}
        title={withKey(
          `Shadows clipped: ${(lowClip * 100).toFixed(2)}% — click to show`,
          'view.clipping'
        )}
        onClick={() => onClipping(!clipping)}
      >
        ◣
      </button>
      <button
        className={`clip-marker high ${highClip > 0.001 ? 'hot' : ''} ${clipping ? 'on' : ''}`}
        title={
          showHdr
            ? withKey(
                `Above the ${peak.toFixed(1)}× peak: ${(highClip * 100).toFixed(2)}% — click to show`,
                'view.clipping'
              )
            : withKey(
                `Highlights clipped: ${(highClip * 100).toFixed(2)}% — click to show`,
                'view.clipping'
              )
        }
        onClick={() => onClipping(!clipping)}
      >
        ◢
      </button>
      {shown && (
        <div className="histogram-foot">
          {showHdr ? (
            <span title="Headroom above reference white (203 nits) up to the photo's peak">
              +{Math.log2(peak).toFixed(1)} EV headroom
            </span>
          ) : (
            <TechInfo title="Histogram numbers" align="left">
              <p>
                Mean brightness {shown.luma_mean.toFixed(3)} · spread {shown.luma_stddev.toFixed(3)}{' '}
                · mean saturation {shown.mean_saturation.toFixed(2)}
              </p>
              <p className="muted">On encoded values, 0 to 1.</p>
            </TechInfo>
          )}
          {hdr && (
            <button
              className={`hdr-chip${showHdr ? ' on' : ''}`}
              aria-pressed={showHdr}
              title={
                showHdr
                  ? 'HDR: the graded photo as an HDR export holds it, in stops. Click for the screen (SDR) view.'
                  : 'Show the HDR histogram'
              }
              onClick={() => setWantHdr(!showHdr)}
            >
              HDR
            </button>
          )}
          <span className="spacer" />
          <InfoTip tip={HISTOGRAM_TIP(log)} label="Histogram" />
        </div>
      )}
    </div>
  )
}

interface Shares {
  bins: { bin: HueBin; share: number }[]
  neutral: number
}

function shares(stats: ImageStats | null | undefined): Shares | null {
  if (!stats || stats.hue_histogram.length === 0) return null
  const total = Math.max(
    1,
    stats.hue_histogram.reduce((a, b) => a + b.count, 0) + stats.neutral_pixels
  )
  return {
    bins: stats.hue_histogram.map((bin) => ({ bin, share: bin.count / total })),
    neutral: stats.neutral_pixels / total
  }
}

/**
 * Colour concentration: one bar per 10° of hue, each coloured by its hue and
 * saturation and as tall as its share of the picture; the ungraded picture's
 * bars sit behind as a ghost, so the shift a grade caused shows at a glance.
 * With a mask selected, the chart can measure inside the mask only. A click
 * on a bar focuses the HSL band that hue belongs to; Shift-click makes a new
 * colour-range mask centred on it.
 */
export function HueChart({
  stats,
  before,
  masked,
  onPick
}: {
  stats: ImageStats | null
  before: ImageStats | null
  masked: ImageStats | null
  onPick: (hue: number, band: HslBand, newMask: boolean) => void
}): React.JSX.Element {
  const [inside, setInside] = useState(true)
  const [ghost, setGhost] = useState(true)
  const useMask = masked !== null && inside
  const now = shares(useMask ? masked : stats)
  const then = shares(before)
  const [hover, setHover] = useState<number | null>(null)
  if (!now) return <div className="hue-chart empty">No colour measured yet.</div>
  const max = Math.max(
    0.0001,
    ...now.bins.map((b) => b.share),
    ...(ghost && then && !useMask ? then.bins.map((b) => b.share) : [])
  )
  const h = hover !== null ? now.bins[hover] : null
  const hb = hover !== null && then ? then.bins[hover] : null
  return (
    <div className="hue-chart">
      <div className="hue-bars">
        {now.bins.map(({ bin, share }, i) => {
          const mid = (bin.hue_start + bin.hue_end) / 2
          const g = ghost && then && !useMask ? (then.bins[i]?.share ?? 0) : 0
          return (
            <div
              key={i}
              className="hue-bar"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => onPick(mid, bandOfHue(mid), e.shiftKey)}
            >
              {g > 0 && <div className="ghost" style={{ height: `${(g / max) * 100}%` }} />}
              <div
                className="fill"
                style={{
                  height: `${(share / max) * 100}%`,
                  background: `hsl(${mid} ${Math.round(35 + bin.mean_saturation * 65)}% 52%)`
                }}
              />
            </div>
          )
        })}
        <div className="hue-bar neutral" title={`neutral ${(now.neutral * 100).toFixed(1)}%`}>
          <div
            className="fill"
            style={{ height: `${Math.min(100, (now.neutral / max) * 100)}%` }}
          />
        </div>
      </div>
      <div className="hue-ring" />
      <div className="hue-foot">
        {h ? (
          <span>
            {h.bin.hue_start.toFixed(0)}–{h.bin.hue_end.toFixed(0)}° · {(h.share * 100).toFixed(1)}%
            {hb ? ` (was ${(hb.share * 100).toFixed(1)}%)` : ''} · sat{' '}
            {(h.bin.mean_saturation * 100).toFixed(0)}%
            {` · ${bandOfHue((h.bin.hue_start + h.bin.hue_end) / 2)}`}
          </span>
        ) : (
          <InfoTip tip={HUE_TIP} label="Colours in the photo" />
        )}
        <span className="hue-toggles">
          <label>
            <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />{' '}
            before
          </label>
          {masked && (
            <label>
              <input
                type="checkbox"
                checked={inside}
                onChange={(e) => setInside(e.target.checked)}
              />{' '}
              in mask
            </label>
          )}
        </span>
      </div>
    </div>
  )
}
