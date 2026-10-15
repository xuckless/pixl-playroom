/**
 * The native menus' contents (shared/appmenu.ts): the menu bar and the
 * right-click menus, built from the key-binding commands (lib/commands.ts),
 * so each item does what its key does, shows the user's own key, and is
 * greyed where the key wouldn't act. The bar is sent to main again as what
 * applies changes; a right-click menu is built when it is asked for.
 */
import { usePipeline } from './pipeline'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { panelsFor, panelTitle } from '../../../shared/cards'
import { editsInHdr } from '../../../shared/recipe'
import { SEPARATOR, tidyMenu, type MenuBarSpec, type MenuNode } from '../../../shared/appmenu'
import type { LibraryItem } from '../../../shared/ipc'
import { jumpToCard, masksOpen } from '../develop/tools'
import { MASK_TOOL_GROUPS, startMaskTool } from '../panels/masks/model'
import { useConfirm } from '../state/confirm'
import { suggestedReasons, useCull } from '../state/cull'
import { useDevelop } from '../state/develop'
import { useExports } from '../state/exports'
import { aboveWhite, canShowHdr, useDisplay } from '../state/display'
import { selectionSet, useLibrary } from '../state/library'
import { useUi } from '../state/ui'
import { undoTitles, useLibraryUndo } from '../state/libraryUndo'
import type { MetaPatch } from '../../../shared/ipc'
import { api, errorText } from './api'
import { nameOfKey } from './clipboard'
import { t, tp, useLanguage } from './i18n'
import { COMMANDS, currentBindings, IS_MAC, layoutKey, listening } from './commands'
import { chordAccelerator } from './keys'
import { isInteracting } from './interacting'
import { changedBeyond } from './storechange'
import { developBatch, metaItem } from './librarycontext'
import { developToLoupe, goCompare, goGrid, goLoupe, goSurvey, shownKey } from './librarymodes'
import { useLibZoom } from '../views/library/libzoom'
import { comparePaneOf, type LibraryMode } from '../../../shared/cullnav'

/** A menu item with what it does, before it is sent. */
interface Item extends Omit<MenuNode, 'submenu'> {
  run?: () => void
  submenu?: Item[]
}

const lib = (): ReturnType<typeof useLibrary.getState> => useLibrary.getState()
const dev = (): ReturnType<typeof useDevelop.getState> => useDevelop.getState()
const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()

const byId = new Map(COMMANDS.map((c) => [c.id, c]))
/** A command run from a menu has no key: an event that stands in for one. */
const noKey = (): KeyboardEvent => new KeyboardEvent('keydown')

const inDevelop = (): boolean => lib().view === 'develop'
/** A dialog or a confirm has the app: the menus wait for it, bar Settings and Help. */
const modal = (): boolean => !!lib().dialog || !!useConfirm.getState().open

/** Whether the command's key would act now. */
export function available(id: string): boolean {
  const c = byId.get(id)
  if (!c || modal()) return false
  if (!listening(c.context, inDevelop())) return false
  return !c.when || c.when(noKey())
}

function runCommand(id: string): void {
  const c = byId.get(id)
  if (c && available(id)) c.run(noKey())
}

/** The command's first key, as a menu shows it. */
function accel(id: string): string | undefined {
  const chord = currentBindings()[id]?.[0]
  return (chord && chordAccelerator(chord, layoutKey)) || undefined
}

const sep = SEPARATOR as Item

/** An item that runs a key-binding command, shown with its key. */
function cmd(id: string, label: string, extra: Partial<Item> = {}): Item {
  return {
    id: `cmd:${id}`,
    label,
    accelerator: accel(id),
    enabled: available(id),
    run: () => runCommand(id),
    ...extra
  }
}

/** An item of the menus' own, with the key of the command it stands beside (if any). */
function act(
  id: string,
  label: string,
  run: () => void,
  extra: Partial<Item> & { key?: string } = {}
): Item {
  const { key, ...rest } = extra
  return {
    id,
    label,
    accelerator: key ? accel(key) : undefined,
    enabled: !modal(),
    run,
    ...rest
  }
}

