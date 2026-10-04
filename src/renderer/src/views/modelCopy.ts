/**
 * Settings → AI models in plain words: what each kind of model is for in
 * Playroom, and what each model does there, written for someone who edits
 * photos and has never heard of the models' own names.
 */
import type { ModelInfo } from '../../../shared/ipc'

export type Purpose = ModelInfo['role']

/** The purposes in the order the list shows them. */
export const PURPOSES: { id: Purpose; title: string; what: string }[] = [
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
  'drunet-color': {
    name: 'Clean and detailed',
    what: 'Playroom measures how grainy your photo is first, then removes just that much, so hair, fabric and skin keep their texture.',
    where: 'Detail → Noise reduction → AI',
    recommended: true
  },
  'scunet-color-real': {
    name: 'Strong clean-up',
    what: 'For very grainy night and indoor shots. It judges the grain by itself and cleans harder, which can smooth fine texture a little.',
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
  'real-esrgan-x2plus': {
    name: 'Twice the size',
    what: 'Makes a photo twice as wide and tall. The most natural-looking result, and the slowest.',
    where: 'Enhance → Super resolution → ×2',
    recommended: true
  },
  'realesr-general-x4v3': {
    name: 'Four times, quick',
    what: 'Makes a photo four times as wide and tall, quickly. Best for small pictures; edges come out a little smooth.',
    where: 'Enhance → Super resolution → ×4 general'
  },
  'realesr-general-wdn-x4v3': {
    name: 'Four times, keeps texture',
    what: 'Like the quick one, but leaves more of the photo’s own texture, and a little of its grain.',
    where: 'Enhance → Super resolution → ×4 keep texture'
  },
  'nafnet-gopro-w32': {
    name: 'Motion blur fix',
    what: 'Sharpens a photo smeared by camera shake or a moving subject. It cannot rescue a photo that was simply out of focus.',
    where: 'Enhance → Deblur',
    recommended: true
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
