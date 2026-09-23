import { useEffect, useState } from 'react'
import {
  defaultExportSettings,
  depthsFor,
  supportsHdr,
  type ExportFormat,
  type ExportSettings,
  type ResizeMode
} from '../../../shared/export'
import type { ExportPreset, ExportProgress } from '../../../shared/ipc'
import {
  changedGroups,
  defaultRecipe,
  GROUP_LABELS,
  RECIPE_GROUPS,
  type RecipeGroup
} from '../../../shared/recipe'
import { Modal } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useLibrary, useTargets } from '../state/library'

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Num({
  value,
  onChange,
  min,
  max,
  step = 1
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}): React.JSX.Element {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      onKeyDown={(e) => e.stopPropagation()}
    />
  )
}

export function ExportDialog(): React.JSX.Element {
  const targets = useTargets()
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const [s, setS] = useState<ExportSettings>(defaultExportSettings())
  const [presets, setPresets] = useState<ExportPreset[]>([])
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [presetName, setPresetName] = useState('')
  useEffect(() => {
    void api.app
      .getSetting<ExportSettings>('export.last')
      .then((last) => last && setS({ ...defaultExportSettings(), ...last }))
    void api.export.presets().then(setPresets)
    return api.export.onProgress(setProgress)
  }, [])
  const up = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]): void =>
    setS((x) => ({ ...x, [k]: v }))
  const start = async (): Promise<void> => {
    try {
      await api.export.start(targets, s)
    } catch (err) {
      say(errorText(err), 'error')
    }
  }
  const running = progress !== null && !progress.finished
  const depths = depthsFor(s.format)
  return (
    <Modal
      title={`Export ${targets.length} photo${targets.length === 1 ? '' : 's'}`}
      onClose={() => setDialog(null)}
      wide
      footer={
        <>
          {progress && (
            <span className="progress">
              {progress.done}/{progress.total}{' '}
              {progress.current ? `· ${progress.current}` : progress.finished ? '· done' : ''}
              {progress.errors.length > 0 && (
                <span className="error">
                  {' '}
                  · {progress.errors.length} failed: {progress.errors[0].message}
                </span>
              )}
            </span>
          )}
          {running ? (
            <button onClick={() => void api.export.cancel(progress.jobId)}>
              Cancel after this file
            </button>
          ) : (
            <button
              className="primary"
              disabled={targets.length === 0}
              onClick={() => void start()}
            >
              Export
            </button>
          )}
        </>
      }
    >
      <div className="export-grid">
        <fieldset>
          <legend>Presets</legend>
          <select
            value=""
            onChange={(e) => {
              const p = presets.find((x) => x.id === e.target.value)
              if (p) setS({ ...defaultExportSettings(), ...p.settings })
            }}
          >
            <option value="">Load preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="row">
            <input
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button
              disabled={!presetName.trim()}
              onClick={() =>
                void api.export.savePreset({ name: presetName.trim(), settings: s }).then(() => {
                  setPresetName('')
                  void api.export.presets().then(setPresets)
                })
              }
            >
              Save
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Location</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={s.folder === null}
              onChange={(e) => up('folder', e.target.checked ? null : '')}
            />{' '}
            Beside each original
          </label>
          {s.folder !== null && (
            <div className="row">
              <input value={s.folder} readOnly placeholder="Choose a folder" />
              <button
                onClick={() => void api.export.chooseFolder().then((f) => f && up('folder', f))}
              >
                Choose…
              </button>
            </div>
          )}
          <Field label="Subfolder">
            <input
              value={s.subfolder}
              onChange={(e) => up('subfolder', e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </Field>
          <Field label="File name">
            <input
              value={s.template}
              onChange={(e) => up('template', e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              title="{name} {seq} {date} {rating} {copy} {ext}"
            />
          </Field>
          <Field label="If it exists">
            <select
              value={s.collision}
              onChange={(e) => up('collision', e.target.value as ExportSettings['collision'])}
            >
              <option value="suffix">Add a number</option>
              <option value="skip">Skip</option>
              <option value="overwrite">Overwrite</option>
            </select>
          </Field>
        </fieldset>
        <fieldset>
          <legend>File</legend>
          <Field label="Format">
            <select
              value={s.format}
              onChange={(e) => {
                const f = e.target.value as ExportFormat
                setS((x) => ({
                  ...x,
                  format: f,
                  bitDepth: depthsFor(f).includes(x.bitDepth) ? x.bitDepth : depthsFor(f)[0]
                }))
              }}
            >
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
              <option value="tiff">TIFF</option>
              <option value="webp">WebP</option>
              <option value="avif">AVIF</option>
              <option value="jxl">JPEG XL</option>
              <option value="heic">HEIC (needs x265 in the engine build)</option>
            </select>
          </Field>
          {['jpeg', 'webp', 'avif', 'heic'].includes(s.format) && (
            <Field label="Quality">
              <Num value={s.quality} min={1} max={100} onChange={(v) => up('quality', v)} />
            </Field>
          )}
          {s.format === 'jpeg' && (
            <Field label="Chroma">
              <select
                value={s.jpegSubsampling}
                onChange={(e) =>
                  up('jpegSubsampling', e.target.value as ExportSettings['jpegSubsampling'])
                }
              >
                <option value="None">4:4:4</option>
                <option value="Half">4:2:2</option>
                <option value="Quarter">4:2:0</option>
              </select>
            </Field>
          )}
          {s.format === 'jxl' && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.jxlLossless}
                  onChange={(e) => up('jxlLossless', e.target.checked)}
                />{' '}
                Lossless
              </label>
              {!s.jxlLossless && (
                <Field label="Distance">
                  <Num
                    value={s.jxlDistance}
                    min={0}
                    max={25}
                    step={0.1}
                    onChange={(v) => up('jxlDistance', v)}
                  />
                </Field>
              )}
              <Field label="Effort">
                <Num value={s.jxlEffort} min={1} max={9} onChange={(v) => up('jxlEffort', v)} />
              </Field>
            </>
          )}
          {(s.format === 'avif' || s.format === 'heic') && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.lossless}
                  onChange={(e) => up('lossless', e.target.checked)}
                />{' '}
                Lossless
              </label>
              <Field label="Chroma">
                <select
                  value={s.chroma}
                  onChange={(e) => up('chroma', e.target.value as ExportSettings['chroma'])}
                >
                  <option value="Full">4:4:4</option>
                  <option value="Wide">4:2:2</option>
                  <option value="Half">4:2:0</option>
                </select>
              </Field>
              {s.format === 'avif' && (
                <Field label="Speed">
                  <Num value={s.avifSpeed} min={0} max={10} onChange={(v) => up('avifSpeed', v)} />
                </Field>
              )}
            </>
          )}
          {s.format === 'webp' && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.webpLossless}
                  onChange={(e) => up('webpLossless', e.target.checked)}
                />{' '}
                Lossless
              </label>
              <Field label="Method">
                <Num value={s.webpMethod} min={0} max={6} onChange={(v) => up('webpMethod', v)} />
              </Field>
            </>
          )}
          {s.format === 'png' && (
            <Field label="Compression">
              <select
                value={s.pngCompression}
                onChange={(e) =>
                  up('pngCompression', e.target.value as ExportSettings['pngCompression'])
                }
              >
                <option value="Fast">Fast</option>
                <option value="Balanced">Balanced</option>
                <option value="Best">Best</option>
              </select>
            </Field>
          )}
          {s.format === 'tiff' && (
            <Field label="Compression">
              <select
                value={s.tiffCompression}
                onChange={(e) =>
                  up('tiffCompression', e.target.value as ExportSettings['tiffCompression'])
                }
              >
                <option value="None">None</option>
                <option value="Lzw">LZW</option>
                <option value="Deflate">Deflate</option>
              </select>
            </Field>
          )}
          {depths.length > 1 && (
            <Field label="Bit depth">
              <select value={s.bitDepth} onChange={(e) => up('bitDepth', Number(e.target.value))}>
                {depths.map((d) => (
                  <option key={d} value={d}>
                    {d}-bit
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={s.dither}
              onChange={(e) => up('dither', e.target.checked)}
            />{' '}
            Dither 8-bit output
          </label>
        </fieldset>
        <fieldset>
          <legend>Size & colour</legend>
          <Field label="Resize">
            <select
              value={s.resize.mode}
              onChange={(e) => up('resize', { ...s.resize, mode: e.target.value as ResizeMode })}
            >
              <option value="none">Full size</option>
              <option value="long">Long edge</option>
              <option value="short">Short edge</option>
              <option value="width">Width</option>
              <option value="height">Height</option>
              <option value="megapixels">Megapixels</option>
              <option value="percent">Percent</option>
            </select>
          </Field>
          {s.resize.mode !== 'none' && (
            <>
              <Field
                label={
                  s.resize.mode === 'megapixels'
                    ? 'MP'
                    : s.resize.mode === 'percent'
                      ? '%'
                      : 'Pixels'
                }
              >
                <Num
                  value={s.resize.value}
                  min={1}
                  onChange={(v) => up('resize', { ...s.resize, value: v })}
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.resize.enlarge}
                  onChange={(e) => up('resize', { ...s.resize, enlarge: e.target.checked })}
                />{' '}
                Allow enlarging
              </label>
            </>
          )}
          <Field label="Colour space">
            <select
              value={s.colorSpace}
              onChange={(e) => up('colorSpace', e.target.value as ExportSettings['colorSpace'])}
            >
              <option value="Srgb">sRGB</option>
              <option value="DisplayP3">Display P3</option>
              <option value="AdobeRgb">Adobe RGB (1998)</option>
              <option value="Rec2020">Rec.2020</option>
            </select>
          </Field>
          <Field label="Intent">
            <select
              value={s.intent}
              onChange={(e) => up('intent', e.target.value as ExportSettings['intent'])}
            >
              <option value="RelativeColorimetric">Relative colorimetric</option>
              <option value="Perceptual">Perceptual</option>
              <option value="Saturation">Saturation</option>
              <option value="AbsoluteColorimetric">Absolute colorimetric</option>
            </select>
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={s.blackPointCompensation}
              onChange={(e) => up('blackPointCompensation', e.target.checked)}
            />{' '}
            Black point compensation
          </label>
        </fieldset>
        <fieldset>
          <legend>Metadata</legend>
          {(['exif', 'icc', 'xmp', 'iptc'] as const).map((k) => (
            <label key={k} className="check">
              <input
                type="checkbox"
                checked={s.metadata[k]}
                onChange={(e) => up('metadata', { ...s.metadata, [k]: e.target.checked })}
              />{' '}
              {k.toUpperCase()}
            </label>
          ))}
          <p className="muted small">
            Blocks are copied verbatim or not at all; the engine never edits them.
          </p>
        </fieldset>
        <fieldset>
          <legend>HDR</legend>
          <Field label="Mode">
            <select
              value={s.hdr.mode}
              onChange={(e) =>
                up('hdr', { ...s.hdr, mode: e.target.value as ExportSettings['hdr']['mode'] })
              }
            >
              <option value="sdr">SDR (tone map HDR sources)</option>
              <option value="keep" disabled={!supportsHdr(s.format)}>
                Keep HDR sources HDR
              </option>
              <option value="expand" disabled={!supportsHdr(s.format)}>
                Expand SDR to HDR
              </option>
            </select>
          </Field>
          {s.hdr.mode === 'sdr' && (
            <>
              <Field label="Operator">
                <select
                  value={s.hdr.operator}
                  onChange={(e) =>
                    up('hdr', {
                      ...s.hdr,
                      operator: e.target.value as ExportSettings['hdr']['operator']
                    })
                  }
                >
                  <option value="Bt2390">BT.2390</option>
                  <option value="Hable">Hable</option>
                  <option value="Reinhard">Reinhard</option>
                  <option value="Clip">Clip</option>
                </select>
              </Field>
              <Field label="Target white (nits)">
                <Num
                  value={s.hdr.targetPeak}
                  min={50}
                  max={1000}
                  onChange={(v) => up('hdr', { ...s.hdr, targetPeak: v })}
                />
              </Field>
            </>
          )}
          {s.hdr.mode === 'expand' && (
            <>
              <Field label="To">
                <select
                  value={s.hdr.to}
                  onChange={(e) =>
                    up('hdr', { ...s.hdr, to: e.target.value as ExportSettings['hdr']['to'] })
                  }
                >
                  <option value="Rec2100Pq">PQ</option>
                  <option value="Rec2100Hlg">HLG</option>
                </select>
              </Field>
              <Field label="SDR white (nits)">
                <Num
                  value={s.hdr.sdrWhite}
                  min={50}
                  max={1000}
                  onChange={(v) => up('hdr', { ...s.hdr, sdrWhite: v })}
                />
              </Field>
              <Field label="Peak (nits)">
                <Num
                  value={s.hdr.peak}
                  min={100}
                  max={10000}
                  onChange={(v) => up('hdr', { ...s.hdr, peak: v })}
                />
              </Field>
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={s.reveal}
              onChange={(e) => up('reveal', e.target.checked)}
            />{' '}
            Show in folder when done
          </label>
        </fieldset>
      </div>
    </Modal>
  )
}

/** Paste or sync: copy chosen groups of a recipe onto the selection. */
export function SyncDialog(): React.JSX.Element {
  const targets = useTargets()
  const setDialog = useLibrary((s) => s.setDialog)
  const patchItems = useLibrary((s) => s.patchItems)
  const say = useLibrary((s) => s.say)
  const clipboard = useLibrary((s) => s.clipboard)
  const developRecipe = useDevelop((s) => s.recipe)
  const developKey = useDevelop((s) => s.session?.key)
  const source = clipboard?.recipe ?? developRecipe
  const initial = new Set<RecipeGroup>(
    clipboard?.groups ??
      (source
        ? changedGroups(source, defaultRecipe(false)).filter(
            (g) => g !== 'crop' && g !== 'localAdjustments'
          )
        : [])
  )
  const [groups, setGroups] = useState<Set<RecipeGroup>>(initial)
  const keys = targets.filter((k) => k !== developKey || clipboard !== null)
  return (
    <Modal
      title={`Apply settings to ${keys.length} photo${keys.length === 1 ? '' : 's'}`}
      onClose={() => setDialog(null)}
      footer={
        <button
          className="primary"
          disabled={!source || keys.length === 0 || groups.size === 0}
          onClick={async () => {
            if (!source) return
            try {
              patchItems(
                await api.library.applyRecipe(
                  keys,
                  source,
                  [...groups],
                  clipboard?.source ?? developKey ?? undefined
                )
              )
              if (developKey && keys.includes(developKey)) {
                const s = await api.develop.open(developKey)
                useDevelop.setState({ recipe: s.recipe })
              }
              say(`Applied to ${keys.length} photo${keys.length === 1 ? '' : 's'}`)
              setDialog(null)
            } catch (err) {
              say(errorText(err), 'error')
            }
          }}
        >
          Apply
        </button>
      }
    >
      {!source && <p>Copy settings from a photo first (Ctrl+C in Develop).</p>}
      <div className="row wrap">
        <button onClick={() => setGroups(new Set(RECIPE_GROUPS))}>All</button>
        <button onClick={() => setGroups(new Set())}>None</button>
        <button onClick={() => setGroups(new Set(['whiteBalance']))}>White balance only</button>
      </div>
      <div className="group-checks">
        {RECIPE_GROUPS.map((g) => (
          <label key={g} className="check">
            <input
              type="checkbox"
              checked={groups.has(g)}
              onChange={(e) => {
                const n = new Set(groups)
                if (e.target.checked) n.add(g)
                else n.delete(g)
                setGroups(n)
              }}
            />
            {GROUP_LABELS[g]}
          </label>
        ))}
      </div>
    </Modal>
  )
}

export function SavePresetDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const recipe = useDevelop((s) => s.recipe)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('User presets')
  const [groups, setGroups] = useState<Set<RecipeGroup>>(
    new Set(
      recipe
        ? changedGroups(recipe, defaultRecipe(false)).filter(
            (g) => g !== 'crop' && g !== 'localAdjustments' && g !== 'orientation'
          )
        : []
    )
  )
  return (
    <Modal
      title="Save preset"
      onClose={() => setDialog(null)}
      footer={
        <button
          className="primary"
          disabled={!recipe || !name.trim() || groups.size === 0}
          onClick={async () => {
            if (!recipe) return
            try {
              await api.presets.save({
                name: name.trim(),
                group: group.trim() || 'User presets',
                groups: [...groups],
                recipe
              })
              say(`Saved preset ${name.trim()}`)
              setDialog(null)
            } catch (err) {
              say(errorText(err), 'error')
            }
          }}
        >
          Save
        </button>
      }
    >
      <Field label="Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </Field>
      <Field label="Group">
        <input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </Field>
      <p className="muted small">The preset carries only the checked groups:</p>
      <div className="group-checks">
        {RECIPE_GROUPS.map((g) => (
          <label key={g} className="check">
            <input
              type="checkbox"
              checked={groups.has(g)}
              onChange={(e) => {
                const n = new Set(groups)
                if (e.target.checked) n.add(g)
                else n.delete(g)
                setGroups(n)
              }}
            />
            {GROUP_LABELS[g]}
          </label>
        ))}
      </div>
    </Modal>
  )
}

export function EnhanceDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const targets = useTargets()
  const say = useLibrary((s) => s.say)
  const [avail, setAvail] = useState<{ available: boolean; reason?: string } | null>(null)
  const [cpu, setCpu] = useState(false)
  useEffect(() => {
    void api.enhance.available().then(setAvail)
  }, [])
  return (
    <Modal
      title="Enhance → Super Resolution"
      onClose={() => setDialog(null)}
      footer={
        <button
          className="primary"
          disabled={!avail?.available || targets.length === 0}
          onClick={() => {
            for (const k of targets) void api.enhance.run(k, cpu ? 'cpu' : 'auto')
            say(
              `Enhancing ${targets.length} photo${targets.length === 1 ? '' : 's'} in the background`
            )
            setDialog(null)
          }}
        >
          Enhance
        </button>
      }
    >
      <p>
        Doubles the resolution with the bundled Real-ESRGAN ×2 model, before any edit, into a new
        16-bit TIFF beside the original. The new file starts with this photo&apos;s settings.
      </p>
      {avail && !avail.available && <p className="error">{avail.reason}</p>}
      <label className="check">
        <input type="checkbox" checked={cpu} onChange={(e) => setCpu(e.target.checked)} /> Run on
        the CPU (slower, always available)
      </label>
    </Modal>
  )
}