const focusedItem = (): LibraryItem | undefined => lib().items.find((i) => i.key === lib().focus)
export const revealLabel = (): string =>
  IS_MAC
    ? t('Show in Finder')
    : navigator.platform.startsWith('Win')
      ? t('Show in Explorer')
      : t('Show in Folder')

/** A text field, or editable text, has the focus: Undo and Select All are its. */
function editing(): boolean {
  const a = document.activeElement as HTMLElement | null
  if (!a) return false
  if (a.isContentEditable || a.tagName === 'TEXTAREA') return true
  if (a.tagName !== 'INPUT') return false
  const type = (a as HTMLInputElement).type
  return !['range', 'checkbox', 'radio', 'button', 'color', 'file'].includes(type)
}

// ── the pieces both kinds of menu use ──

/**
 * A rating, flag or label item: its key's command, or, for a photo's own menu
 * (`keys` given), that change on those photos, shown with the same key.
 */
function metaCmd(
  id: string,
  label: string,
  patch: MetaPatch,
  keys: string[] | undefined,
  extra: Partial<Item>
): Item {
  if (!keys) return cmd(id, label, extra)
  return act(`${id}:menu`, label, () => void lib().setMeta(patch, keys), {
    key: id,
    enabled: !modal() && keys.length > 0,
    ...extra
  })
}

/** The photo a menu's checks read: the first of `keys`, else the one the keys act on. */
const menuItem = (keys?: string[]): LibraryItem | undefined =>
  keys ? lib().items.find((i) => i.key === keys[0]) : metaItem()

function ratingMenu(keys?: string[]): Item {
  const now = menuItem(keys)?.rating
  return {
    label: t('Rating'),
    submenu: [0, 1, 2, 3, 4, 5].map((n) =>
      metaCmd(`rate.${n}`, n === 0 ? t('None') : '★'.repeat(n), { rating: n }, keys, {
        checked: now === n,
        radio: true
      })
    )
  }
}

function flagMenu(keys?: string[]): Item {
  const now = menuItem(keys)?.flag ?? null
  return {
    label: t('Flag'),
    submenu: [
      metaCmd('flag.pick', t('Pick|flag'), { flag: 'pick' }, keys, {
        checked: now === 'pick',
        radio: true
      }),
      metaCmd('flag.reject', t('Reject'), { flag: 'reject' }, keys, {
        checked: now === 'reject',
        radio: true
      }),
      metaCmd('flag.clear', t('None'), { flag: null }, keys, { checked: now === null, radio: true })
    ]
  }
}

function labelMenu(keys?: string[]): Item {
  const now = menuItem(keys)?.label ?? null
  const label = {
    red: t('Red'),
    yellow: t('Yellow'),
    green: t('Green'),
    blue: t('Blue')
  }
  return {
    label: t('Colour Label'),
    submenu: (['red', 'yellow', 'green', 'blue'] as const).map((c) =>
      metaCmd(`label.${c}`, label[c], { label: now === c ? null : c }, keys, {
        checked: now === c
      })
    )
  }
}

function copySettings(): Item {
  return inDevelop()
    ? cmd('settings.copy', t('Copy Settings'))
    : cmd('library.copy', t('Copy Settings'))
}

function pasteSettings(): Item {
  return inDevelop()
    ? cmd('settings.paste', t('Paste Settings'))
    : cmd('library.paste', t('Paste Settings'))
}

/** ⇧⌘V, and Sync named after the photo it copies from (UX-05). */
function pasteMoreItems(): Item[] {
  const source = inDevelop() ? dev().session?.key : lib().focus
  return [
    cmd('settings.pasteSpecial', t('Choose Settings to Paste…')),
    cmd(
      'sync',
      source ? t('Sync Settings from {{name}}…', { name: nameOfKey(source) }) : t('Sync Settings…')
    )
  ]
}

