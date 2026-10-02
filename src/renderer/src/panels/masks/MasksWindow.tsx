import { useEffect, useRef, useState } from 'react'
import type { MaskMode } from '../../../../shared/engine-types'
import { effectiveMode, nextMaskMode } from '../../../../shared/masks'
import { hasControls, hiddenAdjusted } from '../../../../shared/maskcontrols'
import {
  isNeutral,
  neutralSettings,
  type LocalLayer,
  type MaskComponentSetting
} from '../../../../shared/recipe'
import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { Icon, type IconName } from '../../components/icons'
import { Menu, Popover } from '../../components/Popover'
import { useDevelop } from '../../state/develop'
import { OVERLAY_MODES, useUi, type OverlayMode, type PinsMode } from '../../state/ui'
import {
  componentIcon,
  componentLabel,
  deleteComponent,
  deleteMask,
  duplicateComponent,
  duplicateMask,
  MODE_MARK,
  moveComponent,
  moveMask,
  patchComponent,
  patchMask,
  startMaskTool,
  type MaskToolKind
} from './model'
import { closeMasks, minimizeMasks } from '../../develop/tools'
import { ComponentCard, SelectedMask } from './MaskTool'
import { ToolPicker } from './ToolPicker'
import { useReorder } from './useReorder'
import { keyHint, withKey } from '../../lib/commands'
import { touchInteracting } from '../../lib/interacting'

/** The drawing and range tools, one click from the selected mask's add bar. */
const ADD_TOOLS: { kind: MaskToolKind; icon: IconName; label: string }[] = [
  { kind: 'brush', icon: 'brush', label: 'Brush' },
  { kind: 'linear', icon: 'linear', label: 'Linear gradient' },
  { kind: 'radial', icon: 'radial', label: 'Radial gradient' },
  { kind: 'polygon', icon: 'lasso', label: 'Lasso' },
  { kind: 'color', icon: 'colourRange', label: 'Colour range' },
  { kind: 'luminance', icon: 'lumRange', label: 'Luminance range' }
]

const JOIN_VERB: Record<MaskMode, string> = {
  Add: 'Add to',
  Subtract: 'Subtract from',
  Intersect: 'Intersect with'
}

/**
 * Alt+↑ / Alt+↓ on a row's select button moves it, and the button keeps
 * focus (React moves the row's node, which drops focus on the way).
 */
function moveByKey(
  e: React.KeyboardEvent<HTMLElement>,
  index: number,
  count: number,
  move: (to: number) => void
): void {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  e.stopPropagation()
  const to = index + (e.key === 'ArrowUp' ? -1 : 1)
  if (to < 0 || to >= count) return
  const id = e.currentTarget.closest<HTMLElement>('[data-reorder]')?.dataset.id
  move(to)
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`[data-id="${id}"] .mf-select`)?.focus()
  )
}

/** A range that previews while it moves and is written to the history once, when let go. */
function HueSlider({
  value,
  onLive,
  onCommit,
  label
}: {
  value: number
  onLive: (v: number) => void
  onCommit: () => void
  label: string
}): React.JSX.Element {
  const dirty = useRef(false)
  const settle = (): void => {
    if (!dirty.current) return
    dirty.current = false
    onCommit()
  }
  return (
    <input
      type="range"
      className="hue-range"
      aria-label={label}
      min={0}
      max={359}
      value={value}
      onChange={(e) => {
        dirty.current = true
        onLive(Number(e.target.value))
      }}
      onPointerUp={settle}
      onBlur={settle}
      onKeyUp={(e) => {
        if (/^(Arrow|Page|Home|End)/.test(e.key)) settle()
      }}
    />
  )
}

