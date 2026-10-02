/**
 * The pixels worker: per-pixel work that would otherwise hold up the main
 * process (and with it every IPC reply): mask planes drawn and encoded, and
 * pixel steps' overlays and masks (pixels/ops.ts).
 * One message in, one reply out, by id. (Exif is read by the index host.)
 */
import { parentPort } from 'worker_threads'
import { pruneGradientsSometimes, writeBrushPlane, writeGradientPlane } from '../planes'
import type { PixelsJob } from './pool'
import { buildPatch, composeMasked, unwarpMask, writeRamp } from '../pixels/ops'

parentPort?.on('message', (job: PixelsJob & { id: number }) => {
  try {
    if (job.op === 'gradient') {
      writeGradientPlane(job.file, job.c, job.user)
      pruneGradientsSometimes(job.dir)
    } else if (job.op === 'brush')
      writeBrushPlane(job.file, job.png, job.user, job.edge, job.object)
    else if (job.op === 'compose') composeMasked(job.image, job.mask, job.out)
    else if (job.op === 'ramp') writeRamp(job.file, job.w, job.h)
    else if (job.op === 'unwarp') unwarpMask(job.mask, job.map, job.w, job.h, job.out)
    else {
      const value = buildPatch(job.withStroke, job.without, job.out, job.mask)
      parentPort?.postMessage({ id: job.id, value })
      return
    }
    parentPort?.postMessage({ id: job.id, value: null })
  } catch (err) {
    parentPort?.postMessage({ id: job.id, error: (err as Error).message ?? String(err) })
  }
})
