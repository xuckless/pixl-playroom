/**
 * `<pixl-aperture>`: the mark doing its job (the motion kit, 2026-10-09). One
 * SVG drawn from the mark's 240-unit geometry, four states:
 *
 * - `idle`: the mark.
 * - `spin`: indeterminate, stepped 60° a tick, 6 ticks a 1.2 s, so the
 *   pixel-stepped edge never sits between pixels; the sweep brightens toward
 *   the leading blade.
 * - `progress`: determinate, the render ring ending in a pixel.
 * - `closed`: the blades meet on the core.
 *
 * `mode="overlay"` has no outer silhouette: the blades fill the box and open
 * past its edge, for the shutter (`click(fn)`: close, run `fn` at the shut
 * frame, open). Sizes up to 32 px take the small geometry (thicker gaps, no
 * seam highlights).
 *
 * The spin and the core's breathing are CSS (styles/aperture.css), so the
 * still UI (Playroom behind another app) and reduced motion stop them; the
 * shutter's moves are instant then too.
 */
const C = 120
type Detail = 'full' | 'small'
const GEO: Record<
  Detail,
  { outer: string; hexR: number; gap: number; sph: number; ring: number; ringW: number }
> = {
  full: {
    outer:
      'M16 80 L16 160 L32 160 L32 192 L48 192 L48 208 L80 208 L80 224 L160 224 L160 208 L192 208 L192 192 L208 192 L208 160 L224 160 L224 80 L208 80 L208 48 L192 48 L192 32 L160 32 L160 16 L80 16 L80 32 L48 32 L48 48 L32 48 L32 80 Z',
    hexR: 50,
    gap: 2.6,
    sph: 38,
    ring: 112,
    ringW: 3.4
  },
  small: {
    outer:
      'M30 60 L30 180 L60 180 L60 210 L180 210 L180 180 L210 180 L210 60 L180 60 L180 30 L60 30 L60 60 Z',
    hexR: 60,
    gap: 5,
    sph: 48,
    ring: 114,
    ringW: 9
  }
}
const FLAT = ['#6a58c8', '#4c3d9e', '#5b4ab3', '#43358f', '#5f4dbd', '#483a98']
const SWEEP = ['#2b2359', '#3a2f7a', '#4c3d9e', '#5f4dbd', '#7b68d8', '#9d8bea']
const OPS = [1, 0.82, 0.92, 0.74, 0.88, 0.8]
const SPRING = 'cubic-bezier(.22,1.25,.36,1)'
const EASE = 'cubic-bezier(.2,.8,.2,1)'
const NS = 'http://www.w3.org/2000/svg'
const rad = (d: number): number => (d * Math.PI) / 180

function mix(a: string, b: string, t: number): string {
  const h = (x: string): number[] => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16))
  const A = h(a)
  const B = h(b)
  return (
    '#' +
    A.map((v, i) =>
      Math.round(v + (B[i] - v) * t)
        .toString(16)
        .padStart(2, '0')
    ).join('')
  )
}

/** No motion: reduced motion asked for, or Playroom behind another app. */
const still = (): boolean =>
  document.documentElement.hasAttribute('data-still') ||
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

let uid = 0

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag)
  for (const k in attrs) n.setAttribute(k, String(attrs[k]))
  if (parent) parent.appendChild(n)
  return n
}

export type ApertureState = 'idle' | 'spin' | 'progress' | 'closed'