function ComponentRow({
  c,
  index,
  count,
  on,
  offset,
  dragging,
  onGrip
}: {
  c: MaskComponentSetting
  index: number
  count: number
  on: boolean
  offset: number
  dragging: boolean
  onGrip: (e: React.PointerEvent<HTMLElement>) => void
}): React.JSX.Element {
  const setComp = useDevelop((s) => s.setComp)
  const [menu, setMenu] = useState(false)
  const [rename, setRename] = useState<string | null>(null)
  const mode = effectiveMode(index, c.mode)
  const commitRename = (): void => {
    if (rename === null) return
    const name = rename.trim()
    setRename(null)
    if (name === (c.name ?? '')) return
    // An empty name goes back to the kind's own label.
    patchComponent(c.id, name ? 'Rename component' : 'Clear component name', (x) => {
      if (name) x.name = name
      else delete x.name
    })
  }
  return (
    <div
      data-reorder
      data-id={c.id}
      className={`mf-comp-item${dragging ? ' dragging' : ''}`}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
    >
      <div className={`mf-comp${on ? ' on' : ''}${dragging ? ' dragging' : ''}`}>
        {count > 1 && (
          <span className="mf-grip" title="Drag to reorder" onPointerDown={onGrip}>
            <Icon name="grip" />
          </span>
        )}
        <button
          className={`mode-badge m-${mode.toLowerCase()}`}
          disabled={index === 0}
          title={
            index === 0
              ? 'The first component always adds'
              : `${mode} — click for ${nextMaskMode(mode)}`
          }
          onClick={() => {
            const m = nextMaskMode(c.mode)
            patchComponent(c.id, `Mask mode: ${m}`, (x) => (x.mode = m))
          }}
        >
          {MODE_MARK[mode]}
        </button>
        {rename !== null ? (
          <input
            className="mf-rename"
            autoFocus
            aria-label="Component name"
            placeholder={componentLabel({ ...c, name: undefined })}
            value={rename}
            onChange={(e) => setRename(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRename(null)
            }}
          />
        ) : (
          <button
            className="mf-select"
            aria-pressed={on}
            title="Double-click to rename · Alt+↑↓ to move"
            onClick={() => setComp(on ? null : c.id)}
            onDoubleClick={() => setRename(c.name ?? '')}
            onKeyDown={(e) => moveByKey(e, index, count, (to) => moveComponent(c.id, to))}
          >
            <Icon name={componentIcon(c)} />
            <span className="mf-comp-name">{componentLabel(c)}</span>
            {c.invert && <span className="mf-inv-tag">inv</span>}
          </button>
        )}
        <span className="mf-acts">
          <button
            className={`icon sm${c.invert ? ' on' : ''}`}
            title={c.invert ? 'Inverted — click to un-invert' : 'Invert this component'}
            aria-pressed={c.invert}
            onClick={() => patchComponent(c.id, 'Invert component', (x) => (x.invert = !x.invert))}
          >
            <Icon name="invert" />
          </button>
          <span className="mf-menu-anchor">
            <button
              className="icon sm"
              title="Component options"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="more" />
            </button>
            {menu && (
              <Menu
                align="right"
                onClose={() => setMenu(false)}
                items={[
                  ...(index === 0
                    ? []
                    : (['Add', 'Subtract', 'Intersect'] as MaskMode[]).map((m) => ({
                        label: m,
                        checked: c.mode === m,
                        onSelect: () => patchComponent(c.id, `Mask mode: ${m}`, (x) => (x.mode = m))
                      }))),
                  {
                    label: 'Invert',
                    checked: c.invert,
                    onSelect: () =>
                      patchComponent(c.id, 'Invert component', (x) => (x.invert = !x.invert))
                  },
                  { label: 'Rename', onSelect: () => setRename(c.name ?? '') },
                  {
                    label: 'Duplicate',
                    hint: on ? keyHint('mask.duplicate') : undefined,
                    onSelect: () => duplicateComponent(c.id)
                  },
                  'sep',
                  {
                    label: 'Delete component',
                    hint: on ? '⌫' : undefined,
                    danger: true,
                    onSelect: () => deleteComponent(c.id)
                  }
                ]}
              />
            )}
          </span>
        </span>
      </div>
      {on && (hasControls(c) || hiddenAdjusted(c)) && <ComponentCard c={c} index={index} />}
    </div>
  )
}