function makeCopy(): Item {
  return act(
    'photo.virtualCopy',
    t('Make Virtual Copy'),
    () => {
      const key = inDevelop() ? dev().session?.key : lib().focus
      if (!key) return
      void api.library
        .createCopy(key)
        .then(() => lib().refresh())
        .then(() => lib().say(t('Virtual copy created')))
        .catch((err) => lib().say(errorText(err), 'error'))
    },
    { key: 'virtualCopy', enabled: !modal() && !!(inDevelop() ? dev().session : lib().focus) }
  )
}

/** A proof copy of the open photo (Develop), or of each photo selected (Library). */
function proofCopies(): Item {
  if (inDevelop()) return cmd('proof.copy', t('Make Proof Copy'))
  const n = lib().targets().length
  return cmd(
    'library.proofCopies',
    n > 1
      ? tp('Make {{count}} Proof Copy…', 'Make {{count}} Proof Copies…', n)
      : t('Make Proof Copy…')
  )
}

function stackMenu(): Item {
  return {
    label: t('Stacking'),
    submenu: [
      cmd('library.stack', t('Group into Stack')),
      cmd('library.unstack', t('Unstack')),
      sep,
      cmd('library.toggleStack', t('Open or Close Stack')),
      cmd('library.makeCover', t('Make Stack Cover'))
    ]
  }
}

function collectionMenu(): Item {
  const manual = lib().collections.filter((c) => c.kind === 'manual')
  return {
    label: t('Add to Collection'),
    submenu: manual.map((c) =>
      act(
        `collection.add:${c.id}`,
        c.name,
        () => void lib().addToCollection(c.id, lib().targets()),
        {
          enabled: !modal() && lib().targets().length > 0
        }
      )
    )
  }
}

function revealItems(): Item[] {
  const path = (): string | undefined =>
    inDevelop() ? dev().session?.item.path : focusedItem()?.path
  const able = !modal() && !!path()
  return [
    act(
      'file.reveal',
      revealLabel(),
      () => {
        const p = path()
        if (p) void api.app.reveal(p)
      },
      { enabled: able }
    ),
    act(
      'file.copyPath',
      t('Copy File Path'),
      () => {
        const p = path()
        if (p) void navigator.clipboard.writeText(p).then(() => lib().say(t('File path copied')))
      },
      { enabled: able }
    )
  ]
}

function compareItems(): Item[] {
  const d = dev()
  const display = useDisplay.getState().display
  const hdrShown = ui().fullHdr && canShowHdr(display) && aboveWhite(d.session) && !d.proof
  return [
    cmd('view.before', t('Before'), { checked: d.compare === 'before' }),
    cmd('view.split', t('Before / After Split'), { checked: d.compare === 'split' }),
    cmd('view.clipping', t('Show Clipping'), { checked: d.clipping }),
    // An SDR picture's (the engine measures none on Full HDR's).
    cmd('view.gamut', t('Show Gamut Warning'), {
      checked: d.gamut && !hdrShown,
      enabled: available('view.gamut') && !hdrShown
    }),
    cmd('view.proof', t('Soft Proofing'), { checked: d.proof }),
    cmd('view.proofSplit', t('Screen / Proof Split'), { checked: d.compare === 'proof' }),
    cmd('view.proofSetup', t('Proof Setup…')),
    // Off while proofing: paper has no light above white.
    act('view.fullHdr', t('Full HDR'), () => ui().setFullHdr(!ui().fullHdr), {
      checked: ui().fullHdr && canShowHdr(display) && !d.proof,
      enabled: !modal() && canShowHdr(display) && !d.proof
    })
  ]
}

function zoomItems(): Item[] {
  // The Library's Loupe and Compare (in the Grid, the thumbnails' size).
  if (!inDevelop())
    return [
      cmd('library.zoomIn', t('Zoom In')),
      cmd('library.zoomOut', t('Zoom Out')),
      cmd('library.zoomFit', t('Fit in Window')),
      cmd('loupe.zoom', t('Fit ↔ 1:1'))
    ]
  return [
    cmd('zoom.in', t('Zoom In')),
    cmd('zoom.out', t('Zoom Out')),
    cmd('zoom.fit', t('Fit in Window')),
    cmd('zoom.toggle', dev().zoom.scale === 'fit' ? t('Zoom to 100%') : t('Fit ↔ 100%'))
  ]
}

