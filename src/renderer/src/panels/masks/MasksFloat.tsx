import { useState } from 'react'
import type { MaskMode } from '../../../../shared/engine-types'
import type { LocalLayer } from '../../../../shared/recipe'
import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { Icon } from '../../components/icons'
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
  patchComponent,
  patchMask
} from './model'
import { ToolPicker } from './ToolPicker'

function MaskRow({
  layer,
  selected,
  onPick
}: {
  layer: LocalLayer
  selected: boolean
  onPick: (mode: MaskMode) => void
}): React.JSX.Element {
  const setLayer = useDevelop((s) => s.setLayer)
  const compId = useDevelop((s) => s.compId)
  const setComp = useDevelop((s) => s.setComp)
  const thumb = useDevelop((s) => s.maskThumbs[layer.id]?.url ?? null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [compMenu, setCompMenu] = useState<string | null>(null)
  const rename = (): void => {
    const name = renaming?.trim()
    setRenaming(null)
    if (name && name !== layer.name) patchMask(layer.id, 'Rename mask', (l) => (l.name = name))
  }
  return (
    <div className={`mf-mask${selected ? ' on' : ''}${layer.enabled ? '' : ' off'}`}>
      <div
        className="mf-row"
        role="button"
        tabIndex={0}
        onClick={() => setLayer(selected ? null : layer.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setLayer(selected ? null : layer.id)
        }}
      >
        <span className="mf-thumb">
          {thumb ? <img src={thumb} alt="" draggable={false} /> : <i />}
          {layer.invert && <span className="mf-inv" title="Inverted" />}
        </span>
        {renaming !== null ? (
          <input
            className="mf-rename"
            autoFocus
            value={renaming}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') rename()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <span
            className="mf-name"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setRenaming(layer.name)
            }}
          >
            {layer.name}
          </span>
        )}
        <button
          className="icon sm"
          title={layer.enabled ? 'Hide this mask' : 'Show this mask'}
          aria-pressed={layer.enabled}
          onClick={(e) => {
            e.stopPropagation()
            patchMask(layer.id, layer.enabled ? 'Hide mask' : 'Show mask', (l) => {
              l.enabled = !l.enabled
            })
          }}
        >
          <Icon name={layer.enabled ? 'eye' : 'eyeOff'} />
        </button>
        <span className="mf-menu-anchor" onClick={(e) => e.stopPropagation()}>
          <button className="icon sm" title="Mask options" onClick={() => setMenu(!menu)}>
            <Icon name="more" />
          </button>
          {menu && (
            <Menu
              align="right"
              onClose={() => setMenu(false)}
              items={[
                { label: 'Rename', onSelect: () => setRenaming(layer.name) },
                { label: 'Duplicate', onSelect: () => duplicateMask(layer.id) },
                {
                  label: 'Invert',
                  checked: layer.invert,
                  onSelect: () =>
                    patchMask(layer.id, 'Invert mask', (l) => {
                      l.invert = !l.invert
                    })
                },
                {
                  label: layer.enabled ? 'Hide' : 'Show',
                  onSelect: () =>
                    patchMask(layer.id, layer.enabled ? 'Hide mask' : 'Show mask', (l) => {
                      l.enabled = !l.enabled
                    })
                },
                'sep',
                { label: 'Delete mask', danger: true, onSelect: () => deleteMask(layer.id) }
              ]}
            />
          )}
        </span>
      </div>
      {selected && (
        <div className="mf-comps">
          {layer.components.length === 0 && (
            <p className="mf-hint">Paint, draw or pick a range to shape this mask.</p>
          )}
          {layer.components.map((c, i) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`mf-comp${compId === c.id ? ' on' : ''}`}
              onClick={() => setComp(compId === c.id ? null : c.id)}
              onKeyDown={(e) => e.key === 'Enter' && setComp(c.id)}
            >
              <span className={`mode-badge m-${(i === 0 ? 'Add' : c.mode).toLowerCase()}`}>
                {MODE_MARK[i === 0 ? 'Add' : c.mode]}
              </span>
              <Icon name={componentIcon(c)} />
              <span className="mf-comp-name">{componentLabel(c)}</span>
              {c.invert && <span className="mf-inv-tag">inv</span>}
              <span className="mf-menu-anchor" onClick={(e) => e.stopPropagation()}>
                <button
                  className="icon sm"
                  title="Component options"
                  onClick={() => setCompMenu(compMenu === c.id ? null : c.id)}
                >
                  <Icon name="more" />
                </button>
                {compMenu === c.id && (
                  <Menu
                    align="right"
                    onClose={() => setCompMenu(null)}
                    items={[
                      ...(i === 0
                        ? []
                        : (['Add', 'Subtract', 'Intersect'] as MaskMode[]).map((m) => ({
                            label: m,
                            checked: c.mode === m,
                            onSelect: () =>
                              patchComponent(c.id, `Mask mode: ${m}`, (x) => (x.mode = m))
                          }))),
                      {
                        label: 'Invert',
                        checked: c.invert,
                        onSelect: () =>
                          patchComponent(c.id, 'Invert component', (x) => (x.invert = !x.invert))
                      },
                      { label: 'Duplicate', onSelect: () => duplicateComponent(c.id) },
                      'sep',
                      { label: 'Delete', danger: true, onSelect: () => deleteComponent(c.id) }
                    ]}
                  />
                )}
              </span>
            </div>
          ))}
          <div className="mf-add">
            <button className="sm" onClick={() => onPick('Add')} title="Add to this mask">
              <Icon name="plus" />
              Add
            </button>
            <button
              className="sm"
              onClick={(e) => onPick(e.altKey ? 'Intersect' : 'Subtract')}
              title="Subtract from this mask (Alt-click: intersect)"
            >
              <Icon name="minus" />
              Subtract
            </button>
            <button
              className="sm icon"
              onClick={() => onPick('Intersect')}
              title="Intersect with this mask"
            >
              ∩
            </button>
          </div>
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
      <label className="check" title="Show the overlay (O)">
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
          <Popover onClose={() => setOpen(false)} align="right" className="overlay-pop">
            <span className="micro">Overlay</span>
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
                onKeyDown={(e) => e.stopPropagation()}
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
                onKeyDown={(e) => e.stopPropagation()}
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
            <span className="micro">Pins</span>
            <div className="seg" role="group" aria-label="Pins (H)">
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

/**
 * The masks panel floating at the loupe's edge while Masks is the tool, as
 * in Lightroom: each mask with its thumbnail, its components with how they
 * combine, Create new mask, and Add / Subtract / Intersect for the selected
 * one; the overlay's settings at the foot.
 */
export function MasksFloat(): React.JSX.Element | null {
  const layers = useDevelop((s) => s.recipe?.layers ?? null)
  const layerId = useDevelop((s) => s.layerId)
  const setAddMode = useDevelop((s) => s.setAddMode)
  const addMode = useDevelop((s) => s.addMode)
  const panel = useUi((s) => s.panel)
  const [picker, setPicker] = useState(false)
  if (panel !== 'masks' || !layers) return null
  const openPicker = (mode: MaskMode | null): void => {
    setAddMode(mode)
    setPicker(true)
  }
  return (
    <LiquidGlass className="masks-float" radius={2} bezel={12} strength={0.8} frost={6}>
      <div className="mf-head">
        <span className="micro">Masks</span>
        <span className="mf-menu-anchor">
          <button className="primary sm" onClick={() => openPicker(null)} title="Create new mask">
            <Icon name="plus" />
            New mask
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
      </div>
      <div className="mf-list">
        {layers.length === 0 && (
          <p className="mf-hint">
            No masks yet. A mask limits adjustments to part of the photo: a brush, a gradient, a
            lasso or a colour range.
          </p>
        )}
        {layers.map((l) => (
          <MaskRow key={l.id} layer={l} selected={l.id === layerId} onPick={openPicker} />
        ))}
      </div>
      <OverlayControls />
    </LiquidGlass>
  )
}
