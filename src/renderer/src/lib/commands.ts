/**
 * Every keyboard shortcut, as a command the user can rebind (Settings → Key
 * bindings). The list is in priority order: when one key answers several
 * commands, the first whose `when` holds runs — so a tool's own use of a key
 * (Delete in Heal, [ ] for the heal brush) comes before the general one.
 */
import { rebuild, usePipeline } from './pipeline'
import { suggestedReasons, useCull } from '../state/cull'
import { useSyncExternalStore } from 'react'
import { nextOf } from '../../../shared/masks'
import type { GridMove } from '../../../shared/cullnav'
import {
  jumpToCard,
  masksOpen,
  openDrawer,
  openMasks,
  stepCard,
  toggleDrawer,
  toggleMasks
} from '../develop/tools'
import { CARDS, panelTitle, type PanelId } from '../../../shared/cards'
import {
  componentLabel,
  deleteComponent,
  deleteMask,
  duplicateComponent,
  duplicateMask,
  patchComponent,
  patchMask,
  startMaskTool
} from '../panels/masks/model'
import { runJob } from '../state/busy'
import { useDevelop } from '../state/develop'
import { useExports } from '../state/exports'
import { scoped } from '../state/scope'
import { useLibrary } from '../state/library'
import { choosePhotos } from './openPhotos'
import { OVERLAY_MODES, useUi } from '../state/ui'
import { cycleScope } from '../../../shared/scopes'
import { flashHud } from '../views/loupe/hudNote'
import { loupeZoom, setSpace } from '../views/loupe/zoom'
import { api, errorText } from './api'
import { autoWbBatch } from './autowb'
import { makeProofCopies, makeProofCopy, toggleProofSplit } from './proofing'
import { copySettings, pasteSettings } from './clipboard'
import { developBatch, gridStep, inGrid, metaItem, metaTargets } from './librarycontext'
import { redoLibrary, undoAction, undoLibrary, useLibraryUndo } from '../state/libraryUndo'
import { t, tk, tp } from './i18n'
import {
  allConflicts,
  chordLabel,
  chordOf,
  modifierKey,
  modifierName,
  onLayout,
  parseChord,
  resolveBindings,
  sameChord,
  type Bindings,
  type KeyContext,
  type Modifier
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
  tk('Rating & flags'),
  tk('Navigation'),
  tk('Library'),
  tk('Edit'),
  tk('View'),
  tk('Tools'),
  tk('Masks'),
  tk('Heal'),
  tk('Crop')
] as const

const lib = (): ReturnType<typeof useLibrary.getState> => useLibrary.getState()
const dev = (): ReturnType<typeof useDevelop.getState> => useDevelop.getState()
const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()

const healOpen = (): boolean => ui().drawer === 'heal'
/** Whether a card is the section the column shows. */
const cardShown = (id: 'mixer' | 'curve'): boolean =>
  ui().drawer === 'adjust' && ui().focusCard === id
const notInField = (e: KeyboardEvent): boolean => (e.target as HTMLElement)?.tagName !== 'INPUT'
const focusedItem = (): ReturnType<typeof lib>['items'][number] | undefined =>
  lib().items.find((i) => i.key === lib().focus)

function stop(e: KeyboardEvent): void {
  e.preventDefault()
}

/** Into the selected mask, or (as in Lightroom) a new one. */
function maskTool(tool: 'brush' | 'polygon' | 'linear' | 'radial' | 'bidirectional'): void {
  const d = dev()
  if (d.tool === tool) return d.setTool('none')
  if (!d.layerId) return void startMaskTool(tool)
  openMasks()
  // A mask tool takes the canvas from Heal (whose panel stays up).
  d.setTool(tool)
}