function maskEditItems(): Item[] {
  return [
    cmd('mask.invert', t('Invert')),
    cmd('mask.duplicate', t('Duplicate')),
    cmd(
      'mask.hide',
      dev().recipe?.layers.find((l) => l.id === dev().layerId)?.enabled === false
        ? t('Show')
        : t('Hide')
    ),
    cmd('mask.delete', t('Delete'))
  ]
}

// ── the menu bar ──

function fileMenu(): Item[] {
  const recent = lib().recent.slice(0, 10)
  return [
    cmd('library.openPhotos', t('Open Photo…')),
    cmd('library.chooseFolder', t('Open Folder…')),
    {
      label: t('Open Recent'),
      submenu: recent.map((f) =>
        act(`file.recent:${f}`, f.split(/[\\/]/).filter(Boolean).pop() ?? f, () => {
          lib().setView('library')
          void lib().openFolder(f)
        })
      )
    },
    sep,
    cmd(
      'export',
      lib().targets().length > 1 && !inDevelop()
        ? tp('Export {{count}} Photo…', 'Export {{count}} Photos…', lib().targets().length)
        : t('Export…')
    ),
    exportPrevious(),
    sep,
    ...revealItems()
  ]
}

function editMenu(): Item[] {
  // The Library's Undo names what it takes back ("Undo Paste settings").
  const undoId = inDevelop() ? 'undo' : 'library.undo'
  const redoId = inDevelop() ? 'redo' : 'library.redo'
  const titles = inDevelop()
    ? { undo: developBatch(false)?.title ?? null, redo: developBatch(true)?.title ?? null }
    : undoTitles()
  return [
    act(
      'edit.undo',
      titles.undo ? t('Undo {{what}}', { what: titles.undo }) : t('Undo'),
      () => {
        if (editing()) document.execCommand('undo')
        else runCommand(undoId)
      },
      { key: undoId, enabled: true }
    ),
    act(
      'edit.redo',
      titles.redo ? t('Redo {{what}}', { what: titles.redo }) : t('Redo'),
      () => {
        if (editing()) document.execCommand('redo')
        else runCommand(redoId)
      },
      { key: redoId, enabled: true }
    ),
    sep,
    { role: 'cut', label: t('Cut') },
    { role: 'copy', label: t('Copy') },
    { role: 'paste', label: t('Paste') },
    act(
      'edit.selectAll',
      t('Select All'),
      () => {
        if (editing() || inDevelop()) document.execCommand('selectAll')
        else runCommand('library.selectAll')
      },
      { key: 'library.selectAll', enabled: true }
    ),
    sep,
    copySettings(),
    pasteSettings(),
    ...pasteMoreItems()
  ]
}

/** Photo → Edit as SDR…: the open gain-map photo's editing space (views/EditingSpace.tsx). */
function editingSpaceItem(): Item {
  const d = dev()
  const able = !modal() && inDevelop() && !!d.session?.info.gain_map && !!d.recipe
  return act('photo.editAsSdr', t('Edit as SDR…'), () => lib().setDialog('editing-space'), {
    checked: able && !!d.recipe && !editsInHdr(d.recipe, true),
    enabled: able
  })
}

/** Today's pipeline has a newer develop than an edit may have been made with (a development kit's). */
function newerDevelop(): boolean {
  const p = usePipeline.getState()
  return p.pixlDemosaic || p.pixlEnhance
}

