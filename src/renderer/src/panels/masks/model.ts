/**
 * The masks panel's actions, kept apart from its components: making masks
 * and components the way Lightroom does (pick a tool for a new mask, or to
 * add to, subtract from or intersect with the selected one), and editing
 * the selected mask.
 */
import type { MaskMode } from '../../../../shared/engine-types'
import { copyName, moveItem, nextMaskName } from '../../../../shared/masks'
import {
  newId,
  newLocalLayer,
  type LocalLayer,
  type MaskComponentSetting,
  type Recipe
} from '../../../../shared/recipe'
import type { IconName } from '../../components/icons'
import { openMasks } from '../../develop/tools'
import { api, errorText } from '../../lib/api'
import { emptyRange } from '../../lib/helpers'
import { useLibrary } from '../../state/library'
import { useDevelop, type Tool } from '../../state/develop'

export type MaskToolKind =
  | 'subject'
  | 'sky'
  | 'background'
  | 'brush'
  | 'linear'
  | 'radial'
  | 'polygon'
  | 'color'
  | 'luminance'
  | 'depth'

export interface MaskToolInfo {
  kind: MaskToolKind
  label: string
  icon: IconName
  /** The shortcut that starts it (a key-binding command id). */
  command?: string
  /** Why it cannot be used yet, when it cannot (a model: see `ai`). */
  needs?: string
  /** Found by a model: usable when the build has that task. */
  ai?: 'segment'
}

/** The tools a mask can be made with, in Lightroom's order. */
export const MASK_TOOL_GROUPS: { title: string; tools: MaskToolInfo[] }[] = [
  {
    title: 'Automatic',
    tools: [
      {
        kind: 'subject',
        label: 'Subject',
        icon: 'subject',
        needs: 'download the subject model in Settings → AI models',
        ai: 'segment'
      },
      {
        kind: 'sky',
        label: 'Sky',
        icon: 'sky',
        needs: 'no sky model ships yet'
      },
      {
        kind: 'background',
        label: 'Background',
        icon: 'background',
        needs: 'download the subject model in Settings → AI models',
        ai: 'segment'
      }
    ]
  },
  {
    title: 'Draw',
    tools: [
      { kind: 'brush', label: 'Brush', icon: 'brush', command: 'mask.brush' },
      { kind: 'linear', label: 'Linear gradient', icon: 'linear', command: 'mask.linear' },
      { kind: 'radial', label: 'Radial gradient', icon: 'radial', command: 'mask.radial' },
      { kind: 'polygon', label: 'Lasso', icon: 'lasso', command: 'mask.lasso' }
    ]
  },
  {
    title: 'Range',
    tools: [
      { kind: 'color', label: 'Colour range', icon: 'colourRange' },
      { kind: 'luminance', label: 'Luminance range', icon: 'lumRange' },
      { kind: 'depth', label: 'Depth range', icon: 'depth', needs: 'needs a depth map' }
    ]
  }
]

export const COMPONENT_LABEL: Record<MaskComponentSetting['kind'], string> = {
  brush: 'Brush',
  polygon: 'Lasso',
  range: 'Range',
  linear: 'Linear gradient',
  radial: 'Radial gradient'
}

export function componentIcon(c: MaskComponentSetting): IconName {
  if (c.kind === 'range') return c.hue ? 'colourRange' : 'lumRange'
  if (c.kind === 'polygon') return 'lasso'
  return c.kind
}

export function componentLabel(c: MaskComponentSetting): string {
  if (c.name) return c.name
  if (c.kind === 'range') return c.hue ? 'Colour range' : 'Luminance range'
  if (c.kind === 'polygon') return `Lasso · ${c.points.length} points`
  return COMPONENT_LABEL[c.kind]
}

export const MODE_MARK: Record<MaskMode, string> = { Add: '+', Subtract: '−', Intersect: '∩' }

export function layerOf(r: Recipe | null, id: string | null): LocalLayer | undefined {
  return r?.layers.find((l) => l.id === id)
}

/** Change the selected mask (live while a slider moves). */
export function changeLayer(fn: (l: LocalLayer) => void, live = false): void {
  const d = useDevelop.getState()
  const id = d.layerId
  d.edit((r) => {
    const l = layerOf(r, id)
    if (l) fn(l)
  }, live)
}

/** A new, empty mask, selected. */
export function createMask(): LocalLayer | null {
  const d = useDevelop.getState()
  if (!d.recipe) return null
  const l = newLocalLayer(nextMaskName(d.recipe.layers.map((x) => x.name)))
  d.replace({ ...d.recipe, layers: [...d.recipe.layers, l] }, 'New mask')
  d.setLayer(l.id)
  return l
}

/**
 * The mode a component being made now should have: what Add / Subtract /
 * Intersect asked for, else Add. The first component of a mask always adds.
 */
export function modeForNew(layer: LocalLayer | undefined): MaskMode {
  const m = useDevelop.getState().addMode ?? 'Add'
  return layer && layer.components.length > 0 ? m : 'Add'
}

/** A component was made: select it and forget the pending mode. */
export function madeComponent(id: string): void {
  useDevelop.setState({ addMode: null })
  useDevelop.getState().setComp(id)
}

/**
 * Pick a tool in the tool picker. With a pending Add / Subtract / Intersect
 * it joins the selected mask; otherwise it starts a new mask. Drawing tools
 * then wait on the canvas; a range is added at once and the picker asks for
 * the colour or tone to key on.
 */
