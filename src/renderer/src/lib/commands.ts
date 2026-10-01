/**
 * Every keyboard shortcut, as a command the user can rebind (Settings → Key
 * bindings). The list is in priority order: when one key answers several
 * commands, the first whose `when` holds runs — so a tool's own use of a key
 * (Delete in Heal, [ ] for the heal brush) comes before the general one.
 */
import { useSyncExternalStore } from 'react'
import { nextOf } from '../../../shared/masks'
import { RECIPE_GROUPS } from '../../../shared/recipe'
import { masksOpen, openMasks, selectPanel, stepPanel, toggleMasks, TOOLS } from '../develop/tools'
import {
  componentLabel,
  deleteComponent,
  deleteMask,
  duplicateComponent,
  duplicateMask,
  patchMask,
  startMaskTool
} from '../panels/masks/model'
import { runJob } from '../state/busy'
import { useDevelop } from '../state/develop'
import { scoped } from '../state/scope'
import { useLibrary } from '../state/library'
import { OVERLAY_MODES, useUi } from '../state/ui'
import { flashHud } from '../views/loupe/hudNote'
import { loupeZoom, setSpace } from '../views/loupe/zoom'
import { api, errorText } from './api'
import { autoWbBatch } from './autowb'
import { deleteSpot } from './heal'
import {
  allConflicts,
  chordLabel,
  chordOf,
  onLayout,
  parseChord,
  resolveBindings,
  sameChord,
  type Bindings,
  type KeyContext
} from './keys'

export interface KeyCommand {
  id: string
  label: string
  group: string
  context: KeyContext
  /** Default keys, as `parseChord` shorthand. */
  keys: string[]
  /** Whether it applies right now (the key falls through to the next command if not). */
  when?: (e: KeyboardEvent) => boolean
  run: (e: KeyboardEvent) => void
  /** Held rather than pressed: released on key-up. */
  hold?: boolean
}

export const GROUPS = [
  'Rating & flags',
  'Navigation',
  'Library',
  'Edit',
  'View',
  'Tools',
  'Masks',
  'Heal',
  'Crop'
] as const

const lib = (): ReturnType<typeof useLibrary.getState> => useLibrary.getState()
const dev = (): ReturnType<typeof useDevelop.getState> => useDevelop.getState()
const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()

const panelIs = (id: string): boolean => ui().panel === id
const healOpen = (): boolean => panelIs('heal')
const notInField = (e: KeyboardEvent): boolean => (e.target as HTMLElement)?.tagName !== 'INPUT'
const focusedItem = (): ReturnType<typeof lib>['items'][number] | undefined =>
  lib().items.find((i) => i.key === lib().focus)

function stop(e: KeyboardEvent): void {
  e.preventDefault()
}

/** Into the selected mask, or (as in Lightroom) a new one. */
function maskTool(t: 'brush' | 'polygon' | 'linear' | 'radial'): void {
  const d = dev()
  if (d.tool === t) return d.setTool('none')
  if (!d.layerId) return void startMaskTool(t)
  openMasks()
  // A mask tool takes the canvas from Heal (whose panel stays up).
  d.setTool(t)
}

const rating = [0, 1, 2, 3, 4, 5].map<KeyCommand>((n) => ({
  id: `rate.${n}`,
  label: n === 0 ? 'Clear rating' : `Rate ${n} star${n === 1 ? '' : 's'}`,
  group: 'Rating & flags',
  context: 'global',
  keys: [String(n)],
  run: () => void lib().setMeta({ rating: n })
}))

const labels = (['red', 'yellow', 'green', 'blue'] as const).map<KeyCommand>((label, i) => ({
  id: `label.${label}`,
  label: `Colour label: ${label}`,
  group: 'Rating & flags',
  context: 'global',
  keys: [String(6 + i)],
  run: () => {
    const current = focusedItem()?.label
    void lib().setMeta({ label: current === label ? null : label })
  }
}))

const tools = TOOLS.map<KeyCommand>((t, i) => ({
  id: `tool.${t.id}`,
  label: `Show ${t.name}`,
  group: 'Tools',
  context: 'develop',
  keys: i < 9 ? [`Mod+${i + 1}`] : [],
  run: (e) => {
    selectPanel(t.id)
    stop(e)
  }
}))

