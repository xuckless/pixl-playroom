/**
 * What the Objects tool's selection becomes: shown in the selected mask as
 * it is made (the loupe's mask draws it as a draft, so it lands on the
 * picture however the view is turned or cropped), then committed as a
 * painted component that remembers its prompt and snaps to the photo's
 * edges, or dropped. A lasso's Find object goes the same way in one step.
 */
import { lassoPrompt, type SelectPlane } from '../../../shared/prompt'
import { newId, type BrushComponent } from '../../../shared/recipe'
import { AI_REFINE } from '../../../shared/refine'
import { layerOf, madeComponent, modeForNew } from '../panels/masks/model'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { useObjects } from '../state/objects'
import { useMaskDraft } from '../views/loupe/maskgl/state'
import { api, errorText } from './api'
import { ensureModel } from './ensureModel'

/** Bytes as base64, in chunks (a plane is hundreds of kilobytes). */
function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** A plane from SAM shown in the selected mask as it would join it; null takes it away. */
export function showDraft(plane: SelectPlane | null): void {
  if (!plane || plane.png.length === 0) {
    if (useMaskDraft.getState().draft?.id === DRAFT_ID) useMaskDraft.setState({ draft: null })
    return
  }
  const d = useDevelop.getState()
  const layer = layerOf(d.recipe, d.layerId)
  const draft: BrushComponent = {
    id: DRAFT_ID,
    kind: 'brush',
    mode: modeForNew(layer),
    opacity: 100,
    invert: false,
    feather: 0,
    width: plane.width,
    height: plane.height,
    png: base64(plane.png),
    // Its own name, so the loupe decodes each answer once.
    ref: `live:${plane.seq}:${plane.width}x${plane.height}`
  }
  useMaskDraft.setState({ draft })
}
const DRAFT_ID = 'objects-draft'

/** The selection as a component of the selected mask, a History step, and the tool put down. */
export async function commitObjects(): Promise<void> {
  const o = useObjects.getState()
  if (!o.selId || !o.plane) return
  const sky = o.target === 'sky'
  const label = sky ? 'Sky' : undefined
  try {
    useObjects.setState({ status: 'working' })
    const made = await api.select.commit(o.selId, { label, via: o.via })
    const d = useDevelop.getState()
    const layerId = d.layerId
    const layer = layerOf(d.recipe, layerId)
    if (!layer) return
    const comp: BrushComponent = {
      id: newId(),
      kind: 'brush',
      name: label ?? 'Object',
      mode: modeForNew(layer),
      opacity: 100,
      invert: false,
      feather: 0,
      width: made.width,
      height: made.height,
      png: '',
      ref: made.ref,
      source: made.source,
      // A model's plane: snapped to the photo's edges at whatever size it renders.
      refine: { ...AI_REFINE }
    }
    d.edit((r) => {
      const l = layerOf(r, layerId)
      if (!l) return
      // A new mask that is only the sky is called that.
      if (sky && l.components.length === 0) l.name = 'Sky'
      l.components.push(comp)
    })
    d.commit(sky ? 'Select sky' : 'Select object')
    madeComponent(comp.id)
    showDraft(null)
    useObjects.setState({ plane: null })
    useDevelop.getState().setTool('none')
  } catch (err) {
    useLibrary.getState().say(errorText(err), 'error')
  } finally {
    useObjects.setState((s) => (s.status === 'working' ? { status: 'ready' } : {}))
  }
}

/** Put the tool down, keeping nothing it selected. */
export function cancelObjects(): void {
  showDraft(null)
  useObjects.setState({ plane: null })
  useDevelop.getState().setTool('none')
}

/**
 * A lasso's Find object: its outline as SAM's prompt (its bounds, and clicks
 * well inside it), and the object found there in the lasso's place, the
 * same way round and joined the same way, as one History step.
 */
export async function findObject(compId: string): Promise<void> {
  const d = useDevelop.getState()
  const session = d.session
  const layer = d.recipe?.layers.find((l) => l.components.some((c) => c.id === compId))
  const lasso = layer?.components.find((c) => c.id === compId)
  if (!session || !layer || lasso?.kind !== 'polygon') return
  const say = useLibrary.getState().say
  if (!(await ensureModel('prompt', 'Find object'))) return
  const prompt = lassoPrompt(lasso.points, session.frameWidth / session.frameHeight)
  if (!prompt) return say('Draw a larger outline around the object first', 'error')
  say('Finding the object in the outline…')
  let selId: string | null = null
  try {
    selId = (await api.select.open(session.key)).selId
    const plane = await api.select.decode(selId, { seq: 1, mode: 'replace', prompt })
    if (!plane || plane.coverage < 0.0005) throw new Error('Nothing stands out inside this outline')
    const made = await api.select.commit(selId, { via: 'lasso' })
    const now = useDevelop.getState()
    if (now.session?.key !== session.key) return
    const id = newId()
    now.edit((r) => {
      for (const l of r.layers) {
        const i = l.components.findIndex((c) => c.id === compId)
        if (i < 0) continue
        const was = l.components[i]
        l.components[i] = {
          id,
          kind: 'brush',
          name: 'Object',
          mode: was.mode,
          opacity: was.opacity,
          invert: was.invert,
          feather: 0,
          width: made.width,
          height: made.height,
          png: '',
          ref: made.ref,
          source: made.source,
          refine: { ...AI_REFINE }
        }
      }
    })
    now.commit('Find object')
    now.setComp(id)
  } catch (err) {
    say(errorText(err), 'error')
  } finally {
    if (selId) void api.select.close(selId)
  }
}