/** Add / Subtract / Intersect, then the tool: straight from the selected mask. */
function AddBar({ onMore }: { onMore: (mode: MaskMode) => void }): React.JSX.Element {
  const [join, setJoin] = useState<MaskMode>('Add')
  const add = (kind: MaskToolKind): void => {
    useDevelop.getState().setAddMode(join)
    startMaskTool(kind)
  }
  return (
    <div className="mf-add">
      <div className="seg" role="group" aria-label="How a new component joins this mask">
        {(['Add', 'Subtract', 'Intersect'] as MaskMode[]).map((m) => (
          <button
            key={m}
            className={join === m ? 'on' : ''}
            aria-pressed={join === m}
            aria-label={m}
            title={`${JOIN_VERB[m]} this mask`}
            onClick={() => setJoin(m)}
          >
            <span className={`mf-join m-${m.toLowerCase()}`}>{MODE_MARK[m]}</span>
          </button>
        ))}
      </div>
      <div className="mf-add-tools" role="group" aria-label={`${JOIN_VERB[join]} this mask with`}>
        {ADD_TOOLS.map((t) => (
          <button
            key={t.kind}
            className="icon sm"
            title={`${JOIN_VERB[join]} this mask: ${t.label}`}
            onClick={() => add(t.kind)}
          >
            <Icon name={t.icon} />
          </button>
        ))}
        <button
          className="icon sm"
          title={`${JOIN_VERB[join]} this mask: every tool`}
          onClick={() => onMore(join)}
        >
          <Icon name="more" />
        </button>
      </div>
    </div>
  )
}

