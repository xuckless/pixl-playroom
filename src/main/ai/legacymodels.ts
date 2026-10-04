/**
 * Models engine 0.17 retired but this release still honours, because people
 * downloaded them: U²-Net (the subject model before U²-Netp) and FBCNN at a
 * stated quality. They are not in `@xuckless/pixl-models`' roster any more
 * (`ship: false`, under `retired`), so the store would not see a copy on the
 * disk. Their records are vendored here from that roster, so a later engine
 * package that drops `retired` cannot break them.
 *
 * What is kept: an installed one is listed as "being retired" (Remove only),
 * never offered for download, and U²-Net still makes Subject and Background
 * masks (the engine still runs its graph; the request is the roster's own).
 * Both go in the next update: delete this file, its uses (they say
 * `legacy`), and add the one-time clean-up in TODO.md.
 *
 * Pure (no Electron), for tests/legacymodels.test.ts.
 */
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export interface LegacyModel {
  id: string
  title: string
  role: 'segment' | 'restore'
  version: string
  kind: 'segmenter' | 'enhancer'
  /** What replaces it, said in the Models list. */
  replacedBy: string
  files: { name: string; bytes: number; sha256: string }[]
  licence: { spdx: string; holder: string }
  caveat: string
  measured: string
  /** The engine's request for it, with `{ $file }` and `{ $host }` holes (see `fillRef`). */
  ref: Record<string, unknown>
}

const HOST_MODEL = {
  model_path: { $file: '' },
  runtime_library: { $host: 'runtime_library' },
  provider: { $host: 'provider' },
  session: { $host: 'session' }
}

export const LEGACY_MODELS: LegacyModel[] = [
  {
    id: 'u2net',
    title: 'U²-Net: salient subject mask',
    role: 'segment',
    version: '1.0.0',
    kind: 'segmenter',
    replacedBy: 'u2netp',
    files: [
      {
        name: 'u2net.onnx',
        bytes: 175997641,
        sha256: '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491'
      }
    ],
    licence: { spdx: 'Apache-2.0', holder: 'Xuebin Qin (xuebinqin/U-2-Net)' },
    caveat: 'Trained on DUTS-TR, whose page states no licence or terms.',
    measured: 'IoU 0.997 resampled, 0.992 guided; 380 ms per frame, 8 CPU threads',
    ref: {
      model: { ...HOST_MODEL, model_path: { $file: 'u2net.onnx' } },
      model_space: 'Srgb',
      input: {
        name: 'input.1',
        layout: 'Nchw',
        order: 'Rgb',
        element: 'F32',
        mean: { r: 0.485, g: 0.456, b: 0.406 },
        std: { r: 0.229, g: 0.224, b: 0.225 }
      },
      scale: 'ImageMax',
      size: { Fixed: { width: 320, height: 320 } },
      fit: 'Stretch',
      resampler: 'Lanczos3',
      outputs: [
        {
          tensor: '1959',
          layout: 'Nchw',
          activation: 'MinMax',
          planes: [{ index: 0, name: 'subject' }]
        }
      ]
    }
  },
  {
    id: 'fbcnn-color-qf',
    title: 'FBCNN colour: JPEG artifact removal at a stated quality',
    role: 'restore',
    version: '1.0.0',
    kind: 'enhancer',
    replacedBy: 'fbcnn-color-blind',
    files: [
      {
        name: 'fbcnn_color_qf_fp16s.onnx',
        bytes: 143923497,
        sha256: 'e30af666501fd092da6bad597f2a61502a5e76b5af4b28d9467dd024c3badb98'
      }
    ],
    licence: { spdx: 'Apache-2.0', holder: 'Jiaxi Jiang (jiaxi-jiang/FBCNN)' },
    caveat: 'Trained on DIV2K + Flickr2K; DIV2K’s terms say academic research only.',
    measured: 'q20 JPEG told q20: the same as the automatic one',
    // Nothing runs it any more: it is listed so it can be removed.
    ref: {}
  }
]

export const legacyModel = (id: string): LegacyModel | undefined =>
  LEGACY_MODELS.find((m) => m.id === id)

/**
 * The folder of a legacy model on this machine, if every file of it is there
 * at its size: `<models>/<id>/<version>/`, the version the earlier release
 * made (the roster's, 1.0.0), or any other folder under the id that holds the
 * files (a mirror that renamed it). Null when it is not installed.
 */
export async function legacyInstalledDir(
  modelsRoot: string,
  m: Pick<LegacyModel, 'id' | 'version' | 'files'>
): Promise<string | null> {
  const has = async (dir: string): Promise<boolean> => {
    for (const f of m.files) {
      const s = await stat(join(dir, f.name)).catch(() => null)
      if (!s || s.size !== f.bytes) return false
    }
    return true
  }
  const base = join(modelsRoot, m.id)
  const first = join(base, m.version)
  if (await has(first)) return first
  for (const name of await readdir(base).catch(() => [] as string[])) {
    const dir = join(base, name)
    if (dir !== first && (await has(dir))) return dir
  }
  return null
}

/**
 * A roster `ref` with its holes filled: `{ $file }` becomes the file's path
 * under `dir`, `{ $host }` the host's value of that name (one missing is an
 * error, never a default), as `pixlModels.ref` does for a shipped model.
 */
export function fillRef<T>(ref: T, dir: string, host: Record<string, unknown>): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const keys = Object.keys(o)
      if (keys.length === 1 && keys[0] === '$file') return join(dir, String(o.$file))
      if (keys.length === 1 && keys[0] === '$host') {
        const name = String(o.$host)
        if (!(name in host)) throw new Error(`MissingHostValue: ${name}`)
        return host[name]
      }
      return Object.fromEntries(keys.map((k) => [k, walk(o[k])]))
    }
    return v
  }
  return walk(ref) as T
}