function photoMenu(): Item[] {
  return [
    cmd('library.develop', t('Open in Develop')),
    editingSpaceItem(),
    sep,
    ratingMenu(),
    flagMenu(),
    labelMenu(),
    cmd('library.autoAdvance', t('Auto Advance'), { checked: ui().autoAdvance }),
    sep,
    makeCopy(),
    proofCopies(),
    stackMenu(),
    collectionMenu(),
    sep,
    cmd('autoTone', t('Auto Tone')),
    cmd('autoWbBatch', t('Auto White Balance')),
    ...(newerDevelop() ? [cmd('rebuild', t('Rebuild with the Latest Develop'))] : []),
    sep,
    cmd('cull.rejectAll', t('Reject Suggested Rejects')),
    cmd('cull.keep', t('Keep (Not a Reject)'))
  ]
}

/** Show Super resolution (it isn't one of the adjustment cards with a key). */
function showEnhance(): void {
  jumpToCard('enhance')
}

function developMenu(): Item[] {
  const tool = dev().tool
  const session = !!dev().session
  return [
    ...panelsFor().map((id) => cmd(`card.${id}`, t(panelTitle(id)))),
    act('develop.enhance', t('Super resolution'), showEnhance, {
      enabled: !modal() && inDevelop() && session
    }),
    sep,
    cmd('tool.prev', t('Previous Panel')),
    cmd('tool.next', t('Next Panel')),
    sep,
    cmd('tool.crop', t('Crop'), { checked: tool === 'crop' }),
    cmd('tool.heal', t('Heal, Clone and Remove'), { checked: tool === 'heal' }),
    cmd('tool.wb', t('White Balance Picker'), { checked: tool === 'wb-picker' }),
    cmd('tool.tat', t('Targeted Adjustment')),
    sep,
    cmd('autoTone', t('Auto Tone'))
  ]
}

function masksMenu(): Item[] {
  const able = !modal() && inDevelop() && !!dev().recipe
  const groups = MASK_TOOL_GROUPS.map((g) => ({
    ...g,
    tools: g.tools.filter((tool) => tool.needs !== 'coming soon')
  })).filter((g) => g.tools.length)
  return [
    cmd('masks.toggle', t('Show Masks'), { checked: masksOpen() }),
    {
      label: t('New Mask'),
      submenu: groups.flatMap((g, i) => [
        ...(i ? [sep] : []),
        ...g.tools.map((tool) =>
          act(`mask.new:${tool.kind}`, t(tool.label), () => startMaskTool(tool.kind), {
            key: tool.command,
            enabled: able
          })
        )
      ])
    },
    sep,
    ...maskEditItems(),
    sep,
    cmd('mask.overlay', t('Show Overlay'), { checked: dev().overlay }),
    cmd('mask.overlayMode', t('Next Overlay Style'))
  ]
}

/** The Library's views and Develop, as radios (the toolbar's segment, and D). */
function viewModes(): Item[] {
  const developing = inDevelop()
  const mode = lib().mode
  const radio = (m: LibraryMode, label: string, key: string, run: () => void): Item =>
    act(`view.${m}`, label, run, {
      key,
      checked: !developing && mode === m,
      radio: true,
      // Compare and Survey start from the Library's photos.
      enabled: !modal() && (!developing || m === 'grid' || m === 'loupe')
    })
  return [
    radio('grid', t('Grid'), 'library.grid', goGrid),
    radio('loupe', t('Loupe'), 'library.loupe', developing ? developToLoupe : goLoupe),
    radio('compare', t('Compare'), 'library.compare', goCompare),
    radio('survey', t('Survey'), 'library.survey', () => void goSurvey()),
    act('view.develop', t('Develop'), () => runCommand('library.develop'), {
      key: 'library.develop',
      checked: developing,
      radio: true,
      enabled: !modal() && (developing || !!shownKey())
    })
  ]
}

/** Compare's and Survey's own items, while they are up. */
function cullItems(): Item[] {
  if (inDevelop()) return []
  const mode = lib().mode
  if (mode === 'compare')
    return [
      cmd('compare.swap', t('Swap Select and Candidate')),
      cmd('compare.promote', t('Make the Candidate the Select')),
      cmd('compare.link', t('Link Zoom'), { checked: useLibZoom.getState().linked }),
      sep
    ]
  if (mode === 'survey') return [cmd('survey.drop', t('Drop from Survey')), sep]
  return []
}