/** The suggested rejects shown, flagged rejected at once (one key: never deleted). */
export async function rejectSuggested(): Promise<void> {
  const { reasons } = useCull.getState()
  const keys = lib()
    .visible()
    .filter((i) => suggestedReasons(i, reasons))
    .map((i) => i.key)
  if (keys.length === 0) return lib().say(t('No suggested rejects here'), 'info')
  const last = useLibraryUndo.getState().done.at(-1)
  await lib().setMeta({ flag: 'reject' }, keys)
  // Not asked for after all, or not written: nothing to say.
  const entry = useLibraryUndo.getState().done.at(-1)
  if (!entry || entry === last) return
  lib().say(
    tp(
      '{{count}} photo flagged rejected: nothing deleted',
      '{{count}} photos flagged rejected: nothing deleted',
      keys.length
    ),
    'info',
    undoAction(entry)
  )
}

const RATING_LABELS = [
  tk('Clear rating'),
  tk('Rate 1 star'),
  tk('Rate 2 stars'),
  tk('Rate 3 stars'),
  tk('Rate 4 stars'),
  tk('Rate 5 stars')
]

const COLOUR_LABELS = {
  red: tk('Colour label: red'),
  yellow: tk('Colour label: yellow'),
  green: tk('Colour label: green'),
  blue: tk('Colour label: blue')
}

const rating = [0, 1, 2, 3, 4, 5].map<KeyCommand>((n) => ({
  id: `rate.${n}`,
  label: RATING_LABELS[n],
  group: 'Rating & flags',
  context: 'global',
  keys: [String(n)],
  // The selection in the Grid; the photo shown anywhere else (UX-13).
  run: () => void lib().setMeta({ rating: n }, metaTargets())
}))

const labels = (['red', 'yellow', 'green', 'blue'] as const).map<KeyCommand>((label, i) => ({
  id: `label.${label}`,
  label: COLOUR_LABELS[label],
  group: 'Rating & flags',
  context: 'global',
  keys: [String(6 + i)],
  run: () => {
    const current = metaItem()?.label
    void lib().setMeta({ label: current === label ? null : label }, metaTargets())
  }
}))

/**
 * ⌘1…⌘9 as in Lightroom Classic: Basic, Tone curve, HSL, Colour grading,
 * Detail, Optics, Geometry, Effects, Calibration. With Resolve's tools the
 * curve's and the grading's keys show their Resolve twins.
 */
const PANEL_KEYS: Partial<Record<PanelId, number>> = {
  basic: 1,
  curve: 2,
  mixer: 3,
  primaries: 4,
  detail: 5,
  optics: 6,
  geometry: 7,
  effects: 8,
  calibration: 9
}
// Lightroom's Colour grading (legacy) is offered only on photos using it: no command.
const PANELS: PanelId[] = ['basic', ...CARDS.filter((c) => !c.basic && !c.legacy).map((c) => c.id)]
const cards = PANELS.map<KeyCommand>((id) => ({
  id: `card.${id}`,
  // Made when read, in the language in force (`t()` of it where it is shown changes nothing).
  get label() {
    return t('Show {{card}}', { card: t(panelTitle(id)) })
  },
  group: 'Tools',
  context: 'develop',
  keys: PANEL_KEYS[id] ? [`Mod+${PANEL_KEYS[id]}`] : [],
  run: (e) => {
    jumpToCard(id)
    stop(e)
  }
}))

