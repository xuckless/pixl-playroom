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
import { ensureModel, ensureModelId } from '../../lib/ensureModel'
import { askModel } from '../../state/modelPrompt'
import { useObjects } from '../../state/objects'
import {
  DEPTH_MODEL,
  FINE_SUBJECT_MODEL,
  isPartTarget,
  isSceneTarget,
  PARTS_MODEL,
  PEOPLE_BY_CLICK,
  OFFERED_PHRASE_MODEL,
  PHRASE_MODELS,
  SCENE_MODEL,
  SEGMENT_LABEL,
  SKY_BY_CLICK,
  type SegmentTarget
} from '../../../../shared/ai'
import { CONCEPTS, conceptOf, type ConceptId } from '../../../../shared/concepts'
import { FACE_DETECTOR, FACE_LANDMARKER, isFacePart } from '../../../../shared/faceparts'
import type { PersonPart } from '../../../../shared/looks/smart'
import { useLibrary } from '../../state/library'
import { useDevelop, type Tool } from '../../state/develop'

export type MaskToolKind =
  | 'subject'
  /** The subject with BiRefNet lite (on demand): hair and fur, a few seconds. */
  | 'subject-fine'
  | 'objects'
  | 'sky'
  | 'vegetation'
  | 'water'
  | 'background'
  | 'brush'
  | 'linear'
  | 'radial'
  | 'bidirectional'
  | 'polygon'
  | 'color'
  | 'luminance'
  | 'depth'
  /** A person's part, asked for by a click (shared/concepts.ts). */
  | `part:${PersonPart}`

export interface MaskToolInfo {
  kind: MaskToolKind
  label: string
  icon: IconName
  /** The shortcut that starts it (a key-binding command id). */
  command?: string
  /** Why it cannot be used yet, when it cannot (a model: see `ai`). */
  needs?: string
  /** Found by a model: usable when the build has that task (its model offered when missing). */
  ai?: 'segment' | 'prompt'
  /** Found by this model (engine 0.19's named masks): offered when missing, on the tool's first use. */
  model?: string
  /** A word in the corner of its button ("click": the sky is pointed at, for now). */
  badge?: string
  /** What its button's tip says about it, past its name. */
  hint?: string
}

const PART_ICON: Partial<Record<PersonPart, IconName>> = {
  body: 'subject',
  face: 'face',
  hair: 'hair',
  skin: 'skin',
  clothes: 'clothes',
  eyes: 'eye',
  brows: 'brows',
  lips: 'lips',
  teeth: 'teeth'
}
const PART_HINT = 'found by a model; best when the person is a good part of the frame'
/** Face parts' tips: what each finds, every face at once. */
const FACE_HINT: Partial<Record<PersonPart, string>> = {
  eyes: 'both eyes of every face, found by a model; pick one face after',
  brows: 'the eyebrows of every face (beta: their outlines are rough)',
  lips: 'the lips of every face, the mouth inside left out',
  teeth: 'the inside of every mouth: the closest outline to the teeth there is'
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
        needs: 'download the subject model',
        ai: 'segment'
      },
      {
        kind: 'subject-fine',
        label: 'Fine subject',
        icon: 'subject',
        hint: 'a finer cut-out that keeps hair and fur (BiRefNet lite, 224 MB, about 10 seconds a photo)'
      },
      {
        kind: 'objects',
        label: 'Objects',
        icon: 'objects',
        command: 'mask.objects',
        needs: 'download SAM 2.1',
        ai: 'prompt'
      },
      // DINOv2's sky plane (engine 0.19): one click on the tool.
      SKY_BY_CLICK
        ? { kind: 'sky', label: 'Sky', icon: 'sky', ai: 'prompt', badge: 'click' }
        : { kind: 'sky', label: 'Sky', icon: 'sky', model: SCENE_MODEL },
      {
        kind: 'vegetation',
        label: 'Vegetation',
        icon: 'vegetation',
        model: SCENE_MODEL,
        hint: 'trees, grass, plants and flowers'
      },
      {
        kind: 'water',
        label: 'Water',
        icon: 'water',
        model: SCENE_MODEL,
        hint: 'the sea, lakes, rivers and waterfalls'
      },
      {
        kind: 'background',
        label: 'Background',
        icon: 'background',
        needs: 'download the subject model',
        ai: 'segment'
      }
    ]
  },
  {
    // Hair, face, skin and clothes by Selfie Multiclass (engine 0.19), one
    // click on the tool; the rest by a click on the part (SAM 2.1) once
    // `PEOPLE_BY_CLICK` is on, coming soon until then (eyes and lips: face
    // parts, Pass 110).
    title: 'People',
    tools: CONCEPTS.filter((c) => c.group === 'people').map((c): MaskToolInfo => ({
      kind: `part:${c.id as PersonPart}`,
      label: c.label,
      icon: PART_ICON[c.id as PersonPart] ?? 'objects',
      ...(isPartTarget(c.id)
        ? { model: PARTS_MODEL, hint: PART_HINT }
        : isFacePart(c.id)
          ? { model: FACE_LANDMARKER, hint: FACE_HINT[c.id as PersonPart] }
          : PEOPLE_BY_CLICK
            ? { needs: 'download SAM 2.1', ai: 'prompt' as const, badge: 'click' }
            : { needs: 'coming soon' })
    }))
  },
  {
    title: 'Draw',
    tools: [
      { kind: 'brush', label: 'Brush', icon: 'brush', command: 'mask.brush' },
      { kind: 'linear', label: 'Linear gradient', icon: 'linear', command: 'mask.linear' },
      { kind: 'radial', label: 'Radial gradient', icon: 'radial', command: 'mask.radial' },
      {
        kind: 'bidirectional',
        label: 'Bidirectional gradient',
        icon: 'bidirectional',
        command: 'mask.bidirectional'
      },
      { kind: 'polygon', label: 'Lasso', icon: 'lasso', command: 'mask.lasso' }
    ]
  },
  {
    title: 'Range',
    tools: [
      { kind: 'color', label: 'Colour range', icon: 'colourRange' },
      { kind: 'luminance', label: 'Luminance range', icon: 'lumRange' },
      // Depth Anything V2 (engine 0.18) maps the photo's depth; the range is set on it.
      { kind: 'depth', label: 'Depth range', icon: 'depth' }
    ]
  }
]