function viewMenu(): Item[] {
  const developing = inDevelop()
  return [
    ...viewModes(),
    sep,
    ...cullItems(),
    ...compareItems(),
    sep,
    ...zoomItems(),
    sep,
    cmd('library.sidebar', t('Show Sources'), { checked: ui().librarySidebar }),
    cmd('library.info', t('Show Info'), { checked: ui().libraryInfo }),
    cmd('library.filterBar', t('Show Filter Bar'), { checked: ui().filterBar }),
    act('view.filmstrip', t('Show Filmstrip'), () => ui().setFilmstrip(!ui().filmstrip), {
      checked: ui().filmstrip,
      enabled: !modal() && developing
    }),
    sep,
    cmd('view.messages', t('Recent Messages…'))
  ]
}

/** The menus, with what each item does (by id). */
function barItems(): { label: string; items: Item[] }[] {
  return [
    { label: t('File'), items: fileMenu() },
    { label: t('Edit'), items: editMenu() },
    { label: t('Photo'), items: photoMenu() },
    { label: t('Develop'), items: developMenu() },
    { label: t('Masks'), items: masksMenu() },
    { label: t('View'), items: viewMenu() }
  ]
}

/** The items as sent: what they do kept here, by id. */
function strip(items: Item[], into: Map<string, () => void>): MenuNode[] {
  return tidyMenu(
    items.map(({ run, submenu, ...node }) => {
      if (run && node.id) into.set(node.id, run)
      return submenu ? { ...node, submenu: strip(submenu, into) } : node
    })
  )
}

/** What the bar's items do (rebuilt with it) and the open right-click menu's. */
let barRuns = new Map<string, () => void>()
let popupRuns = new Map<string, () => void>()

/** The bar as it applies now (exported for tests and the smoke check). */
export function menuBar(): MenuBarSpec {
  const runs = new Map<string, () => void>()
  const menus = barItems().map((m) => ({ label: m.label, items: strip(m.items, runs) }))
  barRuns = runs
  return { menus }
}

// ── right-click menus ──

/** Leave out what doesn't apply (a right-click menu shows only what it can do). */
function onlyEnabled(items: Item[]): Item[] {
  return items
    .filter((i) => i.type === 'separator' || i.role || i.submenu || i.enabled !== false)
    .map((i) => (i.submenu ? { ...i, submenu: onlyEnabled(i.submenu) } : i))
}

function popup(items: Item[]): void {
  const runs = new Map<string, () => void>()
  // Popup ids of their own, so a bar item of the same id can't answer for one.
  const nodes = strip(
    onlyEnabled(items).map(function tag(i): Item {
      return {
        ...i,
        ...(i.id ? { id: `pop:${i.id}` } : {}),
        ...(i.submenu ? { submenu: i.submenu.map(tag) } : {})
      }
    }),
    runs
  )
  popupRuns = runs
  void api.menu.popup(nodes).catch(() => undefined)
}

/**
 * A photo's menu (a thumbnail or the filmstrip): it is selected first unless
 * it is in the selection already, as Lightroom does, so the menu acts on what
 * the user sees selected.
 */