function MaskRow({
  layer,
  index,
  count,
  selected,
  offset,
  dragging,
  onGrip,
  onPick
}: {
  layer: LocalLayer
  index: number
  count: number
  selected: boolean
  offset: number
  dragging: boolean
  onGrip: (e: React.PointerEvent<HTMLElement>) => void
  onPick: (mode: MaskMode) => void
}): React.JSX.Element {
  const setLayer = useDevelop((s) => s.setLayer)
  const setHover = useDevelop((s) => s.setHoverLayer)
  const compId = useDevelop((s) => s.compId)
  const thumb = useDevelop((s) => s.maskThumbs[layer.id]?.url ?? null)
  const hue = useUi((s) => layer.overlayHue ?? s.maskOverlay.hue)
  const measured = useDevelop((s) => s.report?.layers?.[layer.id])
  const coverage = !measured
    ? undefined
    : !measured.applied
      ? 'Not applied'
      : measured.coverage === null
        ? undefined
        : `Covers ${(measured.coverage * 100).toFixed(1)}% of the photo`
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [colour, setColour] = useState(false)
  const comps = useReorder((from, to) => moveComponent(layer.components[from].id, to))
  const rename = (): void => {
    const name = renaming?.trim()
    setRenaming(null)
    if (name && name !== layer.name) patchMask(layer.id, 'Rename mask', (l) => (l.name = name))
  }
  const toggleHidden = (): void =>
    patchMask(layer.id, layer.enabled ? 'Hide mask' : 'Show mask', (l) => {
      l.enabled = !l.enabled
    })
  const invert = (): void =>
    patchMask(layer.id, 'Invert mask', (l) => {
      l.invert = !l.invert
    })
  return (
    <div
      data-reorder
      data-id={layer.id}
      className={`mf-mask${selected ? ' on' : ''}${layer.enabled ? '' : ' off'}${dragging ? ' dragging' : ''}`}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
    >
      <div
        className="mf-row"
        onPointerEnter={() => setHover(layer.id)}
        onPointerLeave={() => setHover(null)}
      >
        {count > 1 && (
          <span className="mf-grip" title="Drag to reorder" onPointerDown={onGrip}>
            <Icon name="grip" />
          </span>
        )}
        {renaming !== null ? (
          <>
            <span className="mf-thumb">{thumb ? <img src={thumb} alt="" /> : <i />}</span>
            <input
              className="mf-rename"
              autoFocus
              aria-label="Mask name"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') rename()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          </>
        ) : (
          <button
            className="mf-select"
            aria-pressed={selected}
            title="Double-click to rename · Alt+↑↓ to move"
            onClick={() => setLayer(selected ? null : layer.id)}
            onDoubleClick={() => setRenaming(layer.name)}
            onFocus={() => setHover(layer.id)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => moveByKey(e, index, count, (to) => moveMask(layer.id, to))}
          >
            <span className="mf-thumb" title={coverage}>
              {thumb ? <img src={thumb} alt="" draggable={false} /> : <i />}
              {layer.invert && <span className="mf-inv" title="Inverted" />}
            </span>
            <span className="mf-name">{layer.name}</span>
          </button>
        )}
        <span className="mf-acts">
          <span className="mf-menu-anchor">
            <button
              className="mf-swatch-btn"
              title="This mask's overlay colour"
              aria-label="Overlay colour"
              aria-expanded={colour}
              onClick={() => setColour(!colour)}
            >
              <span className="mf-swatch" style={{ background: `hsl(${hue} 90% 58%)` }} />
            </button>
            {colour && (
              <Popover
                onClose={() => setColour(false)}
                align="right"
                side="top"
                className="overlay-pop"
              >
                <span className="micro">Overlay colour</span>
                <HueSlider
                  label="Overlay colour"
                  value={hue}
                  onLive={(v) =>
                    useDevelop.getState().edit((r) => {
                      const l = r.layers.find((x) => x.id === layer.id)
                      if (l) l.overlayHue = v
                    }, true)
                  }
                  onCommit={() => useDevelop.getState().commit(`${layer.name}: overlay colour`)}
                />
                {layer.overlayHue !== undefined && (
                  <button
                    className="sm ghost"
                    onClick={() =>
                      patchMask(layer.id, `${layer.name}: overlay colour reset`, (l) => {
                        delete l.overlayHue
                      })
                    }
                  >
                    Use the overlay&apos;s colour
                  </button>
                )}
              </Popover>
            )}
          </span>
          <button
            className={`icon sm mf-act${layer.invert ? ' on' : ''}`}
            title={layer.invert ? 'Inverted — click to un-invert' : 'Invert this mask'}
            aria-pressed={layer.invert}
            onClick={invert}
          >
            <Icon name="invert" />
          </button>
          <button
            className="icon sm mf-act mf-eye"
            title={withKey(layer.enabled ? 'Hide this mask' : 'Show this mask', 'mask.hide')}
            aria-pressed={!layer.enabled}
            onClick={toggleHidden}
          >
            <Icon name={layer.enabled ? 'eye' : 'eyeOff'} />
          </button>
          <span className="mf-menu-anchor mf-act">
            <button
              className="icon sm"
              title="Mask options"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="more" />
            </button>
            {menu && (
              <Menu
                align="right"
                onClose={() => setMenu(false)}
                items={[
                  { label: 'Rename', onSelect: () => setRenaming(layer.name) },
                  {
                    label: 'Duplicate',
                    hint: selected && !compId ? keyHint('mask.duplicate') : undefined,
                    onSelect: () => duplicateMask(layer.id)
                  },
                  { label: 'Invert', checked: layer.invert, onSelect: invert },
                  {
                    label: 'Reset adjustments',
                    disabled: isNeutral(layer.settings),
                    onSelect: () =>
                      patchMask(layer.id, `${layer.name}: reset`, (l) => {
                        l.settings = neutralSettings()
                      })
                  },
                  {
                    label: layer.enabled ? 'Hide' : 'Show',
                    hint: selected ? 'H' : undefined,
                    onSelect: toggleHidden
                  },
                  ...(count > 1
                    ? [
                        'sep' as const,
                        {
                          label: 'Move up',
                          hint: 'Alt+↑',
                          disabled: index === 0,
                          onSelect: () => moveMask(layer.id, index - 1)
                        },
                        {
                          label: 'Move down',
                          hint: 'Alt+↓',
                          disabled: index === count - 1,
                          onSelect: () => moveMask(layer.id, index + 1)
                        }
                      ]
                    : []),
                  'sep',
                  {
                    label: 'Delete mask',
                    hint: selected && !compId ? '⌫' : undefined,
                    danger: true,
                    onSelect: () => deleteMask(layer.id)
                  }
                ]}
              />
            )}
          </span>
        </span>
      </div>
      {selected && (
        <div className={`mf-comps${comps.drag ? ' sorting' : ''}`}>
          {layer.components.length === 0 && (
            <p className="mf-hint">Pick a tool below to shape this mask.</p>
          )}
          {layer.components.map((c, i) => (
            <ComponentRow
              key={c.id}
              c={c}
              index={i}
              count={layer.components.length}
              on={compId === c.id}
              offset={comps.offset(i)}
              dragging={comps.drag?.from === i}
              onGrip={(e) => comps.start(e, i)}
            />
          ))}
          <AddBar onMore={onPick} />
        </div>
      )}
    </div>
  )
}

