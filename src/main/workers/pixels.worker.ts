/**
 * The pixels worker: per-pixel work that would otherwise hold up the main
 * process (and with it every IPC reply): mask planes drawn and encoded.
 * One message in, one reply out, by id. (Exif is read by the index host.)
 */
import { parentPort } from 'worker_threads'
import { pruneGradients, writeBrushPlane, writeGradientPlane } from '../planes'
import type { PixelsJob } from './pool'

parentPort?.on('message', (job: PixelsJob & { id: number }) => {
  try {
    if (job.op === 'gradient') {
      writeGradientPlane(job.file, job.c, job.user)
      pruneGradients(job.dir)
    } else writeBrushPlane(job.file, job.png, job.user)
    parentPort?.postMessage({ id: job.id, value: null })
  } catch (err) {
    parentPort?.postMessage({ id: job.id, error: (err as Error).message ?? String(err) })
  }
})