export function startMaskTool(kind: MaskToolKind): void {
  const d = useDevelop.getState()
  if (!d.recipe) return
  const adding = d.addMode !== null && layerOf(d.recipe, d.layerId) !== undefined
  // A model finds these: a job on this photo, whose mask lands when it is done
  // (in this mask with the pending mode, else as a new one).
  if (kind === 'subject' || kind === 'sky' || kind === 'background') {
    if (!d.session) return
    void api.ai
      .start({
        task: 'segment',
        key: d.session.key,
        target: kind,
        into: adding && d.layerId ? { layerId: d.layerId, mode: d.addMode ?? 'Add' } : undefined
      })
      .catch((err) => useLibrary.getState().say(errorText(err), 'error'))
    d.setAddMode(null)
    openMasks()
    return
  }
  if (!adding) {
    if (!createMask()) return
  }
  openMasks()
  const tools: Partial<Record<MaskToolKind, Tool>> = {
    brush: 'brush',
    linear: 'linear',
    radial: 'radial',
    polygon: 'polygon'
  }
  const t = tools[kind]
  if (t) {
    useDevelop.getState().setTool(t)
    return
  }
  if (kind === 'color' || kind === 'luminance') {
    const layer = layerOf(useDevelop.getState().recipe, useDevelop.getState().layerId)
    const comp = emptyRange(kind)
    comp.mode = modeForNew(layer)
    changeLayer((l) => l.components.push(comp))
    useDevelop.getState().commit(kind === 'color' ? 'Add colour range' : 'Add luminance range')
    madeComponent(comp.id)
    useDevelop.getState().setTool('range-picker')
  }
}

export function duplicateMask(id: string): void {
  const d = useDevelop.getState()
  if (!d.recipe) return
  const src = layerOf(d.recipe, id)
  if (!src) return
  const copy = structuredClone(src)
  copy.id = newId()
  copy.name = copyName(
    src.name,
    d.recipe.layers.map((x) => x.name)
  )
  copy.components = copy.components.map((c) => ({ ...c, id: newId() }))
  const i = d.recipe.layers.indexOf(src)
  const layers = [...d.recipe.layers]
  layers.splice(i + 1, 0, copy)
  d.replace({ ...d.recipe, layers }, 'Duplicate mask')
  d.setLayer(copy.id)
}

/** Tools that draw into, or key, the selected mask: they have nothing to do without it. */
const MASK_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  'brush',
  'polygon',
  'linear',
  'radial',
  'range-picker'
])

function dropMaskTool(): void {
  const d = useDevelop.getState()
  if (MASK_TOOLS.has(d.tool)) d.setTool('none')
}

/**
 * Delete a mask. Deleting the selected one selects its neighbour (the one
 * after it, else the one before), so Delete can be pressed again.
 */
export function deleteMask(id: string): void {
  const d = useDevelop.getState()
  if (!d.recipe) return
  const layers = d.recipe.layers
  const i = layers.findIndex((x) => x.id === id)
  if (i < 0) return
  const next = layers[i + 1] ?? layers[i - 1] ?? null
  d.replace({ ...d.recipe, layers: layers.filter((x) => x.id !== id) }, 'Delete mask')
  if (d.layerId === id) {
    dropMaskTool()
    d.setLayer(next?.id ?? null)
  }
}

/** Move a mask to index `to` of the list (masks apply in order, top first). */
export function moveMask(id: string, to: number): void {
  const d = useDevelop.getState()
  if (!d.recipe) return
  const from = d.recipe.layers.findIndex((x) => x.id === id)
  if (from < 0 || from === to) return
  d.replace({ ...d.recipe, layers: moveItem(d.recipe.layers, from, to) }, 'Reorder masks')
}

/** Move a component to index `to` of its mask's components. */
export function moveComponent(compId: string, to: number): void {
  const d = useDevelop.getState()
  const l = d.recipe?.layers.find((x) => x.components.some((c) => c.id === compId))
  if (!l) return
  const from = l.components.findIndex((c) => c.id === compId)
  if (from === to) return
  d.edit((r) => {
    const x = layerOf(r, l.id)
    if (x) x.components = moveItem(x.components, from, to)
  })
  d.commit('Reorder mask components')
}

export function patchMask(id: string, label: string, fn: (l: LocalLayer) => void): void {
  const d = useDevelop.getState()
  d.edit((r) => {
    const l = layerOf(r, id)
    if (l) fn(l)
  })
  d.commit(label)
}

export function patchComponent(
  compId: string,
  label: string,
  fn: (c: MaskComponentSetting, l: LocalLayer) => void
): void {
  const d = useDevelop.getState()
  d.edit((r) => {
    for (const l of r.layers) {
      const c = l.components.find((x) => x.id === compId)
      if (c) fn(c, l)
    }
  })
  d.commit(label)
}

export function duplicateComponent(compId: string): void {
  const d = useDevelop.getState()
  let made: string | null = null
  d.edit((r) => {
    for (const l of r.layers) {
      const i = l.components.findIndex((x) => x.id === compId)
      if (i < 0) continue
      const copy = { ...structuredClone(l.components[i]), id: newId() }
      l.components.splice(i + 1, 0, copy)
      made = copy.id
    }
  })
  d.commit('Duplicate component')
  if (made) madeComponent(made)
}

export function deleteComponent(compId: string): void {
  patchComponent(compId, 'Delete component', (_, l) => {
    l.components = l.components.filter((x) => x.id !== compId)
  })
  const d = useDevelop.getState()
  if (d.compId === compId) {
    // The picker keys the selected range: with it gone, it has nothing to key.
    if (d.tool === 'range-picker') d.setTool('none')
    d.setComp(null)
  }
}
