/**
 * The scopes binned from the picture on screen, kept up with it: every new
 * picture (a draft while a slider moves, the settled one after) goes to the
 * scopes worker, the newest only (one in flight, the latest waiting), so the
 * scopes follow a drag as fast as they can be binned and never fall behind.
 * Full HDR's frames are read as their F16 pixels, so the waveform shows the
 * headroom above white; everything else as its Display P3 bitmap.
 */
import { useEffect, useState } from 'react'
import type { ScopeBins, ScopeKind } from '../../../../shared/scopes'
import { oetf, BINNED_SCOPES } from '../../../../shared/scopes'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'
import { frameFloat, isFrame, pictureBitmap, readable, whenFrame } from '../frames'
import type { FloatFrame } from '../floatcanvas'

/** The longest side the scopes read: the waveform has 512 columns, the rest fewer bins still. */
const READ_EDGE = 1024
/** At most this many pixels are sampled from a float frame. */
const FLOAT_BUDGET = 200_000

type Reply = { id: number; bins?: ScopeBins; ms?: number; error?: string }

let worker: Worker | null | undefined
function scopesWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('../../workers/scopes.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onerror = () => {
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

/** Half floats to encoded values, by their bits: made once. */
let halfTable: Float32Array | null = null
function halfToEncoded(): Float32Array {
  if (halfTable) return halfTable
  const t = new Float32Array(65536)
  for (let h = 0; h < 65536; h++) {
    const s = h >> 15 ? -1 : 1
    const e = (h >> 10) & 31
    const m = h & 1023
    const v = e === 0 ? s * m * 2 ** -24 : e === 31 ? 0 : s * (1 + m / 1024) * 2 ** (e - 15)
    t[h] = oetf(v)
  }
  halfTable = t
  return t
}

/** An F16 frame sampled on an even grid into encoded floats (a small copy, not the frame). */
function sampleFloat(f: FloatFrame): { width: number; height: number; data: Float32Array } {
  const stride = Math.max(1, Math.ceil(Math.sqrt((f.width * f.height) / FLOAT_BUDGET)))
  const w = Math.ceil(f.width / stride)
  const h = Math.ceil(f.height / stride)
  const out = new Float32Array(w * h * 4)
  const tab = halfToEncoded()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * stride * f.width + x * stride) * 4
      const o = (y * w + x) * 4
      out[o] = tab[f.data[i]]
      out[o + 1] = tab[f.data[i + 1]]
      out[o + 2] = tab[f.data[i + 2]]
      out[o + 3] = 1
    }
  return { width: w, height: h, data: out }
}

interface Source {
  /** The picture's own url (a frame's F16 pixels are found by it). */
  url: string
  /** The selected mask's plane, when the scopes read only what it holds. */
  mask: string | null
  /** What reads it as a bitmap: Full HDR's companion, else the picture. */
  read: string
  width: number
}

/** The mask plane the scopes read through: "in mask" on, a mask selected and its plane here. */
function maskNow(): string | null {
  const d = useDevelop.getState()
  if (!useUi.getState().scopes.inMask || !d.layerId || !d.mask?.url) return null
  return d.mask.url
}

const sourceOf = (p: { url: string; readUrl?: string; width: number }): Source => ({
  url: p.url,
  mask: maskNow(),
  read: readable(p),
  width: p.width
})

const listeners = new Set<(b: ScopeBins | null) => void>()
const wanted = new Map<(b: ScopeBins | null) => void, readonly ScopeKind[]>()
let last: ScopeBins | null = null
let lastUrl = ''
let busy = false
let pending: Source | null = null
let nextId = 0
/** The last few bin times, for the log line a slow machine leaves. */
let slowLogged = false

function want(): ScopeKind[] {
  const all = new Set<ScopeKind>()
  for (const w of wanted.values()) for (const k of w) all.add(k)
  return BINNED_SCOPES.filter((k) => all.has(k))
}