export const COMMANDS: KeyCommand[] = [
  // ── both views ──
  ...rating,
  ...labels,
  {
    id: 'flag.pick',
    label: tk('Flag as pick'),
    group: 'Rating & flags',
    context: 'global',
    keys: ['P'],
    run: () => void lib().setMeta({ flag: 'pick' }, metaTargets())
  },
  {
    id: 'flag.reject',
    label: tk('Flag as reject'),
    group: 'Rating & flags',
    context: 'global',
    keys: ['X'],
    run: () => void lib().setMeta({ flag: 'reject' }, metaTargets())
  },
  {
    id: 'cull.rejectAll',
    label: tk('Reject every suggested reject shown'),
    group: 'Rating & flags',
    context: 'library',
    keys: ['Shift+X'],
    run: () => void rejectSuggested()
  },
  {
    id: 'cull.keep',
    label: tk('Keep: not a suggested reject'),
    group: 'Rating & flags',
    context: 'library',
    keys: ['Shift+K'],
    run: () => {
      const keys = lib().targets()
      if (keys.length) void useCull.getState().keep(keys)
    }
  },
  {
    id: 'flag.clear',
    label: tk('Remove flag'),
    group: 'Rating & flags',
    context: 'global',
    keys: ['U'],
    run: () => void lib().setMeta({ flag: null }, metaTargets())
  },
  {
    id: 'export',
    label: tk('Export…'),
    group: 'Library',
    context: 'global',
    keys: ['Mod+Shift+E'],
    run: () => lib().setDialog('export')
  },
  {
    id: 'export.previous',
    label: tk('Export with previous'),
    group: 'Library',
    context: 'global',
    // Lightroom's key for it.
    keys: ['Mod+Alt+Shift+E'],
    when: () => useExports.getState().last !== null && lib().targets().length > 0,
    run: () => void useExports.getState().previous()
  },
  {
    id: 'library.openPhotos',
    label: tk('Open a photo…'),
    group: 'Library',
    context: 'global',
    keys: ['Mod+O'],
    run: (e) => {
      void choosePhotos()
      stop(e)
    }
  },
  {
    id: 'library.chooseFolder',
    label: tk('Open a folder…'),
    group: 'Library',
    context: 'global',
    keys: ['Mod+Shift+O'],
    run: (e) => {
      void lib().chooseFolder()
      stop(e)
    }
  },
  {
    id: 'settings.pasteSpecial',
    label: tk('Choose settings to paste…'),
    group: 'Edit',
    context: 'global',
    keys: ['Mod+Shift+V'],
    when: () => !!lib().clipboard,
    run: (e) => {
      lib().setDialog('paste')
      stop(e)
    }
  },
  {
    id: 'sync',
    label: tk('Sync settings…'),
    group: 'Library',
    context: 'global',
    keys: ['Mod+Shift+S'],
    run: () => lib().setDialog('sync')
  },
  {
    id: 'autoWbBatch',
    label: tk('Auto white balance on the selection'),
    group: 'Library',
    context: 'global',
    keys: ['Mod+Shift+U'],
    run: () => void autoWbBatch(lib().targets())
  },
  {
    id: 'rebuild',
    label: tk('Rebuild with the latest develop'),
    group: 'Library',
    context: 'global',
    keys: [],
    // With a newer develop than an edit could have been made with (shared/rebuild.ts).
    when: () => {
      const p = usePipeline.getState()
      return (p.pixlDemosaic || p.pixlEnhance) && lib().targets().length > 0
    },
    run: () => void rebuild(lib().targets()).catch((err) => lib().say(errorText(err), 'error'))
  },
  {
    id: 'nav.next',
    label: tk('Next photo'),
    group: 'Navigation',
    context: 'global',
    keys: ['ArrowRight'],
    run: (e) => step(e, 1)
  },
  {
    id: 'nav.prev',
    label: tk('Previous photo'),
    group: 'Navigation',
    context: 'global',
    keys: ['ArrowLeft'],
    run: (e) => step(e, -1)
  },

  // ── library ──
  {
    id: 'library.develop',
    label: tk('Develop the focused photo'),
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
    label: tk('Select all'),
    group: 'Library',
    context: 'library',
    keys: ['Mod+A'],
    run: (e) => {
      lib().selectAll()
      stop(e)
    }
  },
  {
    id: 'library.undo',
    label: tk('Undo in the library'),
    group: 'Edit',
    context: 'library',
    keys: ['Mod+Z'],
    run: (e) => {
      void undoLibrary()
      stop(e)
    }
  },
  {
    id: 'library.redo',
    label: tk('Redo in the library'),
    group: 'Edit',
    context: 'library',
    keys: ['Mod+Shift+Z'],
    run: (e) => {
      void redoLibrary()
      stop(e)
    }
  },
  {
    id: 'library.copy',
    label: tk("Copy the focused photo's settings"),
    group: 'Edit',
    context: 'library',
    keys: ['Mod+C'],
    // Text selected (the info pane's): ⌘C copies that.
    when: () => !!lib().focus && !document.getSelection()?.toString(),
    run: () => {
      const focus = lib().focus
      if (focus) void copySettings(focus)
    }
  },
  {
    id: 'library.paste',
    label: tk('Paste settings onto the selection'),
    group: 'Edit',
    context: 'library',
    keys: ['Mod+V'],
    when: () => !!lib().clipboard && lib().targets().length > 0,
    run: () => void pasteSettings(lib().targets())
  },
  ...gridMoves(),
  {
    id: 'library.stack',
    label: tk('Stack the selection'),
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
    label: tk('Unstack'),
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
    label: tk('Open or close the focused stack'),
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
    label: tk('Make the focused photo its stack’s cover'),
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
    label: tk('Show or hide the info drawer'),
    group: 'View',
    context: 'library',
    keys: ['I'],
    run: () => ui().setLibraryInfo(!ui().libraryInfo)
  },
  {
    id: 'library.sidebar',
    label: tk('Show or hide the sources'),
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
    label: tk('Put the tool down, edit the whole photo, fit, or back to the library'),
    group: 'Navigation',
    context: 'develop',
    keys: ['Escape'],
    run: () => {
      const d = dev()
      if (d.tool !== 'none') {
        // Crop's and Heal's panels go with their tools: the cards come back.
        if (d.tool === 'crop' || d.tool === 'heal' || d.tool === 'upright-guide')
          return openDrawer('adjust')
        d.setTool('none')
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
    label: tk('Back to the library'),
    group: 'Navigation',
    context: 'develop',
    keys: ['G'],
    run: () => lib().setView('library')
  },
  {
    id: 'zoom.in',
    label: tk('Zoom in'),
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
    label: tk('Zoom out'),
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
    label: tk('Fit to the window'),
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
    label: tk('Undo'),
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+Z'],
    // Straight after a paste or sync on several photos: the whole batch.
    run: () => (developBatch(false) ? void undoLibrary() : dev().undo())
  },
  {
    id: 'redo',
    label: tk('Redo'),
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+Shift+Z'],
    run: () => (developBatch(true) ? void redoLibrary() : dev().redoStep())
  },
  ...cards,
  {
    id: 'tool.prev',
    label: tk('Previous panel'),
    group: 'Tools',
    context: 'develop',
    keys: ['Mod+ArrowUp'],
    run: (e) => {
      stepCard(-1)
      stop(e)
    }
  },
  {
    id: 'tool.next',
    label: tk('Next panel'),
    group: 'Tools',
    context: 'develop',
    keys: ['Mod+ArrowDown'],
    run: (e) => {
      stepCard(1)
      stop(e)
    }
  },
  {
    id: 'settings.copy',
    label: tk('Copy settings'),
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+C'],
    // Text selected (the info pane's): ⌘C copies that.
    when: () => !!dev().recipe && !document.getSelection()?.toString(),
    run: () => {
      const key = dev().session?.key
      if (key) void copySettings(key)
    }
  },
  {
    id: 'settings.paste',
    label: tk('Paste settings'),
    group: 'Edit',
    context: 'develop',
    keys: ['Mod+V'],
    when: () => !!(lib().clipboard && dev().recipe && dev().session),
    // The open photo, or the filmstrip's selection: one batch, one Undo.
    run: () => void pasteSettings(lib().targets())
  },
  {
    id: 'virtualCopy',
    label: tk('Make a virtual copy'),
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
    label: tk('Duplicate the selected mask or component'),
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
    id: 'mask.invert',
    label: tk('Invert the selected component, or the mask'),
    group: 'Masks',
    context: 'develop.masks',
    keys: ['Quote'],
    when: (e) => masksOpen() && !!dev().layerId && notInField(e),
    run: (e) => {
      stop(e)
      const d = dev()
      if (d.compId) patchComponent(d.compId, tk('Invert component'), (c) => (c.invert = !c.invert))
      else if (d.layerId) patchMask(d.layerId, tk('Invert mask'), (l) => (l.invert = !l.invert))
    }
  },
  {
    id: 'tool.heal',
    label: tk('Heal tool'),
    group: 'Tools',
    context: 'develop',
    keys: ['Q'],
    run: () => toggleDrawer('heal')
  },
  {
    id: 'mask.delete',
    label: tk('Delete the selected mask or component'),
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
      lib().say(
        t('Deleted {{name}} — {{key}} to undo', {
          name: comp ? componentLabel(comp) : layer.name,
          key: keyHint('undo')
        })
      )
    }
  },
  {
    id: 'view.before',
    label: tk('Before / after'),
    group: 'View',
    context: 'develop',
    keys: ['Backslash'],
    run: () => dev().setCompare(dev().compare === 'before' ? 'off' : 'before')
  },
  {
    id: 'view.split',
    label: tk('Before / after split'),
    group: 'View',
    context: 'develop',
    keys: ['Y'],
    run: () => dev().setCompare(dev().compare === 'split' ? 'off' : 'split')
  },
  {
    id: 'view.clipping',
    label: tk('Show clipping'),
    group: 'View',
    context: 'develop',
    keys: ['J'],
    run: () => dev().setClipping(!dev().clipping)
  },
  {
    id: 'view.gamut',
    label: tk('Show gamut warning'),
    group: 'View',
    context: 'develop',
    keys: ['Shift+J'],
    run: () => dev().setGamut(!dev().gamut)
  },
  {
    id: 'view.proof',
    label: tk('Soft proofing'),
    group: 'View',
    context: 'develop',
    keys: ['S'],
    when: () => !!dev().session,
    run: () => void dev().setProof(!dev().proof)
  },
  {
    id: 'view.proofSetup',
    label: tk('Proof setup'),
    group: 'View',
    context: 'develop',
    keys: ['Alt+S'],
    when: () => !!dev().session,
    run: (e) => {
      stop(e)
      dev().setProofSetup(!dev().proofSetup)
    }
  },
  {
    id: 'view.proofSplit',
    label: tk('Screen / proof split'),
    group: 'View',
    context: 'develop',
    keys: ['Shift+Y'],
    when: () => !!dev().session,
    run: () => void toggleProofSplit()
  },
  {
    id: 'proof.copy',
    label: tk('Make a proof copy'),
    group: 'Edit',
    context: 'develop',
    keys: [],
    when: () => !!dev().session,
    run: () => void makeProofCopy()
  },
  {
    id: 'library.proofCopies',
    label: tk('Make proof copies of the selection'),
    group: 'Library',
    context: 'library',
    keys: [],
    when: () => lib().targets().length > 0,
    run: () => void makeProofCopies(lib().targets())
  },
  {
    id: 'scopes.next',
    label: tk('Next scope'),
    group: 'View',
    context: 'develop',
    keys: ['Alt+BracketRight'],
    run: () => {
      const u = useUi.getState()
      u.setScopes({ inline: cycleScope(u.scopes.inline, 1) })
    }
  },
  {
    id: 'scopes.prev',
    label: tk('Previous scope'),
    group: 'View',
    context: 'develop',
    keys: ['Alt+BracketLeft'],
    run: () => {
      const u = useUi.getState()
      u.setScopes({ inline: cycleScope(u.scopes.inline, -1) })
    }
  },
  {
    id: 'zoom.toggle',
    label: tk('Fit ↔ 100%'),
    group: 'View',
    context: 'develop',
    keys: ['Z'],
    run: () => loupeZoom.toggle()
  },
  {
    id: 'view.pan',
    label: tk('Pan (hold and drag)'),
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
    id: 'view.messages',
    label: tk('Recent messages'),
    group: 'View',
    context: 'global',
    keys: ['Mod+Shift+M'],
    run: () => lib().setDialog('messages')
  },
  {
    id: 'tool.crop',
    label: tk('Crop tool'),
    group: 'Tools',
    context: 'develop',
    keys: ['R'],
    run: () => toggleDrawer('crop')
  },
  {
    id: 'mask.brush',
    label: tk('Brush mask'),
    group: 'Masks',
    context: 'develop',
    keys: ['B', 'K'],
    run: () => maskTool('brush')
  },
  {
    id: 'mask.lasso',
    label: tk('Lasso mask'),
    group: 'Masks',
    context: 'develop',
    keys: ['L'],
    run: () => maskTool('polygon')
  },
  {
    id: 'masks.toggle',
    label: tk('Show or hide the masks window'),
    group: 'Masks',
    context: 'develop',
    keys: ['M'],
    run: () => toggleMasks()
  },
  {
    id: 'mask.linear',
    label: tk('Linear gradient mask'),
    group: 'Masks',
    context: 'develop',
    keys: ['Shift+M'],
    run: () => maskTool('linear')
  },
  {
    id: 'mask.radial',
    label: tk('Radial gradient mask'),
    group: 'Masks',
    context: 'develop',
    keys: ['Alt+M'],
    run: () => maskTool('radial')
  },
  {
    id: 'mask.objects',
    label: tk('Objects mask (select by pointing)'),
    group: 'Masks',
    context: 'develop',
    keys: [],
    run: () => (dev().tool === 'objects' ? dev().setTool('none') : startMaskTool('objects'))
  },
  {
    id: 'mask.bidirectional',
    label: tk('Bidirectional gradient mask'),
    group: 'Masks',
    context: 'develop',
    keys: [],
    run: () => maskTool('bidirectional')
  },
  {
    id: 'mask.hide',
    label: tk('Hide or show the selected mask'),
    group: 'Masks',
    context: 'develop.masks',
    keys: ['H'],
    when: () => masksOpen() && !!dev().layerId,
    run: () => {
      const d = dev()
      const layer = d.recipe?.layers.find((l) => l.id === d.layerId)
      if (!layer) return
      patchMask(layer.id, layer.enabled ? tk('Hide mask') : tk('Show mask'), (l) => {
        l.enabled = !l.enabled
      })
    }
  },
  {
    id: 'tool.wb',
    label: tk('White balance picker'),
    group: 'Tools',
    context: 'develop',
    keys: ['W'],
    run: () => dev().setTool(dev().tool === 'wb-picker' ? 'none' : 'wb-picker')
  },
  {
    id: 'tool.tat',
    label: tk('Targeted adjustment (HSL or Curves)'),
    group: 'Tools',
    context: 'develop.curve',
    keys: ['T'],
    when: () => cardShown('mixer') || cardShown('curve'),
    run: () => {
      const d = dev()
      if (d.tool === 'tat') return d.setTool('none')
      // The focused card if it is one of the two, else whichever is open.
      const focus = ui().focusCard
      const curve = focus === 'curve' || (focus !== 'mixer' && cardShown('curve'))
      d.setTatTarget(curve && cardShown('curve') ? 'curve' : 'hsl')
      d.setTool('tat')
    }
  },
  {
    id: 'crop.guides',
    label: tk('Cycle the crop guides'),
    group: 'Crop',
    context: 'develop.crop',
    keys: ['O', 'Shift+O'],
    when: () => dev().tool === 'crop',
    run: () => ui().cycleCropGuide()
  },
  {
    id: 'mask.overlayMode',
    label: tk('Cycle how the mask overlay shows'),
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
      flashHud(t(OVERLAY_MODES.find((m) => m.value === mode)?.label ?? mode))
    }
  },
  {
    id: 'mask.overlay',
    label: tk('Show or hide the mask overlay'),
    group: 'Masks',
    context: 'develop',
    keys: ['O'],
    run: () => dev().setOverlay(!dev().overlay)
  },
  {
    id: 'heal.smaller',
    label: tk('Smaller heal brush'),
    group: 'Heal',
    context: 'develop.heal',
    keys: ['BracketLeft'],
    when: () => healOpen(),
    run: () => ui().setHeal({ size: Math.max(0.002, ui().heal.size / 1.15) })
  },
  {
    id: 'heal.larger',
    label: tk('Larger heal brush'),
    group: 'Heal',
    context: 'develop.heal',
    keys: ['BracketRight'],
    when: () => healOpen(),
    run: () => ui().setHeal({ size: Math.min(0.25, ui().heal.size * 1.15) })
  },
  {
    id: 'brush.smaller',
    label: tk('Smaller mask brush'),
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
    label: tk('Larger mask brush'),
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
    label: tk('Auto tone'),
    group: 'Edit',
    context: 'develop',
    keys: ['Shift+A'],
    when: () => !!(dev().session && dev().recipe),
    run: () => {
      const s = dev().session
      if (!s) return
      const key = s.key
      void runJob(t('Auto tone'), () => api.develop.autoTone(key))
        .then((basic) => {
          const r = dev().recipe
          if (r) dev().replace({ ...r, basic }, tk('Auto tone'))
        })
        .catch((err) => lib().say(errorText(err), 'error'))
    }
  }
]