export const COMMANDS: KeyCommand[] = [
  // ── both views ──
  ...rating,
  ...labels,
  {
    id: 'flag.pick',
    label: 'Flag as pick',
    group: 'Rating & flags',
    context: 'global',
    keys: ['P'],
    run: () => void lib().setMeta({ flag: 'pick' })
  },
  {
    id: 'flag.reject',
    label: 'Flag as reject',
    group: 'Rating & flags',
    context: 'global',
    keys: ['X'],
    run: () => void lib().setMeta({ flag: 'reject' })
  },
  {
    id: 'flag.clear',
    label: 'Remove flag',
    group: 'Rating & flags',
    context: 'global',
    keys: ['U'],
    run: () => void lib().setMeta({ flag: null })
  },
  {
    id: 'export',
    label: 'Export…',
    group: 'Library',
    context: 'global',
    keys: ['Mod+Shift+E'],
    run: () => lib().setDialog('export')
  },
  {
    id: 'sync',
    label: 'Sync settings…',
    group: 'Library',
    context: 'global',
    keys: ['Mod+Shift+S'],
    run: () => lib().setDialog('sync')
  },
  {
    id: 'autoWbBatch',
    label: 'Auto white balance on the selection',
    group: 'Library',
    context: 'global',
    keys: ['Mod+Shift+U'],
    run: () => void autoWbBatch(lib().targets())
  },
  {
    id: 'nav.next',
    label: 'Next photo',
    group: 'Navigation',
    context: 'global',
    keys: ['ArrowRight'],
    run: (e) => step(e, 1)
  },
  {
    id: 'nav.prev',
    label: 'Previous photo',
    group: 'Navigation',
    context: 'global',
    keys: ['ArrowLeft'],
    run: (e) => step(e, -1)
  },

  // ── library ──
  {
    id: 'library.develop',
    label: 'Develop the focused photo',
    group: 'Navigation',
    context: 'library',
    keys: ['Enter', 'D', 'E'],
    when: () => !!lib().focus,
    run: () => {
      const focus = lib().focus
      if (!focus) return
      lib().setView('develop')
      void dev().open(focus)
    }
  },
  {
    id: 'library.selectAll',
    label: 'Select all',
    group: 'Library',
    context: 'library',
    keys: ['Mod+A'],
    run: (e) => {
      lib().selectAll()
      stop(e)
    }
  },
  {
    id: 'library.paste',
    label: 'Paste settings onto the selection…',
    group: 'Library',
    context: 'library',
    keys: ['Mod+V'],
    run: () => lib().setDialog('sync')
  },
  {
    id: 'library.stack',
    label: 'Stack the selection',
    group: 'Library',
    context: 'library',
    keys: ['Mod+G'],
    run: (e) => {
      void lib().stackTargets()
      stop(e)
    }
  },
  {
    id: 'library.unstack',
    label: 'Unstack',
    group: 'Library',
    context: 'library',
    keys: ['Mod+Shift+G'],
    run: (e) => {
      void lib().unstackTargets()
      stop(e)
    }
  },
  {
    id: 'library.toggleStack',
    label: 'Open or close the focused stack',
    group: 'Library',
    context: 'library',
    keys: ['S'],
    when: () => !!focusedItem()?.stack,
    run: () => {
      const stack = focusedItem()?.stack
      if (stack) lib().toggleStack(stack.id)
    }
  },
  {
    id: 'library.makeCover',
    label: "Make the focused photo its stack's cover",
    group: 'Library',
    context: 'library',
    keys: ['Shift+S'],
    when: () => !!focusedItem()?.stack,
    run: () => {
      const f = focusedItem()
      if (f) void lib().makeCover(f.key)
    }
  },
  {
    id: 'library.info',
    label: 'Show or hide the info drawer',
    group: 'View',
    context: 'library',
    keys: ['I'],
    run: () => ui().setLibraryInfo(!ui().libraryInfo)
  },
  {
    id: 'library.sidebar',
    label: 'Show or hide the sources',
    group: 'View',
    context: 'library',
    keys: ['Backslash', 'Mod+Shift+L'],
    run: (e) => {
      ui().setLibrarySidebar(!ui().librarySidebar)
      stop(e)
    }
  },

  // ── develop ──
  {
    id: 'develop.escape',
    label: 'Put the tool down, edit the whole photo, fit, or back to the library',
    group: 'Navigation',
    context: 'develop',
    keys: ['Escape'],
    run: () => {
      const d = dev()
      if (d.tool !== 'none') {
        const wasCrop = d.tool === 'crop'
        d.setTool('none')
        const u = ui()
        if (wasCrop && u.panel === 'crop') u.setPanel(u.previousPanel)
        return
      }
      // A selected mask is what the panels edit: Esc gives them the whole photo back.
      if (scoped.layer()) return d.setLayer(null)
      if (d.zoom.scale !== 'fit') return loupeZoom.fit()
      lib().setView('library')
    }
  },
  {
    id: 'develop.library',
    label: 'Back to the library',
    group: 'Navigation',
    context: 'develop',
    keys: ['G'],
    run: () => lib().setView('library')
  },
  {
    id: 'zoom.in',
    label: 'Zoom in',
    group: 'View',
    context: 'develop',
    keys: ['Mod+Equal', 'Mod+Shift+Equal', 'Mod+NumpadAdd'],
    run: (e) => {
      loupeZoom.in()
      stop(e)
    }
  },
  {
    id: 'zoom.out',
    label: 'Zoom out',
    group: 'View',
    context: 'develop',
    keys: ['Mod+Minus', 'Mod+Shift+Minus', 'Mod+NumpadSubtract'],
    run: (e) => {
      loupeZoom.out()
      stop(e)
    }
  },
  {
    id: 'zoom.fit',
    label: 'Fit to the window',
    group: 'View',
    context: 'develop',
    keys: ['Mod+0'],
    run: (e) => {
      loupeZoom.fit()
      stop(e)
    }
  },
  {
    id: 'undo',
    label: 'Undo',
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+Z'],
    run: () => dev().undo()
  },
  {
    id: 'redo',
    label: 'Redo',
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+Shift+Z'],
    run: () => dev().redoStep()
  },
  ...tools,
  {
    id: 'tool.prev',
    label: 'Turn the wheel up',
    group: 'Tools',
    context: 'develop',
    keys: ['Mod+ArrowUp'],
    run: (e) => {
      stepPanel(-1)
      stop(e)
    }
  },
  {
    id: 'tool.next',
    label: 'Turn the wheel down',
    group: 'Tools',
    context: 'develop',
    keys: ['Mod+ArrowDown'],
    run: (e) => {
      stepPanel(1)
      stop(e)
    }
  },
  {
    id: 'settings.copy',
    label: 'Copy settings',
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+C'],
    when: () => !!dev().recipe,
    run: () => {
      const d = dev()
      if (!d.recipe) return
      const groups = RECIPE_GROUPS.filter(
        (g) => g !== 'crop' && g !== 'orientation' && g !== 'localAdjustments' && g !== 'retouch'
      )
      lib().setClipboard({
        recipe: structuredClone(d.recipe),
        groups: [...groups],
        source: d.session?.key ?? null
      })
      lib().say(
        `Settings copied (${keyHint('settings.paste')} to paste, ${keyHint('sync')} to choose)`
      )
    }
  },
  {
    id: 'settings.paste',
    label: 'Paste settings',
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+V'],
    when: () => !!(lib().clipboard && dev().recipe && dev().session),
    run: () => {
      const l = lib()
      const d = dev()
      if (!l.clipboard || !d.session) return
      const key = d.session.key
      const targets = l.targets()
      void api.library
        .applyRecipe(
          targets,
          l.clipboard.recipe,
          l.clipboard.groups,
          l.clipboard.source ?? undefined
        )
        .then(async (items) => {
          lib().patchItems(items)
          const s = await api.develop.open(key)
          useDevelop.setState({ recipe: s.recipe })
          lib().say(`Pasted onto ${targets.length} photo${targets.length === 1 ? '' : 's'}`)
        })
    }
  },
  {
    id: 'virtualCopy',
    label: 'Make a virtual copy',
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+Quote'],
    run: () => {
      const s = dev().session
      if (s) void api.library.createCopy(s.key).then(() => lib().refresh())
    }
  },
  {
    id: 'mask.duplicate',
    label: 'Duplicate the selected mask or component',
    group: 'Masks',
    context: 'develop.masks',
    keys: ['Mod+D'],
    when: () => masksOpen() && !!dev().layerId,
    run: (e) => {
      stop(e)
      const d = dev()
      if (d.compId) duplicateComponent(d.compId)
      else if (d.layerId) duplicateMask(d.layerId)
    }
  },
  {
    id: 'heal.delete',
    label: 'Delete the selected spot',
    group: 'Heal',
    context: 'develop.heal',
    keys: ['Delete', 'Backspace'],
    when: (e) => healOpen() && notInField(e),
    run: () => {
      const id = dev().spotId
      if (id) deleteSpot(id)
    }
  },
  {
    id: 'tool.heal',
    label: 'Heal tool',
    group: 'Tools',
    context: 'develop',
    keys: ['Q'],
    run: () => selectPanel(healOpen() ? ui().previousPanel : 'heal')
  },
  {
    id: 'mask.delete',
    label: 'Delete the selected mask or component',
    group: 'Masks',
    context: 'develop.masks',
    keys: ['Delete', 'Backspace'],
    when: (e) => masksOpen() && notInField(e),
    run: (e) => {
      const d = dev()
      const layer = d.recipe?.layers.find((l) => l.id === d.layerId)
      if (!layer) return
      stop(e)
      const comp = layer.components.find((c) => c.id === d.compId)
      if (comp) deleteComponent(comp.id)
      else deleteMask(layer.id)
      lib().say(`Deleted ${comp ? componentLabel(comp) : layer.name} — ${keyHint('undo')} to undo`)
    }
  },
  {
    id: 'view.before',
    label: 'Before / after',
    group: 'View',
    context: 'develop',
    keys: ['Backslash'],
    run: () => dev().setCompare(dev().compare === 'before' ? 'off' : 'before')
  },
  {
    id: 'view.split',
    label: 'Before / after split',
    group: 'View',
    context: 'develop',
    keys: ['Y'],
    run: () => dev().setCompare(dev().compare === 'split' ? 'off' : 'split')
  },
  {
    id: 'view.clipping',
    label: 'Show clipping',
    group: 'View',
    context: 'develop',
    keys: ['J'],
    run: () => dev().setClipping(!dev().clipping)
  },
  {
    id: 'zoom.toggle',
    label: 'Fit ↔ 100%',
    group: 'View',
    context: 'develop',
    keys: ['Z'],
    run: () => loupeZoom.toggle()
  },
  {
    id: 'view.pan',
    label: 'Pan (hold and drag)',
    group: 'View',
    context: 'develop',
    keys: ['Space'],
    hold: true,
    run: (e) => {
      setSpace(true)
      stop(e)
    }
  },
  {
    id: 'tool.crop',
    label: 'Crop tool',
    group: 'Tools',
    context: 'develop',
    keys: ['R'],
    run: () => {
      const u = ui()
      if (dev().tool === 'crop') {
        dev().setTool('none')
        return selectPanel(u.panel === 'crop' ? u.previousPanel : u.panel)
      }
      selectPanel('crop', { tool: 'crop' })
    }
  },
  {
    id: 'mask.brush',
    label: 'Brush mask',
    group: 'Masks',
    context: 'develop',
    keys: ['B', 'K'],
    run: () => maskTool('brush')
  },
  {
    id: 'mask.lasso',
    label: 'Lasso mask',
    group: 'Masks',
    context: 'develop',
    keys: ['L'],
    run: () => maskTool('polygon')
  },
  {
    id: 'masks.toggle',
    label: 'Show or hide the masks window',
    group: 'Masks',
    context: 'develop',
    keys: ['M'],
    run: () => toggleMasks()
  },
  {
    id: 'mask.linear',
    label: 'Linear gradient mask',
    group: 'Masks',
    context: 'develop',
    keys: ['Shift+M'],
    run: () => maskTool('linear')
  },
  {
    id: 'mask.radial',
    label: 'Radial gradient mask',
    group: 'Masks',
    context: 'develop',
    keys: ['Alt+M'],
    run: () => maskTool('radial')
  },
  {
    id: 'heal.showAll',
    label: "Show every spot's outline",
    group: 'Heal',
    context: 'develop.heal',
    keys: ['H', 'Shift+H'],
    when: () => healOpen(),
    run: () => ui().setHeal({ showAll: !ui().heal.showAll })
  },
  {
    id: 'mask.hide',
    label: 'Hide or show the selected mask',
    group: 'Masks',
    context: 'develop.masks',
    keys: ['H'],
    when: () => masksOpen() && !!dev().layerId,
    run: () => {
      const d = dev()
      const layer = d.recipe?.layers.find((l) => l.id === d.layerId)
      if (!layer) return
      patchMask(layer.id, layer.enabled ? 'Hide mask' : 'Show mask', (l) => {
        l.enabled = !l.enabled
      })
    }
  },
  {
    id: 'mask.pins',
    label: 'Cycle the mask pins (Auto → Always → Never)',
    group: 'Masks',
    context: 'develop',
    keys: ['Shift+H', 'H'],
    run: () => {
      const order = ['auto', 'always', 'never'] as const
      const cur = order.indexOf(ui().maskOverlay.pins)
      ui().setMaskOverlay({ pins: order[(cur + 1) % order.length] })
    }
  },
  {
    id: 'tool.wb',
    label: 'White balance picker',
    group: 'Tools',
    context: 'develop',
    keys: ['W'],
    run: () => dev().setTool(dev().tool === 'wb-picker' ? 'none' : 'wb-picker')
  },
  {
    id: 'tool.tat',
    label: 'Targeted adjustment (HSL or Tone Curve)',
    group: 'Tools',
    context: 'develop.curve',
    keys: ['T'],
    when: () => panelIs('hsl') || panelIs('curve'),
    run: () => {
      const d = dev()
      if (d.tool === 'tat') return d.setTool('none')
      d.setTatTarget(ui().panel as 'hsl' | 'curve')
      d.setTool('tat')
    }
  },
  {
    id: 'crop.guides',
    label: 'Cycle the crop guides',
    group: 'Crop',
    context: 'develop.crop',
    keys: ['O', 'Shift+O'],
    when: () => dev().tool === 'crop',
    run: () => ui().cycleCropGuide()
  },
  {
    id: 'mask.overlayMode',
    label: 'Cycle how the mask overlay shows',
    group: 'Masks',
    context: 'develop',
    keys: ['Shift+O'],
    run: () => {
      const u = ui()
      const mode = nextOf(
        OVERLAY_MODES.map((m) => m.value),
        u.maskOverlay.mode
      )
      u.setMaskOverlay({ mode })
      dev().setOverlay(true)
      flashHud(OVERLAY_MODES.find((m) => m.value === mode)?.label ?? mode)
    }
  },
  {
    id: 'mask.overlay',
    label: 'Show or hide the mask overlay',
    group: 'Masks',
    context: 'develop',
    keys: ['O'],
    run: () => dev().setOverlay(!dev().overlay)
  },
  {
    id: 'heal.smaller',
    label: 'Smaller heal brush',
    group: 'Heal',
    context: 'develop.heal',
    keys: ['BracketLeft'],
    when: () => healOpen(),
    run: () => ui().setHeal({ size: Math.max(0.002, ui().heal.size / 1.15) })
  },
  {
    id: 'heal.larger',
    label: 'Larger heal brush',
    group: 'Heal',
    context: 'develop.heal',
    keys: ['BracketRight'],
    when: () => healOpen(),
    run: () => ui().setHeal({ size: Math.min(0.25, ui().heal.size * 1.15) })
  },
  {
    id: 'brush.smaller',
    label: 'Smaller mask brush',
    group: 'Masks',
    context: 'develop',
    keys: ['BracketLeft'],
    run: () => {
      const u = ui()
      u.setBrush({ size: Math.max(4, Math.round(u.brushes[u.brushSlot].size / 1.15)) })
    }
  },
  {
    id: 'brush.larger',
    label: 'Larger mask brush',
    group: 'Masks',
    context: 'develop',
    keys: ['BracketRight'],
    run: () => {
      const u = ui()
      u.setBrush({ size: Math.min(500, Math.round(u.brushes[u.brushSlot].size * 1.15)) })
    }
  },
  {
    id: 'autoTone',
    label: 'Auto tone',
    group: 'Edit',
    context: 'develop',
    keys: ['Shift+A'],
    when: () => !!(dev().session && dev().recipe),
    run: () => {
      const s = dev().session
      if (!s) return
      const key = s.key
      void runJob('Auto tone', () => api.develop.autoTone(key), {
        detail: 'Measuring the picture with the tone sliders at zero'
      })
        .then((basic) => {
          const r = dev().recipe
          if (r) dev().replace({ ...r, basic }, 'Auto tone')
        })
        .catch((err) => lib().say(errorText(err), 'error'))
    }
  }
]