function OverlayControls(): React.JSX.Element {
  const overlay = useDevelop((s) => s.overlay)
  const setOverlay = useDevelop((s) => s.setOverlay)
  const o = useUi((s) => s.maskOverlay)
  const set = useUi((s) => s.setMaskOverlay)
  const [open, setOpen] = useState(false)
  return (
    <div className="mf-foot">
      <label className="check" title={withKey('Show the overlay', 'mask.overlay')}>
        <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
        Overlay
      </label>
      <span
        className="mf-swatch"
        style={{ background: `hsl(${o.hue} 90% 58%)` }}
        title="Overlay colour"
      />
      <span className="spacer" />
      <span className="mf-menu-anchor">
        <button className="icon sm" title="Overlay options" onClick={() => setOpen(!open)}>
          <Icon name="settings" />
        </button>
        {open && (
          <Popover onClose={() => setOpen(false)} align="right" side="top" className="overlay-pop">
            <span className="micro">
              Overlay{keyHint('mask.overlayMode') && ` · ${keyHint('mask.overlayMode')} cycles`}
            </span>
            <select
              value={o.mode}
              onChange={(e) => set({ mode: e.target.value as OverlayMode })}
              aria-label="Overlay mode"
            >
              {OVERLAY_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <label className="op-row">
              <span>Colour</span>
              <input
                type="range"
                className="hue-range"
                min={0}
                max={360}
                value={o.hue}
                onChange={(e) => set({ hue: Number(e.target.value) })}
              />
            </label>
            <label className="op-row">
              <span>Opacity</span>
              <input
                type="range"
                min={10}
                max={100}
                value={o.opacity}
                onChange={(e) => set({ opacity: Number(e.target.value) })}
              />
              <span className="t-num">{o.opacity}%</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={o.showAll}
                onChange={(e) => {
                  set({ showAll: e.target.checked })
                  useDevelop.getState().pushView()
                }}
              />
              Show all masks
            </label>
            <label
              className="check"
              title="Each component of the selected mask in a colour of its own (a subtracting one hatched)"
            >
              <input
                type="checkbox"
                checked={!!o.byComponent}
                disabled={o.mode !== 'color' && o.mode !== 'color-bw'}
                onChange={(e) => set({ byComponent: e.target.checked })}
              />
              Colour each component
            </label>
            <label
              className="check"
              title="The overlay steps aside while a slider that changes the photo moves (Lightroom's auto toggle)"
            >
              <input
                type="checkbox"
                checked={o.autoToggle}
                onChange={(e) => set({ autoToggle: e.target.checked })}
              />
              Hide while adjusting
            </label>
            <span className="micro">
              Pins{keyHint('mask.pins') && ` · ${keyHint('mask.pins')} cycles`}
            </span>
            <div className="seg" role="group" aria-label={withKey('Pins', 'mask.pins')}>
              {(['auto', 'always', 'never'] as PinsMode[]).map((p) => (
                <button
                  key={p}
                  className={o.pins === p ? 'on' : ''}
                  onClick={() => set({ pins: p })}
                >
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </Popover>
        )}
      </span>
    </div>
  )
}

/** The window's width, floating or docked (px). */
const WIDTH = 300
/** How close to the stage's left edge a drag docks the window (px). */
const DOCK_SNAP = 32
/** How far a docked window's header is pulled before it floats (px). */
const UNDOCK_PULL = 36
const MARGIN = 8

/** A folded or headed window keeps this much of itself on the stage (px). */
const KEEP_H = 56

/** The stage beside a window, whether that window floats on it or is docked next to it. */
const stageOf = (el: HTMLElement): HTMLElement | null =>
  el.closest('.develop-body')?.querySelector<HTMLElement>('.stage') ?? null

/** Keep a dragged window's top-left inside a stage of `w`×`h`. */
function clampTo(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(MARGIN, w - WIDTH - MARGIN), Math.max(MARGIN, x)),
    y: Math.min(Math.max(MARGIN, h - KEEP_H), Math.max(MARGIN, y))
  }
}

/**
 * Where a floating window sits, kept on the stage by the stage itself (CSS
 * against its containing block), so a stage that grows or shrinks never
 * needs measuring. x < 0 is the default: the top right.
 */
function placeOnStage(x: number, y: number, width: number): React.CSSProperties {
  const top = `max(${MARGIN}px, min(${y}px, calc(100% - ${KEEP_H}px)))`
  if (x < 0) return { right: 14, top }
  return { left: `max(${MARGIN}px, min(${x}px, calc(100% - ${width + MARGIN}px)))`, top }
}

/**
 * Drag the window by its header (or its pill): float it anywhere on the
 * stage, drop it at the stage's left edge to dock it, pull a docked one out to
 * float it again. Listens on the window, so the drag survives the window
 * moving between the dock and the stage. A press that never moves is `onTap`.
 */
function startDrag(e: React.PointerEvent, onTap?: () => void): void {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('button:not(.mf-pill), input, select, .mf-menu-anchor'))
    return
  const win = (e.currentTarget as HTMLElement).closest('.masks-win, .mf-pill') as HTMLElement
  if (!win) return
  const stage = stageOf(win)
  if (!stage) return
  e.preventDefault()
  const r = win.getBoundingClientRect()
  let grab = { dx: e.clientX - r.left, dy: e.clientY - r.top }
  const from = { x: e.clientX, y: e.clientY }
  let moved = false
  let near = false
  // Where it is going: moved by a transform while dragged, kept (and
  // saved) once, on release, not stored at every pointer move.
  let to: { x: number; y: number } | null = null
  const shown = (): HTMLElement | null => stage.querySelector('.masks-win, .mf-pill')
  const move = (ev: PointerEvent): void => {
    if (!moved && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 4) return
    moved = true
    touchInteracting()
    const ui = useUi.getState()
    // A docked window's pill floats once it is dragged.
    if (ui.masksWin.docked && ui.masksWin.minimized) ui.setMasksWin({ docked: false })
    else if (ui.masksWin.docked) {
      if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < UNDOCK_PULL) return
      // Out of the dock: it floats under the pointer from here.
      grab = { dx: Math.min(grab.dx, 120), dy: Math.min(grab.dy, 20) }
      ui.setMasksWin({ docked: false })
      return
    }
    const b = stage.getBoundingClientRect()
    near = ev.clientX - b.left < DOCK_SNAP
    stage.classList.toggle('dock-hint', near)
    to = clampTo(ev.clientX - grab.dx - b.left, ev.clientY - grab.dy - b.top, b.width, b.height)
    const el = shown()
    if (el) el.style.transform = `translate(${to.x - ui.masksWin.x}px, ${to.y - ui.masksWin.y}px)`
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
    stage.classList.remove('dock-hint')
    const el = shown()
    if (el) el.style.transform = ''
    if (!moved) return onTap?.()
    if (near) useUi.getState().setMasksWin({ docked: true, minimized: false })
    else if (to) useUi.getState().setMasksWin(to)
  }
  // In the capture phase: the loupe's own tools (pins, the gradient and lasso
  // editors) stop the pointer's events over the photo, and the drag must
  // still hear every one of them, wherever the pointer goes.
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
}