export const COMPONENT_LABEL: Record<MaskComponentSetting['kind'], string> = {
  brush: 'Brush',
  polygon: 'Lasso',
  range: 'Range',
  linear: 'Linear gradient',
  radial: 'Radial gradient',
  bidirectional: 'Bidirectional gradient',
  depth: 'Depth range'
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
/** The class a tool asks a click for: the sky (without its model), or a person's part no model finds. */
function askedConcept(kind: MaskToolKind): ConceptId | null {
  if (kind === 'sky') return SKY_BY_CLICK ? 'sky' : null
  // Hair, face, skin and clothes, and the face's parts, have their models: no click.
  if (!kind.startsWith('part:') || isPartTarget(kind.slice(5)) || isFacePart(kind.slice(5)))
    return null
  return kind.slice(5) as PersonPart
}

export function startMaskTool(kind: MaskToolKind): void {
  const d = useDevelop.getState()
  if (!d.recipe) return
  const adding = d.addMode !== null && layerOf(d.recipe, d.layerId) !== undefined
  // Pointed at (SAM 2.1): the Objects tool on the canvas, or a class tool
  // (Sky, Hair, Eyes…), which is the same tool asking for a click on that
  // class until a finder that knows its name ships. Its model offered first
  // when it is not downloaded.
  const asked = askedConcept(kind)
  if (kind === 'objects' || asked) {
    if (!d.session) return
    const mode = d.addMode
    openMasks()
    void (async () => {
      if (!(await ensureModel('prompt', asked ? conceptOf(asked)?.label : undefined))) return
      const now = useDevelop.getState()
      if (!now.recipe || !now.session) return
      if (!(adding && layerOf(now.recipe, now.layerId))) {
        if (!createMask()) return
      } else if (mode) now.setAddMode(mode)
      useObjects.getState().begin(asked ?? 'object')
      useDevelop.getState().setTool('objects')
    })()
    return
  }
  // A model finds these: a job on this photo, whose mask lands when it is done
  // (in this mask with the pending mode, else as a new one).
  // A depth map first (the model offered when it is not downloaded), then a
  // Depth range on it, in this mask with the pending mode, else a new one.
  if (kind === 'depth') {
    if (!d.session) return
    const key = d.session.key
    const into = adding && d.layerId ? { layerId: d.layerId, mode: d.addMode ?? 'Add' } : undefined
    d.setAddMode(null)
    openMasks()
    void (async () => {
      const models = await api.models.list()
      const installed = models.find((m) => m.id === DEPTH_MODEL)?.installed === true
      if (!(await ensureModelId(DEPTH_MODEL, installed, 'Depth range'))) return
      await api.ai.start({ task: 'segment', key, target: 'depth', into })
    })().catch((err) => useLibrary.getState().say(errorText(err), 'error'))
    return
  }
  // A named mask (engine 0.19): the sky, vegetation, water, or a person's
  // hair, face, skin or clothes, its model offered when not downloaded.
  const part = kind.startsWith('part:') ? kind.slice(5) : null
  const named: SegmentTarget | null = isSceneTarget(kind)
    ? kind
    : part && (isPartTarget(part) || isFacePart(part))
      ? (part as SegmentTarget)
      : null
  if (named) {
    if (!d.session) return
    const key = d.session.key
    const into = adding && d.layerId ? { layerId: d.layerId, mode: d.addMode ?? 'Add' } : undefined
    // A face part needs the face finder and the face outliner.
    const ids = isSceneTarget(named)
      ? [SCENE_MODEL]
      : isFacePart(named)
        ? [FACE_DETECTOR, FACE_LANDMARKER]
        : [PARTS_MODEL]
    d.setAddMode(null)
    openMasks()
    void (async () => {
      for (const id of ids) {
        const models = await api.models.list()
        const installed = models.find((m) => m.id === id)?.installed === true
        if (!(await ensureModelId(id, installed, SEGMENT_LABEL[named]))) return
      }
      await api.ai.start({ task: 'segment', key, target: named, into })
    })().catch((err) => useLibrary.getState().say(errorText(err), 'error'))
    return
  }
  // BiRefNet lite: offered (with its size) when not downloaded, then the subject job with it.
  if (kind === 'subject-fine') {
    if (!d.session) return
    const key = d.session.key
    const into = adding && d.layerId ? { layerId: d.layerId, mode: d.addMode ?? 'Add' } : undefined
    d.setAddMode(null)
    openMasks()
    void (async () => {
      const models = await api.models.list()
      const installed = models.find((m) => m.id === FINE_SUBJECT_MODEL)?.installed === true
      if (!(await ensureModelId(FINE_SUBJECT_MODEL, installed, 'Fine subject'))) return
      await api.ai.start({ task: 'segment', key, target: 'subject', fine: true, into })
    })().catch((err) => useLibrary.getState().say(errorText(err), 'error'))
    return
  }
  if (kind === 'subject' || kind === 'background') {
    if (!d.session) return
    const key = d.session.key
    const into = adding && d.layerId ? { layerId: d.layerId, mode: d.addMode ?? 'Add' } : undefined
    d.setAddMode(null)
    openMasks()
    void (async () => {
      if (!(await ensureModel('segment'))) return
      await api.ai.start({ task: 'segment', key, target: kind, into })
    })().catch((err) => useLibrary.getState().say(errorText(err), 'error'))
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
    bidirectional: 'bidirectional',
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

/**
 * Find by name (engine 0.19): every instance of a phrase, by SAM 3 (or
 * EfficientSAM3 when only it is here), into this mask with the pending mode
 * or a new one. Without either model, SAM 3 is offered; declined, the
 * Objects tool takes over for a box drawn around the thing.
 */
export function startPhrase(phrase: string): void {
  const text = phrase.trim()
  const d = useDevelop.getState()
  if (!text || !d.recipe || !d.session) return
  const key = d.session.key
  const adding = d.addMode !== null && layerOf(d.recipe, d.layerId) !== undefined
  const into = adding && d.layerId ? { layerId: d.layerId, mode: d.addMode ?? 'Add' } : undefined
  openMasks()
  void (async () => {
    const models = await api.models.list()
    const here = PHRASE_MODELS.some((id) => models.find((m) => m.id === id)?.installed)
    if (!here && !(await askModel(OFFERED_PHRASE_MODEL, `Find “${text}”`))) {
      useLibrary
        .getState()
        .say('Draw a box around it instead: Objects finds what is inside', 'info')
      startMaskTool('objects')
      return
    }
    useDevelop.getState().setAddMode(null)
    await api.ai.start({ task: 'segment', key, target: 'phrase', phrase: text, into })
  })().catch((err) => useLibrary.getState().say(errorText(err), 'error'))
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
  'bidirectional',
  'objects',
  'range-picker',
  'depth-picker'
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
    if (d.tool === 'range-picker' || d.tool === 'depth-picker') d.setTool('none')
    d.setComp(null)
  }
}
