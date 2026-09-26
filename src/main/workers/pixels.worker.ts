/**
 * The pixels worker: per-pixel and parsing work that would otherwise hold
 * up the main process (and with it every IPC reply): mask planes drawn and
 * encoded, and exif parsed. One message in, one reply out, by id.
 */
import { parentPort } from 'worker_threads'
import { readCamera } from '../camera'
import { pruneGradients, writeBrushPlane, writeGradientPlane } from '../planes'
import type { PixelsJob } from './pool'

parentPort?.on('message', async (job: PixelsJob & { id: number }) => {
  try {
    let value: unknown = null
    if (job.op === 'gradient') {
      writeGradientPlane(job.file, job.c, job.user)
      pruneGradients(job.dir)
    } else if (job.op === 'brush') writeBrushPlane(job.file, job.png, job.user)
    else value = await readCamera(job.path)
    parentPort?.postMessage({ id: job.id, value })
  } catch (err) {
    parentPort?.postMessage({ id: job.id, error: (err as Error).message ?? String(err) })
  }
})
