/**
 * What the camera wrote: make, model, lens, exposure, when and where. Read
 * with exifr from the file's own tags; nothing here needs Electron, so the
 * pixels worker can run it off the main thread.
 */
import exifr from 'exifr'
import type { CameraInfo } from '../shared/ipc'

export function emptyCamera(): CameraInfo {
  return {
    make: null,
    model: null,
    lens: null,
    iso: null,
    exposureTime: null,
    fNumber: null,
    focalLength: null,
    capturedAt: null,
    gps: null
  }
}

export async function readCamera(path: string): Promise<CameraInfo> {
  try {
    const t = (await exifr.parse(path, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: false,
      icc: false,
      iptc: false,
      interop: false,
      translateValues: true,
      reviveValues: true
    })) as Record<string, unknown> | undefined
    if (!t) return emptyCamera()
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const date = t.DateTimeOriginal ?? t.CreateDate ?? t.ModifyDate
    return {
      make: str(t.Make),
      model: str(t.Model),
      lens: str(t.LensModel) ?? str(t.Lens),
      iso: num(t.ISO) ?? num(t.ISOSpeedRatings),
      exposureTime: num(t.ExposureTime),
      fNumber: num(t.FNumber),
      focalLength: num(t.FocalLength),
      capturedAt: date instanceof Date ? date.toISOString() : str(date),
      gps:
        num(t.latitude) !== null && num(t.longitude) !== null
          ? { lat: t.latitude as number, lon: t.longitude as number }
          : null
    }
  } catch {
    return emptyCamera()
  }
}