function step(e: KeyboardEvent, dir: 1 | -1): void {
  const l = lib()
  const vis = l.visible()
  const i = vis.findIndex((it) => it.key === l.focus)
  const next = vis[Math.min(vis.length - 1, Math.max(0, i + dir))]
  if (!next) return
  l.setFocus(next.key)
  if (l.view === 'develop') void dev().open(next.key)
  stop(e)
}

export const DEFAULT_BINDINGS: Bindings = Object.fromEntries(
  COMMANDS.map((c) => [c.id, c.keys.map(parseChord)])
)

// Two defaults on one key in one place would leave one of them dead.
if (import.meta.env.DEV)
  for (const c of allConflicts(COMMANDS, DEFAULT_BINDINGS))
    console.warn(`Key bindings: ${c.a} and ${c.b} share ${chordLabel(c.chord, false)}`)

/** The bindings in force: the defaults (on this keyboard's layout) with the user's changes on top. */
let cache: { from: Bindings; layout: unknown; out: Bindings } | null = null
export function currentBindings(): Bindings {
  const overrides = useUi.getState().keyBindings
  if (cache?.from !== overrides || cache.layout !== layout)
    cache = { from: overrides, layout, out: resolveBindings(layoutDefaults(), overrides) }
  return cache.out
}

/** The defaults as this keyboard types them (see `onLayout`). */
let onThisLayout: { layout: unknown; out: Bindings } | null = null
export function layoutDefaults(): Bindings {
  if (onThisLayout?.layout !== layout)
    onThisLayout = {
      layout,
      out: layout ? onLayout(DEFAULT_BINDINGS, layoutKey) : DEFAULT_BINDINGS
    }
  return onThisLayout.out
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

/** The layout's own character per key, once the platform has said (Chromium's Keyboard API). */
let layout: Map<string, string> | null = null
const layoutListeners = new Set<() => void>()
{
  const kb = (typeof navigator !== 'undefined' ? navigator : undefined) as
    (Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }) | undefined
  void kb?.keyboard
    ?.getLayoutMap?.()
    .then((m) => {
      layout = m
      layoutListeners.forEach((f) => f())
    })
    .catch(() => undefined)
}
export const layoutKey = (code: string): string | undefined => layout?.get(code)