/**
 * The grid's keyboard moves (⇧ extends the selection), listening while the
 * grid is up and the key is not already taken (a menu or dropdown with the
 * keyboard moves its own items with the arrows).
 */
function gridMoves(): KeyCommand[] {
  const free = (e: KeyboardEvent): boolean => inGrid() && !e.defaultPrevented
  const moves: [GridMove, string, string][] = [
    ['up', tk('Up a row (⇧ extends the selection)'), 'ArrowUp'],
    ['down', tk('Down a row (⇧ extends the selection)'), 'ArrowDown'],
    ['home', tk('First photo (⇧ extends the selection)'), 'Home'],
    ['end', tk('Last photo (⇧ extends the selection)'), 'End'],
    ['pageUp', tk('Up a page (⇧ extends the selection)'), 'PageUp'],
    ['pageDown', tk('Down a page (⇧ extends the selection)'), 'PageDown']
  ]
  const extend = (dir: 1 | -1, id: string, label: string, key: string): KeyCommand => ({
    id,
    label,
    group: 'Navigation',
    context: 'library.grid',
    keys: [key],
    when: free,
    run: (e) => {
      const l = lib()
      const vis = l.visible()
      const i = vis.findIndex((it) => it.key === l.focus)
      const next = vis[Math.min(vis.length - 1, Math.max(0, i + dir))]
      if (next) l.moveTo(next.key, true)
      stop(e)
    }
  })
  return [
    ...moves.map<KeyCommand>(([move, label, key]) => ({
      id: `grid.${move}`,
      label,
      group: 'Navigation',
      context: 'library.grid',
      keys: [key, `Shift+${key}`],
      when: free,
      run: (e) => {
        gridStep(move, e.shiftKey)
        stop(e)
      }
    })),
    extend(-1, 'grid.extendPrev', tk('Extend the selection to the left'), 'Shift+ArrowLeft'),
    extend(1, 'grid.extendNext', tk('Extend the selection to the right'), 'Shift+ArrowRight')
  ]
}

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

/** A modifier named for this platform, for a sentence ("Option-click removes"). */
export const modName = (m: Modifier): string => modifierName(m, IS_MAC)

/** A modifier ahead of a key for this platform ("⌥↑↓", "Alt+↑↓"). */
export const modKey = (m: Modifier): string => modifierKey(m, IS_MAC)

/**
 * A key no command holds, as this platform shows it (`"Mod+Alt+E"` is ⌥⌘E on
 * a Mac, Ctrl+Alt+E elsewhere): a menu's accelerator, Escape, Return.
 */
export function chordText(spec: string): string {
  return chordLabel(parseChord(spec), IS_MAC, layoutKey)
}

/** `"Label (key)"` for a key no command holds. */
export const withChord = (label: string, spec: string): string => `${label} (${chordText(spec)})`

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

/** Whether a command's context is listening in this view. */
export function listening(context: KeyContext, inDevelop: boolean): boolean {
  if (context === 'global') return true
  if (context === 'library' || context === 'library.grid') return !inDevelop
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