/**
 * The masks window, as in Lightroom's masks panel but free of the wheel: each
 * mask with its thumbnail, its components with how they combine, Create new
 * mask, and Add / Subtract / Intersect for the selected one; under the list,
 * the selected mask's own settings; the overlay's settings at the foot. Rows
 * reorder by their grip (or Alt+↑↓), show their actions under the pointer,
 * and preview their mask on the photo while hovered.
 *
 * It floats over the photo (drag it by its header), docks as a column beside
 * the left rail (drop it at the photo's left edge), folds to a pill naming
 * the selected mask, and stays up whichever tool the right column shows.
 * `place` is where this instance lives: the dock column, or the stage.
 */
export function MasksWindow({ place }: { place: 'dock' | 'stage' }): React.JSX.Element | null {
  const layers = useDevelop((s) => s.recipe?.layers ?? null)
  const layerId = useDevelop((s) => s.layerId)
  const setAddMode = useDevelop((s) => s.setAddMode)
  const addMode = useDevelop((s) => s.addMode)
  const win = useUi((s) => s.masksWin)
  const [picker, setPicker] = useState(false)
  const masks = useReorder((from, to) => {
    const l = useDevelop.getState().recipe?.layers[from]
    if (l) moveMask(l.id, to)
  })
  const up = win.open && layers !== null
  const docked = win.docked && !win.minimized
  const here = place === 'dock' ? docked : !docked
  // A hover preview never outlives the window.
  useEffect(() => {
    if (!up || win.minimized) useDevelop.getState().setHoverLayer(null)
  }, [up, win.minimized])
  if (!up || !here) return null
  const style =
    place === 'stage'
      ? win.docked
        ? { left: MARGIN, top: MARGIN }
        : placeOnStage(win.x, win.y, win.minimized ? 180 : WIDTH)
      : undefined

  if (win.minimized) {
    const sel = layers.find((l) => l.id === layerId)
    return (
      <LiquidGlass
        as="button"
        className="mf-pill"
        radius={2}
        bezel={10}
        strength={0.8}
        frost={6}
        style={style}
        title="Show the masks window (drag to move)"
        onPointerDown={(e: React.PointerEvent) => startDrag(e, () => minimizeMasks(false))}
        // The keyboard's Enter or Space (a pointer's press is the drag's tap).
        onClick={(e: React.MouseEvent) => e.detail === 0 && minimizeMasks(false)}
      >
        <Icon name="overlay" />
        <span className="mf-pill-name">{sel ? sel.name : 'Masks'}</span>
        {layers.length > 0 && <span className="mf-pill-count">{layers.length}</span>}
      </LiquidGlass>
    )
  }

  const openPicker = (mode: MaskMode | null): void => {
    setAddMode(mode)
    setPicker(true)
  }
  return (
    <LiquidGlass
      className={`masks-win ${place === 'dock' ? 'docked' : 'floating'}`}
      radius={2}
      bezel={12}
      strength={0.8}
      frost={6}
      style={style}
    >
      <div className="mf-head" onPointerDown={(e) => startDrag(e)}>
        <span className="micro">Masks</span>
        <span className="mf-head-tools">
          <span className="mf-menu-anchor">
            <button className="primary sm" onClick={() => openPicker(null)} title="Create new mask">
              <Icon name="plus" />
              New
            </button>
            {picker && (
              <Popover
                align="right"
                className="picker-pop"
                onClose={() => {
                  setPicker(false)
                  // A pick consumes the mode; closing without one drops it.
                  if (addMode) setAddMode(null)
                }}
              >
                <ToolPicker onDone={() => setPicker(false)} />
              </Popover>
            )}
          </span>
          <button
            className="icon sm ghost"
            title={win.docked ? 'Float over the photo' : 'Dock beside the left rail'}
            aria-label={win.docked ? 'Float the masks window' : 'Dock the masks window'}
            onClick={() => useUi.getState().setMasksWin({ docked: !win.docked })}
          >
            <Icon name="sidebar" />
          </button>
          <button
            className="icon sm ghost"
            title="Fold to a pill"
            aria-label="Minimise the masks window"
            onClick={() => minimizeMasks(true)}
          >
            <Icon name="minus" />
          </button>
          <button
            className="icon sm ghost"
            title={withKey('Close', 'masks.toggle')}
            aria-label="Close the masks window"
            onClick={closeMasks}
          >
            <Icon name="close" />
          </button>
        </span>
      </div>
      <div className="mf-body">
        <div className={`mf-list${masks.drag ? ' sorting' : ''}`}>
          {layers.length === 0 && (
            <p className="mf-hint">No masks yet. New limits edits to part of the photo.</p>
          )}
          {layers.map((l, i) => (
            <MaskRow
              key={l.id}
              layer={l}
              index={i}
              count={layers.length}
              selected={l.id === layerId}
              offset={masks.offset(i)}
              dragging={masks.drag?.from === i}
              onGrip={(e) => masks.start(e, i)}
              onPick={openPicker}
            />
          ))}
        </div>
        <SelectedMask />
      </div>
      <OverlayControls />
    </LiquidGlass>
  )
}