export class PixlAperture extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['size', 'tone', 'ink', 'mode', 'state', 'progress', 'detail', 'glow']
  }
  private readonly uid = 'ap' + ++uid
  private t = 0
  private svg: SVGSVGElement | null = null
  private geo = GEO.full
  private blades: SVGGElement[] = []
  private strokes: SVGGElement[] = []
  private normals: [number, number][] = []
  private arc: SVGCircleElement | null = null
  private head: SVGRectElement | null = null
  private ringEl: SVGGElement | null = null
  private circ = 0
  private openPastSet: number | null = null

  connectedCallback(): void {
    this.build()
    this.applyState()
  }
  attributeChangedCallback(name: string): void {
    if (!this.svg) return
    if (name === 'progress') this.drawProgress()
    else if (name === 'state') this.applyState()
    else if (name !== 'glow') {
      this.build()
      this.applyState()
    }
  }

  get size(): number {
    return +(this.getAttribute('size') ?? 0) || 96
  }
  set size(v: number) {
    this.setAttribute('size', String(v))
  }
  get tone(): string {
    return this.getAttribute('tone') || 'flat'
  }
  set tone(v: string) {
    this.setAttribute('tone', v)
  }
  get ink(): string {
    return this.getAttribute('ink') || '#ebe9f3'
  }
  set ink(v: string) {
    this.setAttribute('ink', v)
  }
  get mode(): string {
    return this.getAttribute('mode') || 'mark'
  }
  set mode(v: string) {
    this.setAttribute('mode', v)
  }
  get detail(): Detail {
    const d = this.getAttribute('detail')
    return d === 'small' || d === 'full' ? d : this.size <= 32 ? 'small' : 'full'
  }
  set detail(v: Detail) {
    this.setAttribute('detail', v)
  }
  get glow(): boolean {
    return this.hasAttribute('glow')
  }
  set glow(v: boolean) {
    this.toggleAttribute('glow', !!v)
  }
  /** 0–100. */
  get progress(): number {
    return Math.max(0, Math.min(100, +(this.getAttribute('progress') ?? 0) || 0))
  }
  set progress(v: number) {
    this.setAttribute('progress', String(v))
  }
  get state(): ApertureState {
    return (this.getAttribute('state') as ApertureState) || 'idle'
  }
  set state(v: ApertureState) {
    this.setAttribute('state', v)
  }

  /* ── geometry ── */
  private build(): void {
    const g = GEO[this.detail]
    const tone = this.tone
    const ink = this.ink
    const overlay = this.mode === 'overlay'
    const glass = tone === 'glass'
    const mono = tone === 'mono'
    this.replaceChildren()
    const svg = svgEl('svg', {
      viewBox: '0 0 240 240',
      width: this.size,
      height: this.size,
      'aria-hidden': 'true',
      class: 'ap-svg'
    })
    if (overlay) {
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
    }
    const defs = svgEl('defs', {}, svg)
    const id = (s: string): string => this.uid + s
    const sp = svgEl('radialGradient', { id: id('sp'), cx: '36%', cy: '30%', r: '75%' }, defs)
    for (const [o, c] of [
      ['0', '#f1ecff'],
      ['0.22', '#bba9ff'],
      ['0.55', '#7b68d8'],
      ['0.85', '#2b1f66'],
      ['1', '#0d0a1f']
    ])
      svgEl('stop', { offset: o, 'stop-color': c }, sp)
    const bl = svgEl(
      'radialGradient',
      { id: id('bl'), gradientUnits: 'userSpaceOnUse', cx: 96, cy: 84, r: 150 },
      defs
    )
    for (const [o, c] of [
      ['0', '#7d69dc'],
      ['0.45', '#3f3290'],
      ['1', '#120e28']
    ])
      svgEl('stop', { offset: o, 'stop-color': c }, bl)
    const rg = svgEl('linearGradient', { id: id('rg'), x1: 0, y1: 0, x2: 1, y2: 1 }, defs)
    svgEl('stop', { offset: 0, 'stop-color': '#e6dfff' }, rg)
    svgEl('stop', { offset: 1, 'stop-color': '#7b68d8' }, rg)
    if (!overlay) {
      const m = svgEl(
        'mask',
        { id: id('m'), maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 240, height: 240 },
        defs
      )
      svgEl('path', { d: g.outer, fill: '#fff' }, m)
    }
    // The housing under the blades.
    if (!overlay && !mono) svgEl('path', { d: g.outer, fill: '#0b0816', class: 'ap-base' }, svg)

    // Six 60° wedges, apex at a hex vertex, each sliding along its own normal.
    const wrap = svgEl('g', overlay ? {} : { mask: 'url(#' + id('m') + ')' }, svg)
    const rot = svgEl('g', { class: 'ap-rot' }, wrap)
    const R = overlay ? 900 : 600
    this.blades = []
    this.strokes = []
    this.normals = []
    // Every blade's leading edge, drawn after all the fills.
    const edges = svgEl('g', { class: 'ap-edges' })
    for (let i = 0; i < 6; i++) {
      const a1 = rad(60 * (i + 1))
      const P = [C + g.hexR * Math.cos(a1), C + g.hexR * Math.sin(a1)]
      const u1 = rad(60 * (i + 1) - 60)
      const u2 = rad(60 * (i + 1) - 120)
      const Q = [P[0] + R * Math.cos(u1), P[1] + R * Math.sin(u1)]
      const S = [P[0] + R * Math.cos(u2), P[1] + R * Math.sin(u2)]
      const n = rad(60 * (i + 1) + 150)
      this.normals.push([Math.cos(n), Math.sin(n)])
      const grp = svgEl('g', { class: 'ap-blade' }, rot)
      const d =
        'M' +
        P[0].toFixed(2) +
        ' ' +
        P[1].toFixed(2) +
        ' L' +
        Q[0].toFixed(1) +
        ' ' +
        Q[1].toFixed(1) +
        ' L' +
        S[0].toFixed(1) +
        ' ' +
        S[1].toFixed(1) +
        ' Z'
      const fill = overlay
        ? 'var(--ap-blade, #3a2f7a)'
        : glass
          ? 'url(#' + id('bl') + ')'
          : mono
            ? ink
            : FLAT[i]
      const p = svgEl('path', { d, class: 'ap-fill' }, grp)
      if (overlay) p.style.fill = fill
      else p.setAttribute('fill', fill)
      if (glass) p.setAttribute('opacity', String(OPS[i]))
      // The leading edge: the hex edge and seam, one line from the apex to the rim.
      const eg = svgEl('g', { class: 'ap-blade' }, edges)
      const ln = svgEl(
        'line',
        {
          x1: P[0].toFixed(2),
          y1: P[1].toFixed(2),
          x2: S[0].toFixed(1),
          y2: S[1].toFixed(1),
          'stroke-width': mono ? g.gap + 1.4 : g.gap,
          'stroke-linecap': 'butt'
        },
        eg
      )
      ln.style.stroke = mono ? 'var(--ap-gap, #000)' : 'var(--ap-gap, #0b0816)'
      if (glass && this.detail === 'full') {
        // The seam highlight, riding with its blade.
        const A = [P[0] + g.hexR * Math.cos(u2), P[1] + g.hexR * Math.sin(u2)]
        const lg = svgEl(
          'linearGradient',
          {
            id: id('s' + i),
            gradientUnits: 'userSpaceOnUse',
            x1: A[0],
            y1: A[1],
            x2: A[0] + 70 * Math.cos(u2),
            y2: A[1] + 70 * Math.sin(u2)
          },
          defs
        )
        svgEl('stop', { offset: 0, 'stop-color': '#e6dfff' }, lg)
        svgEl('stop', { offset: 0.35, 'stop-color': '#9d8bea', 'stop-opacity': 0.55 }, lg)
        svgEl('stop', { offset: 1, 'stop-color': '#9d8bea', 'stop-opacity': 0 }, lg)
        svgEl(
          'line',
          {
            x1: A[0],
            y1: A[1],
            x2: A[0] + 90 * Math.cos(u2),
            y2: A[1] + 90 * Math.sin(u2),
            stroke: 'url(#' + id('s' + i) + ')',
            'stroke-width': 2.2,
            'stroke-linecap': 'square'
          },
          eg
        )
      }
      this.blades.push(grp)
      this.strokes.push(eg)
    }
    rot.appendChild(edges)
    if (glass && !overlay)
      svgEl(
        'path',
        { d: g.outer, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.14, 'stroke-width': 1 },
        svg
      )

    // The core sphere and its highlight pixel (in overlay mode the screen is the core).
    this.arc = null
    this.head = null
    this.ringEl = null
    if (!overlay) {
      const core = svgEl('g', { class: 'ap-core' }, svg)
      svgEl(
        'circle',
        {
          cx: C,
          cy: C,
          r: g.sph,
          fill: glass ? 'url(#' + id('sp') + ')' : mono ? ink : '#9d8bea'
        },
        core
      )
      const s = g.sph * 0.24
      svgEl(
        'rect',
        {
          x: (C - g.sph * 0.42 - s / 2).toFixed(2),
          y: (C - g.sph * 0.44 - s / 2).toFixed(2),
          width: s.toFixed(2),
          height: s.toFixed(2),
          fill: mono ? '#000' : glass ? '#fff' : '#f1ecff',
          ...(mono ? {} : { opacity: 0.94 })
        },
        core
      )
      // The determinate ring.
      const ring = svgEl('g', { class: 'ap-ring', opacity: 0 }, svg)
      svgEl(
        'circle',
        {
          cx: C,
          cy: C,
          r: g.ring,
          fill: 'none',
          stroke: 'rgba(255,255,255,.1)',
          'stroke-width': g.ringW
        },
        ring
      )
      const circ = 2 * Math.PI * g.ring
      this.arc = svgEl(
        'circle',
        {
          cx: C,
          cy: C,
          r: g.ring,
          fill: 'none',
          stroke: mono ? ink : 'url(#' + id('rg') + ')',
          'stroke-width': g.ringW,
          'stroke-dasharray': circ.toFixed(1),
          'stroke-dashoffset': circ.toFixed(1),
          transform: 'rotate(-90 120 120)'
        },
        ring
      )
      this.head = svgEl('rect', { width: 11, height: 11, fill: mono ? ink : '#fff' }, ring)
      this.circ = circ
      this.ringEl = ring
    }
    this.svg = svg
    this.geo = g
    this.appendChild(svg)
    void this.setT(this.t, 0)
    this.drawProgress()
  }

  /* ── motion ── */
  /** t = 0 the open mark · 1 fully closed · negative: opened past the mark (overlay). */
  setT(t: number, ms = 0, easing = EASE): Promise<void> {
    this.t = t
    const d = this.geo.hexR * Math.cos(rad(30)) + 1.5
    const moving = ms > 0 && !still()
    // Flat tone: the six colours converge as the blades overlap, so none shows through another.
    if (this.tone === 'flat' && this.mode !== 'overlay' && this.state !== 'spin') {
      const k = Math.max(0, Math.min(1, t))
      this.blades.forEach((b, i) => {
        const p = b.querySelector('.ap-fill') as SVGPathElement
        const to = mix(FLAT[i], '#4c3d9e', k)
        if (moving)
          p.animate([{ fill: p.getAttribute('fill') ?? to }, { fill: to }], {
            duration: ms,
            easing: EASE,
            fill: 'forwards'
          })
        p.setAttribute('fill', to)
      })
    }
    const all = [...this.blades, ...this.strokes].map((b, k) => {
      const [nx, ny] = this.normals[k % 6]
      const to = `translate(${(nx * d * t).toFixed(2)}px,${(ny * d * t).toFixed(2)}px)`
      if (!moving) {
        b.getAnimations().forEach((a) => a.cancel())
        b.style.transform = to
        return Promise.resolve()
      }
      const from = b.style.transform || 'translate(0px,0px)'
      const a = b.animate([{ transform: from }, { transform: to }], {
        duration: ms,
        easing,
        fill: 'forwards'
      })
      b.style.transform = to
      return a.finished.then(
        () => undefined,
        () => undefined
      )
    })
    return Promise.all(all).then(() => undefined)
  }

  close(ms = 600): Promise<void> {
    this.setAttribute('state', 'closed')
    return this.setT(1, ms, EASE)
  }

  /** Overlay: open far enough that the leading edges clear the box's corners. */
  get openPast(): number {
    if (this.openPastSet !== null) return this.openPastSet
    const r = this.getBoundingClientRect()
    const w = r.width || 1920
    const h = r.height || 1080
    const units = 240 / Math.min(w, h)
    const apo = this.geo.hexR * Math.cos(rad(30)) + 1.5
    return ((Math.hypot(w, h) / 2) * units) / apo + 0.3
  }
  set openPast(v: number) {
    this.openPastSet = v
  }

  open(ms = 700): Promise<void> {
    this.setAttribute('state', 'idle')
    const overlay = this.mode === 'overlay'
    return this.setT(overlay ? -this.openPast : 0, ms, overlay ? EASE : SPRING)
  }

  /** The shutter: close, run `fn` at the fully shut frame, hold, open. */
  async click(fn?: () => unknown, hold = 120): Promise<void> {
    await this.close()
    if (fn) await fn()
    if (!still()) await new Promise((r) => setTimeout(r, hold))
    await this.open()
  }

  spin(): void {
    this.setAttribute('state', 'spin')
  }
  stop(): void {
    this.setAttribute('state', 'idle')
  }

  private applyState(): void {
    if (!this.svg) return
    const s = this.state
    this.svg.dataset.state = s
    this.blades.forEach((b, i) => {
      const p = b.querySelector('.ap-fill') as SVGPathElement
      if (this.tone === 'flat' && this.mode !== 'overlay')
        p.setAttribute('fill', s === 'spin' ? SWEEP[i] : FLAT[i])
      if (this.tone === 'glass')
        p.setAttribute(
          'opacity',
          s === 'spin' ? (0.35 + (0.65 * (i + 1)) / 6).toFixed(2) : String(OPS[i])
        )
    })
    if (this.ringEl) this.ringEl.setAttribute('opacity', s === 'progress' ? '1' : '0')
    if (s === 'closed' && this.t !== 1) void this.setT(1, 0)
    if (s !== 'closed' && this.t === 1) void this.setT(0, 0)
  }

  private drawProgress(): void {
    if (!this.arc || !this.head) return
    const p = this.progress / 100
    this.arc.setAttribute('stroke-dashoffset', (this.circ * (1 - p)).toFixed(1))
    const a = rad(-90 + 360 * p)
    this.head.setAttribute('x', (C + this.geo.ring * Math.cos(a) - 5.5).toFixed(1))
    this.head.setAttribute('y', (C + this.geo.ring * Math.sin(a) - 5.5).toFixed(1))
  }
}

if (!customElements.get('pixl-aperture')) customElements.define('pixl-aperture', PixlAperture)
