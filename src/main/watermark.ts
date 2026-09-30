/**
 * The export watermark's file: read to check it is a PNG, sized from its
 * header, and handed to the export dialog as a data URL for the preview.
 */
import { open, readFile, stat } from 'fs/promises'
import type { WatermarkFile } from '../shared/ipc'
import { pngSize } from '../shared/watermark'

/** Past this the preview's data URL is heavy; a watermark is a logo, not a photo. */
const MAX_BYTES = 25 * 1024 * 1024

export async function readWatermark(path: string): Promise<WatermarkFile> {
  const st = await stat(path).catch(() => null)
  if (!st) throw new Error(`the watermark is not at ${path}`)
  if (st.size > MAX_BYTES) throw new Error('the watermark is over 25 MB: use a smaller PNG')
  const bytes = await readFile(path)
  const size = pngSize(bytes)
  if (!size) throw new Error('the watermark must be a PNG')
  return { path, ...size, url: `data:image/png;base64,${bytes.toString('base64')}` }
}

/** Just the size, for an export (no data URL). */
export async function watermarkSize(path: string): Promise<{ width: number; height: number }> {
  const head = Buffer.alloc(24)
  const f = await open(path, 'r').catch(() => null)
  if (!f) throw new Error(`the watermark is not at ${path}`)
  try {
    await f.read(head, 0, 24, 0)
  } finally {
    await f.close()
  }
  const size = pngSize(head)
  if (!size) throw new Error('the watermark must be a PNG')
  return size
}