/** A command's first key as it reads on this platform, or '' when it has none. */
export function keyHint(id: string): string {
  const c = currentBindings()[id]?.[0]
  return c ? chordLabel(c, IS_MAC, layoutKey) : ''
}

/** `"Label (key)"`, or just the label when the command has no key. */
export function withKey(label: string, id: string): string {
  const k = keyHint(id)
  return k ? `${label} (${k})` : label
}

/** `keyHint` for a component, re-rendering when the bindings (or the layout) change. */
export function useKeyHint(): (id: string) => string {
  useUi((s) => s.keyBindings)
  useSyncExternalStore(
    (f) => {
      layoutListeners.add(f)
      return () => layoutListeners.delete(f)
    },
    () => layout
  )
  return keyHint
}

function listening(context: KeyContext, inDevelop: boolean): boolean {
  if (context === 'global') return true
  if (context === 'library') return !inDevelop
  return inDevelop
}

/** The command a key press runs now, if any. */
export function commandFor(e: KeyboardEvent, inDevelop: boolean): KeyCommand | null {
  const pressed = chordOf(e)
  const bindings = currentBindings()
  for (const cmd of COMMANDS) {
    if (!listening(cmd.context, inDevelop)) continue
    if (!bindings[cmd.id]?.some((b) => sameChord(b, pressed))) continue
    if (cmd.when && !cmd.when(e)) continue
    return cmd
  }
  return null
}