export function photoContextMenu(e: ReactMouseEvent, key: string): void {
  e.preventDefault()
  e.stopPropagation()
  const l = lib()
  const pane = l.view === 'library' && l.mode === 'compare' ? comparePaneOf(l.candidate, key) : null
  // Compare's Candidate: its pane picked and the menu acting on it, the Select left as it is.
  if (pane === 'candidate') useLibrary.setState({ active: 'candidate', selection: [key] })
  else if (!selectionSet(l.selection).has(key)) l.select(key, 'only')
  else if (l.focus !== key) useLibrary.setState({ focus: key })
  // In Compare any other photo clicked is the Select now: the menu acts on it.
  if (pane === 'select' && l.active !== 'select') useLibrary.setState({ active: 'select' })
  const n = lib().targets().length
  const developing = inDevelop()
  const item = lib().items.find((i) => i.key === key)
  const suggested = !!item && !!suggestedReasons(item, useCull.getState().reasons)
  const chosen = new Set(lib().targets())
  const stacked = lib().items.some((i) => chosen.has(i.key) && i.stack)
  // Rated from its menu: the photo clicked in Develop's filmstrip, the selection in the Grid.
  const rated = developing ? [key] : lib().targets()
  popup([
    developing
      ? act('photo.open', t('Open'), () => void dev().open(key), {
          enabled: dev().session?.key !== key
        })
      : cmd('library.develop', t('Open in Develop')),
    sep,
    ratingMenu(rated),
    flagMenu(rated),
    labelMenu(rated),
    ...(suggested ? [cmd('cull.keep', t('Keep (Not a Reject)'))] : []),
    sep,
    ...(!developing || dev().session?.key === key ? [copySettings()] : []),
    pasteSettings(),
    ...pasteMoreItems(),
    cmd(
      'autoWbBatch',
      n > 1
        ? tp('Auto White Balance ({{count}} Photo)', 'Auto White Balance ({{count}} Photos)', n)
        : t('Auto White Balance')
    ),
    ...(newerDevelop()
      ? [
          cmd(
            'rebuild',
            n > 1
              ? tp(
                  'Rebuild {{count}} Photo with the Latest Develop',
                  'Rebuild {{count}} Photos with the Latest Develop',
                  n
                )
              : t('Rebuild with the Latest Develop')
          )
        ]
      : []),
    sep,
    makeCopy(),
    ...(developing ? [] : [proofCopies()]),
    ...(developing
      ? []
      : [
          ...(n > 1 ? [cmd('library.stack', t('Group into Stack'))] : []),
          ...(stacked ? [cmd('library.unstack', t('Unstack'))] : []),
          ...(item?.stack ? [cmd('library.makeCover', t('Make Stack Cover'))] : [])
        ]),
    collectionMenu(),
    ...removeFromCollection(),
    sep,
    cmd(
      'export',
      n > 1 ? tp('Export {{count}} Photo…', 'Export {{count}} Photos…', n) : t('Export…')
    ),
    exportPrevious(),
    ...revealItems()
  ])
}

/** Export with previous, naming the preset it was ("Web 2048"); plain for settings of one's own. */
function exportPrevious(): Item {
  const label = useExports.getState().last?.label
  return cmd(
    'export.previous',
    label ? t('Export with Previous ({{name}})', { name: label }) : t('Export with Previous')
  )
}

/**
 * An export preset's menu in the Export sheet: Rename and Delete for one of
 * the person's own, Duplicate for any. The sheet is a dialog, which greys
 * the app's menus: these are its own, so they stay on.
 */
export function exportPresetMenu(
  e: ReactMouseEvent,
  acts: { rename?: () => void; duplicate: () => void; remove?: () => void }
): void {
  e.preventDefault()
  e.stopPropagation()
  const on = { enabled: true }
  popup([
    ...(acts.rename ? [act('preset.rename', t('Rename…'), acts.rename, on)] : []),
    act('preset.duplicate', t('Duplicate'), acts.duplicate, on),
    ...(acts.remove ? [sep, act('preset.delete', t('Delete'), acts.remove, on)] : [])
  ])
}

function removeFromCollection(): Item[] {
  const src = lib().source
  if (src?.kind !== 'collection') return []
  const c = lib().collections.find((x) => x.id === src.id)
  if (c?.kind !== 'manual') return []
  return [
    act(
      'collection.remove',
      t('Remove from “{{name}}”', { name: c.name }),
      () => void lib().removeFromCollection(c.id, lib().targets())
    )
  ]
}

