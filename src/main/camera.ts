/**
 * What the camera wrote: make, model, lens, exposure, when and where. Read
 * with exifr from the file's own tags; nothing here needs Electron, so the
 * index host runs it, off the main process.
 */
import exifr from 'exifr'
import { open } from 'fs/promises'
import type { CameraInfo } from '../shared/ipc'

/**
 * Whether exifr can parse a file that starts with `head`: JPEG, TIFF and the
 * RAWs built on it, PNG, and ISO-BMFF (HEIC, AVIF, CR3). exifr, handed a path
 * it cannot parse, throws with the file still open, and Node treats the
 * handle it leaves to the garbage collector as an error; so nothing else goes
 * near it (and it would have found nothing there anyway).
 */
export function exifrCanRead(head: Uint8Array): boolean {
  const at = (i: number, ...bytes: number[]): boolean => bytes.every((b, k) => head[i + k] === b)
  return (
    at(0, 0xff, 0xd8) ||
    at(0, 0x49, 0x49) || // II: little-endian TIFF, CR2, NEF, ARW, DNG, ORF, RW2
    at(0, 0x4d, 0x4d) || // MM: big-endian TIFF
    at(0, 0x89, 0x50, 0x4e, 0x47) ||
    at(4, 0x66, 0x74, 0x79, 0x70) // ftyp
  )
}

async function headOf(path: string): Promise<Uint8Array> {
  const fh = await open(path, 'r')
  try {
    const buf = new Uint8Array(12)
    await fh.read(buf, 0, 12, 0)
    return buf
  } finally {
    await fh.close()
  }
}

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
    if (!exifrCanRead(await headOf(path))) return emptyCamera()
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
