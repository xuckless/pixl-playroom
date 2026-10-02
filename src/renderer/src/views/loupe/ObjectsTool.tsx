/**
 * The Objects tool on the picture: SAM 2.1 selects what the user points at
 * (state/objects.ts). In Auto, hovering shows what lies under the pointer
 * and a click takes it; in Box a drag around it, the mask following the
 * drag; in Brush a scribble over it. Once something is selected,
 * Shift-click adds a part and Alt-click takes one away (each refining the
 * last answer); a plain click or a new box starts over. Enter keeps it,
 * Esc drops it (lib/objects.ts). The Sky tool is this one asking for a
 * single click on the sky, kept at once.
 *
 * The photo is analysed once when the tool comes up (about a second), and
 * each answer after it is a few tens of milliseconds: one probe runs at a
 * time and only the pointer's latest place waits behind it.
 */
import { memo, useEffect, useRef, useState } from 'react'
import {
  boxAround,
  strokePoints,
  type PromptGeometry,
  type SelectDecode
} from '../../../../shared/prompt'
import { displayToBase, normalisedIn, type Rect, type ViewGeometry } from '../../../../shared/view'
import { api, errorText } from '../../lib/api'
import { cancelObjects, commitObjects, showDraft } from '../../lib/objects'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { useObjects } from '../../state/objects'

/** A press that moves less than this (px) is a click. */
const CLICK_PX = 6

interface Press {
  x0: number
  y0: number
  x1: number
  y1: number
  shift: boolean
  alt: boolean
  /** A brush stroke's path, in loupe pixels. */
  stroke: { x: number; y: number }[]
}