/** The picture's menu in Develop. */
export function loupeContextMenu(e: ReactMouseEvent): void {
  e.preventDefault()
  const inMask = !!dev().layerId && masksOpen()
  popup([
    ...zoomItems(),
    sep,
    ...compareItems(),
    sep,
    ...(inMask ? [{ label: t('Mask'), submenu: maskEditItems() } as Item, sep] : []),
    ratingMenu(),
    flagMenu(),
    labelMenu(),
    sep,
    copySettings(),
    pasteSettings(),
    ...pasteMoreItems(),
    cmd('autoTone', t('Auto Tone')),
    sep,
    makeCopy(),
    cmd('export', t('Export…')),
    ...revealItems()
  ])
}

/** A mask's menu in the masks pane (the mask is selected first). */
export function maskContextMenu(e: ReactMouseEvent, layerId: string): void {
  e.preventDefault()
  e.stopPropagation()
  if (dev().layerId !== layerId) dev().setLayer(layerId)
  popup(maskEditItems())
}

/**
 * Anywhere else: a text field's Cut, Copy, Paste and Select All, or Copy
 * over selected text (the info panes'). Nothing elsewhere.
 */
function fallbackMenu(e: MouseEvent): void {
  if (e.defaultPrevented) return
  const el = e.target as HTMLElement | null
  const field =
    el?.isContentEditable ||
    el?.tagName === 'TEXTAREA' ||
    (el?.tagName === 'INPUT' && editingType((el as HTMLInputElement).type))
  if (field) {
    e.preventDefault()
    popup([
      { role: 'cut', label: t('Cut') },
      { role: 'copy', label: t('Copy') },
      { role: 'paste', label: t('Paste') },
      sep,
      { role: 'selectAll', label: t('Select All') }
    ])
    return
  }
  if (document.getSelection()?.toString()) {
    e.preventDefault()
    popup([{ role: 'copy', label: t('Copy') }])
  }
}

function editingType(type: string): boolean {
  return !['range', 'checkbox', 'radio', 'button', 'color', 'file'].includes(type)
}

/** What Develop's renders change, many times a second, and no menu item reads. */
const RENDERS: ReadonlySet<keyof ReturnType<typeof useDevelop.getState>> = new Set([
  'picture',
  'pictures',
  'before',
  'mask',
  'maskThumbs',
  'keyMask',
  'stats',
  'hdrStats',
  'report',
  'rendering',
  'headroomPlane',
  'gamutPlane',
  'noise'
] as const)

/**
 * Keep the bar in step with the app, answer the menus' choices, and give
 * the rest of the window its fallback right-click menu. Call once, after the
 * launch.
 */
export function startMenuUpkeep(): () => void {
  let last = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const send = (): void => {
    // A drag changes the recipe on every frame and no item with it: the bar
    // is built once the hand is off the slider.
    if (isInteracting()) {
      timer = setTimeout(send, 200)
      return
    }
    timer = null
    const spec = menuBar()
    const json = JSON.stringify(spec)
    if (json === last) return
    last = json
    void api.menu.set(spec).catch(() => {
      last = ''
    })
  }
  // At most every 200 ms: a drag changes the develop state on every frame.
  const soon = (): void => {
    timer ??= setTimeout(send, 200)
  }
  const offs = [
    useLibrary.subscribe(soon),
    useLibZoom.subscribe((s, p) => s.linked !== p.linked && soon()),
    useLibraryUndo.subscribe(soon),
    useDevelop.subscribe((s, p) => changedBeyond(s, p, RENDERS) && soon()),
    useUi.subscribe(soon),
    useCull.subscribe(soon),
    useDisplay.subscribe(soon),
    useConfirm.subscribe(soon),
    useExports.subscribe(soon),
    useLanguage.subscribe(soon),
    usePipeline.subscribe(soon),
    api.menu.onRun((id) => {
      const run = id.startsWith('pop:') ? popupRuns.get(id) : barRuns.get(id)
      run?.()
    })
  ]
  window.addEventListener('contextmenu', fallbackMenu)
  send()
  return () => {
    offs.forEach((off) => off())
    window.removeEventListener('contextmenu', fallbackMenu)
    if (timer) clearTimeout(timer)
  }
}