async function run(src: Source): Promise<void> {
  const w = scopesWorker()
  const kinds = want()
  if (!w || kinds.length === 0) return
  busy = true
  try {
    // A frame's event can come before its pixels: a Full HDR one is read as
    // its floats once they are here.
    const float = isFrame(src.url)
      ? (frameFloat(src.url) ?? ((await whenFrame(src.url)) ? frameFloat(src.url) : undefined))
      : undefined
    const id = ++nextId
    const reply = await new Promise<Reply>((resolve) => {
      const on = (e: MessageEvent<Reply>): void => {
        if (e.data.id !== id) return
        w.removeEventListener('message', on)
        resolve(e.data)
      }
      w.addEventListener('message', on)
      const mask = src.mask ? pictureBitmap(src.mask).catch(() => null) : Promise.resolve(null)
      if (float) {
        const floats = sampleFloat(float)
        void mask.then((m) =>
          w.postMessage(
            { id, want: kinds, floats, ...(m ? { mask: m } : {}) },
            m ? [floats.data.buffer, m] : [floats.data.buffer]
          )
        )
      } else {
        void Promise.all([pictureBitmap(src.read, Math.min(READ_EDGE, src.width)), mask]).then(
          ([bitmap, m]) =>
            w.postMessage(
              { id, want: kinds, bitmap, ...(m ? { mask: m } : {}) },
              m ? [bitmap, m] : [bitmap]
            ),
          (err) => resolve({ id, error: String(err) })
        )
      }
    })
    if (reply.bins) {
      last = reply.bins
      lastUrl = src.url
      for (const l of listeners) l(last)
      if (!slowLogged && (reply.ms ?? 0) > 40) {
        slowLogged = true
        console.info(`scopes: ${reply.ms!.toFixed(1)} ms to bin ${kinds.join(', ')}`)
      }
    }
  } finally {
    busy = false
    const next = pending
    pending = null
    if (next) void run(next)
  }
}

function feed(src: Source): void {
  if (busy) pending = src
  else void run(src)
}

/** Ask again for the picture already shown (a scope was mounted that wants bins it lacks). */
function refresh(): void {
  const p = useDevelop.getState().picture
  if (!p) return
  feed(sourceOf(p))
}

useDevelop.subscribe((s, prev) => {
  if (listeners.size === 0 || s.picture === prev.picture || !s.picture) return
  if (s.picture.url === lastUrl && last) return
  feed(sourceOf(s.picture))
})

// Reading through a mask: a new plane, or another mask chosen, bins again.
let lastMask: string | null = null
useDevelop.subscribe((s, prev) => {
  if (listeners.size === 0 || (s.mask === prev.mask && s.layerId === prev.layerId)) return
  const m = maskNow()
  if (m === lastMask) return
  lastMask = m
  refresh()
})
useUi.subscribe((s, prev) => {
  if (listeners.size > 0 && s.scopes.inMask !== prev.scopes.inMask) refresh()
})

/** The newest bins for `kinds` (the scopes mounted), or null until the first arrive. */
export function useScopeBins(kinds: readonly ScopeKind[]): ScopeBins | null {
  const [bins, setBins] = useState<ScopeBins | null>(last)
  const key = kinds.join(',')
  useEffect(() => {
    const kindsNow = key.split(',').filter(Boolean) as ScopeKind[]
    const l = (b: ScopeBins | null): void => setBins(b)
    listeners.add(l)
    wanted.set(l, kindsNow)
    const lacking = kindsNow.some(
      (k) =>
        !last ||
        (k === 'waveform' && !last.waveform) ||
        (k === 'parade' && !last.parade) ||
        (k === 'vectorscope' && !last.vector) ||
        (k === 'cie' && !last.cie)
    )
    if (lacking && kindsNow.some((k) => BINNED_SCOPES.includes(k))) refresh()
    return () => {
      listeners.delete(l)
      wanted.delete(l)
    }
  }, [key])
  return bins
}