export const ObjectsTool = memo(function ObjectsTool({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const key = useDevelop((s) => s.session?.key ?? null)
  // Numbers, not an object: a selector must return the same thing for the same state.
  const frameW = useDevelop((s) => s.session?.frameWidth ?? 0)
  const frameH = useDevelop((s) => s.session?.frameHeight ?? 0)
  const mode = useObjects((s) => s.mode)
  const target = useObjects((s) => s.target)
  const status = useObjects((s) => s.status)
  const selected = useObjects((s) => s.plane !== null)
  const layer = useRef<HTMLDivElement>(null)
  const [press, setPress] = useState<Press | null>(null)
  /** Every answer asked for gets the next number; an older one arriving late is dropped. */
  const seq = useRef(0)
  /**
   * The probe running, and the latest one waiting behind it; `over` shows
   * its answer over what is selected (a new box being dragged, which will
   * replace it), else only while nothing is.
   */
  const probing = useRef(false)
  const nextProbe = useRef<{ prompt: PromptGeometry; over: boolean } | null>(null)
  const sky = target === 'sky'

  // The photo analysed once, for every prompt on it; let go when the tool is put down.
  useEffect(() => {
    if (!key) return
    let live = true
    let selId: string | null = null
    const answers = seq
    useObjects.setState({ selId: null, key, status: 'loading', plane: null })
    api.select
      .open(key)
      .then((r) => {
        selId = r.selId
        if (!live) return void api.select.close(r.selId)
        useObjects.setState({ selId: r.selId, status: 'ready' })
      })
      .catch((err) => {
        if (!live) return
        useLibrary.getState().say(errorText(err), 'error')
        useObjects.setState({ status: 'idle' })
        useDevelop.getState().setTool('none')
      })
    return () => {
      live = false
      // An answer still on its way is dropped, not shown on a put-down tool.
      answers.current++
      nextProbe.current = null
      if (selId) void api.select.close(selId)
      showDraft(null)
      useObjects.setState({ selId: null, key: null, status: 'idle', plane: null })
    }
  }, [key])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        void commitObjects()
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        cancelObjects()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!key || !frameW || !frameH) return null
  const aspect = frameW / frameH

  const local = (e: React.PointerEvent): { x: number; y: number } => {
    const b = layer.current!.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }
  const toBase = (x: number, y: number): { x: number; y: number } => {
    const b = layer.current!.getBoundingClientRect()
    return displayToBase(g, normalisedIn(b.left + x, b.top + y, b))
  }
  const longest = Math.round(Math.max(rect.w, rect.h) * (window.devicePixelRatio || 1))

  /** A live answer while the pointer moves: one at a time, the latest waiting. */
  const probe = (prompt: PromptGeometry, over = false): void => {
    nextProbe.current = { prompt, over }
    if (probing.current) return
    const run = async (): Promise<void> => {
      const o = useObjects.getState()
      const p = nextProbe.current
      nextProbe.current = null
      if (!p || !o.selId) return
      probing.current = true
      const n = ++seq.current
      try {
        const plane = await api.select.decode(o.selId, {
          seq: n,
          mode: 'probe',
          prompt: p.prompt,
          longest
        })
        // Still the latest, and nothing chosen since (or to be replaced): shown.
        if (plane && n === seq.current && (p.over || !useObjects.getState().plane)) showDraft(plane)
      } catch {
        // A probe that failed shows nothing; the next one tries again.
      } finally {
        probing.current = false
        if (nextProbe.current) void run()
      }
    }
    void run()
  }

  /** A click, a box or strokes landing: the selection made or refined, and shown. */
  const choose = async (
    mode: SelectDecode['mode'],
    prompt: PromptGeometry,
    via: 'click' | 'box' | 'brush'
  ): Promise<void> => {
    const o = useObjects.getState()
    if (!o.selId) return
    nextProbe.current = null
    const n = ++seq.current
    useObjects.setState({ status: 'working' })
    try {
      const plane = await api.select.decode(o.selId, { seq: n, mode, prompt })
      if (!plane || n !== seq.current) return
      useObjects.setState({ plane, via: sky ? 'sky' : mode === 'replace' ? via : o.via })
      showDraft(plane)
      // The sky is one click: kept at once.
      if (sky) await commitObjects()
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
    } finally {
      useObjects.setState((s) => (s.status === 'working' ? { status: 'ready' } : {}))
    }
  }

  const down = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    layer.current?.setPointerCapture(e.pointerId)
    const p = local(e)
    setPress({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, shift: e.shiftKey, alt: e.altKey, stroke: [p] })
  }

  const move = (e: React.PointerEvent): void => {
    const p = local(e)
    if (!press) {
      // Hovering in Auto, before anything is chosen: what a click would take.
      if (mode === 'auto' && !sky && status === 'ready' && !useObjects.getState().plane)
        probe({ rect: null, points: [{ ...toBase(p.x, p.y), fg: true }] })
      return
    }
    const next = { ...press, x1: p.x, y1: p.y }
    if (mode === 'brush' && !sky) next.stroke = [...press.stroke, p]
    setPress(next)
    // A box being dragged: the mask follows it, over what is selected (which
    // the box will replace).
    if ((mode === 'box' || mode === 'auto') && !sky && dragged(next)) {
      const r = boxOf(next)
      if (r) probe({ rect: r, points: [] }, true)
    }
  }

  /** A press taken away (the pointer lost): what is selected shows again. */
  const cancel = (): void => {
    setPress(null)
    nextProbe.current = null
    seq.current++
    showDraft(useObjects.getState().plane)
  }

  const up = (): void => {
    const pr = press
    setPress(null)
    if (!pr) return
    const has = useObjects.getState().plane !== null
    if (mode === 'brush' && !sky && dragged(pr)) {
      const pts = strokePoints(
        pr.stroke.map((q) => toBase(q.x, q.y)),
        aspect
      ).map((q) => ({ ...q, fg: !pr.alt }))
      if (pts.length === 0) return
      if (has) return void choose('part', { rect: null, points: pts }, 'brush')
      if (pr.alt) return
      return void choose('replace', { rect: null, points: pts }, 'brush')
    }
    if (dragged(pr) && !sky) {
      const r = boxOf(pr)
      if (r) return void choose('replace', { rect: r, points: [] }, 'box')
    }
    const at = toBase(pr.x0, pr.y0)
    // Shift adds a part, Alt takes one away: refining what is selected.
    if (has && (pr.shift || pr.alt) && !sky)
      return void choose('part', { rect: null, points: [{ ...at, fg: !pr.alt }] }, 'click')
    if (pr.alt) return
    void choose('replace', { rect: null, points: [{ ...at, fg: true }] }, 'click')
  }

  const leave = (): void => {
    nextProbe.current = null
    if (!useObjects.getState().plane && !press) showDraft(null)
  }

  const dragged = (p: Press): boolean => Math.hypot(p.x1 - p.x0, p.y1 - p.y0) >= CLICK_PX
  const boxOf = (p: Press): ReturnType<typeof boxAround> =>
    boxAround([toBase(p.x0, p.y0), toBase(p.x1, p.y0), toBase(p.x0, p.y1), toBase(p.x1, p.y1)])

  const box = press &&
    (mode === 'box' || mode === 'auto') &&
    !sky &&
    dragged(press) && {
      left: Math.min(press.x0, press.x1),
      top: Math.min(press.y0, press.y1),
      width: Math.abs(press.x1 - press.x0),
      height: Math.abs(press.y1 - press.y0)
    }
  const stroke = press && mode === 'brush' && !sky && press.stroke.length > 1 ? press.stroke : null
  const note =
    status === 'loading'
      ? 'Analysing the photo…'
      : sky
        ? 'Click the sky'
        : selected
          ? 'Shift-click adds a part · Alt-click removes one · Enter keeps it'
          : mode === 'auto'
            ? 'Hover to see an object · click to take it · or drag a box'
            : mode === 'box'
              ? 'Drag a box around the object'
              : 'Brush over the object · Alt-brush what is not part of it'
  return (
    <div
      ref={layer}
      className={`tool-layer objects-tool mode-${mode}${status === 'loading' ? ' loading' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={leave}
    >
      {box && <div className="look-pick-box" style={box} />}
      {stroke && (
        <svg className="objects-stroke" width={rect.w} height={rect.h}>
          <polyline
            points={stroke.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}
            className={press?.alt ? 'not' : undefined}
          />
        </svg>
      )}
      <div className="look-pick-note objects-note" onPointerDown={(e) => e.stopPropagation()}>
        {status === 'loading' || status === 'working' ? <span className="objects-spin" /> : null}
        <span>{note}</span>
      </div>
    </div>
  )
})
