/**
 * Settings → AI models in plain words: what each kind of model is for in
 * Playroom, and what each model does there, written for someone who edits
 * photos and has never heard of the models' own names.
 */
import type { ModelInfo } from '../../../shared/ipc'

export type Purpose = Exclude<ModelInfo['role'], 'raw-denoise'>

/** The group a model is listed under: a RAW's sensor denoiser with the other grain removers. */
export function purposeOf(role: ModelInfo['role']): Purpose {
  return role === 'raw-denoise' ? 'denoise' : role
}

/** The purposes in the order the list shows them. */
export const PURPOSES: { id: Purpose; title: string; what: string }[] = [
  {
    id: 'demosaic',
    title: 'Develop RAW files',
    what: 'Turns a camera’s raw sensor data into the full-size picture, with crisper edges and fewer colour fringes on fine detail. Without it, Playroom uses a faster classic method.'
  },
  {
    id: 'denoise',
    title: 'Remove grain',
    what: 'Cleans the speckled grain out of photos taken in low light or at high ISO.'
  },
  {
    id: 'segment',
    title: 'Select subjects and objects',
    what: 'Lets masks find the main subject for you, or anything you click, box or brush over.'
  },
  {
    id: 'upscale',
    title: 'Make photos bigger',
    what: 'Enlarges a photo with believable detail, for printing big or cropping in close.'
  },
  {
    id: 'deblur',
    title: 'Fix motion blur',
    what: 'Sharpens photos smeared by a shaky hand or a moving subject.'
  },
  {
    id: 'restore',
    title: 'Repair JPEGs',
    what: 'Cleans up the blocky squares and smudged colour of heavily compressed JPEGs.'
  },
  {
    id: 'inpaint',
    title: 'Remove objects',
    what: 'Paints over things you want gone from a photo.'
  },
  {
    id: 'depth',
    title: 'Sense depth',
    what: 'Works out what is near and what is far, so a mask can take the foreground or the background by distance.'
  }
]

export interface ModelCopy {
  name: string
  what: string
  /** Where it is used in Playroom. */
  where: string
  recommended?: boolean
}

export const MODEL_COPY: Record<string, ModelCopy> = {
  'demosaicnet-bayer': {
    name: 'Best quality RAW develop',
    what: 'Builds the full-size picture from your RAW’s sensor data with fine detail and clean edges. Downloaded by itself; used at 100%, for AI tools and in the export. On a Mac it runs on the graphics chip: about 5 seconds for a 24 MP RAW, where the faster classic method takes 3.',
    where: 'Every RAW, at full size',
    recommended: true
  },
  'demosaicnet-xtrans': {
    name: 'Best quality RAW develop, Fujifilm',
    what: 'The same for Fujifilm’s X-Trans sensors. Downloaded by itself the first time you open one.',
    where: 'Fujifilm X-Trans RAWs, at full size'
  },
  pmrid: {
    name: 'RAW sensor denoise',
    what: 'Takes grain out of a RAW’s sensor data before it becomes a picture, measuring how noisy each photo is by itself. Best on high-ISO shots; can look a little crisp on fine texture. Under a second on a Mac.',
    where: 'Detail → Noise reduction → AI → Denoise the RAW data'
  },
  'drunet-color': {
    name: 'Clean and detailed',
    what: 'Playroom measures how grainy your photo is first, then removes just that much, so hair, fabric and skin keep their texture.',
    where: 'Detail → Noise reduction → AI',
    recommended: true
  },
  'nafnet-sidd-w32': {
    name: 'Strong clean-up',
    what: 'For very grainy night and indoor shots. It judges the grain by itself and cleans harder, which can smooth fine texture a little. On a Mac it runs on the graphics chip: about a quarter of a minute for a 24 MP photo.',
    where: 'Detail → Noise reduction → AI'
  },
  'sam2-1-hiera-tiny': {
    name: 'Select anything',
    what: 'Click, drag a box or brush over anything in a photo (a car, a dog, a window, the sky) and the mask takes exactly that, its edges snapped to the photo’s own.',
    where: 'Masks → New → Objects or Sky',
    recommended: true
  },
  u2netp: {
    name: 'Subject finder',
    what: 'Finds the main subject for the Subject and Background masks, small and fast.',
    where: 'Masks → New → Subject or Background',
    recommended: true
  },
  'span-x4-ch48': {
    name: 'Bigger, clean',
    what: 'Makes a clean photo twice or four times as wide and tall, staying closest to the original. Quick: a fraction of a second.',
    where: 'Enhance → Super resolution → Source: Clean',
    recommended: true
  },
  'realesr-general-x4v3': {
    name: 'Bigger, repaired',
    what: 'Makes a photo twice or four times as wide and tall and repairs compression blocks and noise as it goes. Best for small, damaged pictures; edges come out a little smooth.',
    where: 'Enhance → Super resolution → Source: Damaged'
  },
  'realesr-general-wdn-x4v3': {
    name: 'Bigger, keeps texture',
    what: 'Like the repairing one, but leaves more of the photo’s own texture, and a little of its grain.',
    where: 'Enhance → Super resolution → Source: Keep texture'
  },
  'nafnet-gopro-w32': {
    name: 'Motion blur fix',
    what: 'Sharpens a photo smeared by camera shake or a moving subject. It cannot rescue a photo that was simply out of focus.',
    where: 'Enhance → Deblur',
    recommended: true
  },
  'birefnet-lite': {
    name: 'Fine subject finder',
    what: 'Finds the main subject with a finer edge than the quick finder, keeping hair, fur and feathers. Larger, and about ten seconds a photo.',
    where: 'Masks → New → Fine subject'
  },
  'migan-512': {
    name: 'Object remover',
    what: 'Fills in what you paint over (a stranger, a sign, a power line) with what was likely behind it.',
    where: 'Heal → Remove'
  },
  'depth-anything-v2-small': {
    name: 'Depth finder',
    what: 'Sees which parts of a photo are near and which are far, for the Depth range mask.',
    where: 'Masks → New → Depth range'
  },
  'fbcnn-color-blind': {
    name: 'JPEG repair, automatic',
    what: 'Works out by itself how damaged the file is. Good for pictures saved from the web or sent through messaging apps.',
    where: 'Enhance → JPEG restore → AI, judges the damage',
    recommended: true
  }
}

/** A model the copy above does not know yet: its roster title, split at the colon. */
export function copyOf(m: ModelInfo): ModelCopy {
  const known = MODEL_COPY[m.id]
  if (known) return known
  const [name, what] = m.title.split(':')
  return { name: name.trim(), what: (what ?? '').trim(), where: '' }
}

/** "under a second", "about 20 seconds", "about 4 minutes". */
export function duration(ms: number): string {
  if (ms < 1000) return 'under a second'
  const s = ms / 1000
  if (s < 20) return `about ${Math.round(s)} seconds`
  if (s < 90) return `about ${Math.round(s / 5) * 5} seconds`
  const min = s / 60
  if (min < 90) return `about ${Math.round(min)} minutes`
  return `about ${Math.round(min / 60)} hours`
}

/** Quick, a moment or slow: a word for a time per photo. */
export function pace(ms: number): 'quick' | 'moment' | 'slow' {
  return ms < 20_000 ? 'quick' : ms < 180_000 ? 'moment' : 'slow'
}
