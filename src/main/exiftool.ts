/**
 * ExifTool (exiftool-vendored): the one writer of descriptive metadata. The
 * index host uses it for `.xmp` sidecars, the exporter to embed metadata in
 * what it wrote. Originals are never passed to a write here.
 *
 * One shared instance per process, made on first use: each keeps up to two
 * long-lived perl processes. Nothing here needs Electron, so the index host
 * and the tests load it as it is.
 */
import type { ExifTool, WriteTags } from 'exiftool-vendored'
import { readFile, rename, writeFile } from 'fs/promises'
import { createRequire } from 'module'
import { sep } from 'path'

let shared: ExifTool | undefined
let explicitPath: string | undefined

/** Use this executable (the index host is handed the main process's). */
export function setExiftoolPath(path: string | undefined): void {
  explicitPath = path
}

/**
 * The vendored executable, resolved by require (pnpm keeps it beside
 * exiftool-vendored, not at the top of node_modules) and moved out of the
 * asar: perl cannot run a script inside the archive, so electron-builder
 * unpacks it to `app.asar.unpacked`. exiftool-vendored does the same rewrite,
 * but finds the package with a dynamic `import()`, which is less sure inside
 * an asar than `require`. Undefined outside a bundle (the tests), where the
 * library's own lookup is right.
 */
export function vendoredExiftoolPath(): string | undefined {
  if (typeof __filename !== 'string') return undefined
  try {
    const here = createRequire(__filename)
    const req = createRequire(here.resolve('exiftool-vendored'))
    const pkg = process.platform === 'win32' ? 'exiftool-vendored.exe' : 'exiftool-vendored.pl'
    const path = req(pkg) as string
    return path
      .split(sep)
      .map((p) => (p === 'app.asar' ? 'app.asar.unpacked' : p))
      .join(sep)
  } catch {
    return undefined
  }
}

let starting: Promise<ExifTool> | undefined

/**
 * The shared ExifTool, its library loaded the first time it is wanted (an
 * export, a metadata read or write), not on the launch's path.
 */
export function exiftool(): Promise<ExifTool> {
  if (shared) return Promise.resolve(shared)
  starting ??= import('exiftool-vendored').then(({ ExifTool: Tool }) => {
    const path = explicitPath ?? vendoredExiftoolPath()
    shared = new Tool({
      maxProcs: 2,
      // A slow network drive should not look like a hung perl.
      taskTimeoutMillis: 30_000,
      ...(path ? { exiftoolPath: path } : {})
    })
    return shared
  })
  return starting
}

/** Stop the perl processes, if any were started. */
export async function endExiftool(): Promise<void> {
  const et = shared ?? (await starting?.catch(() => undefined))
  shared = undefined
  starting = undefined
  await et?.end()
}

export interface EmbedOptions {
  /** Delete GPS coordinates (EXIF and XMP). */
  removeLocation: boolean
  /** The original photo: a JPEG's EXIF beyond repair is copied again from it. */
  source?: string
}

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1')
const TIFF_II = Buffer.from('II*\0', 'latin1')
const TIFF_MM = Buffer.from('MM\0*', 'latin1')

/**
 * A JPEG's EXIF block put right. The engine's JPEG writer repeated the
 * `Exif\0\0` header ("Exif\0\0Exif\0\0MM…") until 0.16.1, which ExifTool
 * calls a malformed APP1 and then refuses to write the file at all. The
 * extra header goes (TIFF offsets count from the TIFF header, so nothing
 * else moves); an EXIF block that still does not start with a TIFF header is
 * dropped. `changed` false: the buffer is returned as it came (every 0.16.1
 * export).
 */
export function repairJpegExif(jpeg: Buffer): { data: Buffer; changed: boolean; dropped: boolean } {
  const same = { data: jpeg, changed: false, dropped: false }
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return same
  const parts: Buffer[] = [jpeg.subarray(0, 2)]
  let changed = false
  let dropped = false
  let i = 2
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1]
    // Start of scan: the rest is picture data.
    if (marker === 0xda) break
    const len = jpeg.readUInt16BE(i + 2)
    const end = i + 2 + len
    if (len < 2 || end > jpeg.length) return same
    const body = jpeg.subarray(i + 4, end)
    if (marker === 0xe1 && body.subarray(0, 6).equals(EXIF_HEADER)) {
      let tiff = body.subarray(6)
      while (tiff.subarray(0, 6).equals(EXIF_HEADER)) tiff = tiff.subarray(6)
      const head = tiff.subarray(0, 4)
      if (!head.equals(TIFF_II) && !head.equals(TIFF_MM)) {
        changed = dropped = true
      } else if (tiff.length !== body.length - 6) {
        const seg = Buffer.alloc(4)
        seg[0] = 0xff
        seg[1] = 0xe1
        seg.writeUInt16BE(2 + 6 + tiff.length, 2)
        parts.push(seg, EXIF_HEADER, tiff)
        changed = true
      } else parts.push(jpeg.subarray(i, end))
    } else parts.push(jpeg.subarray(i, end))
    i = end
  }
  if (!changed) return same
  parts.push(jpeg.subarray(i))
  return { data: Buffer.concat(parts), changed, dropped }
}

const isJpeg = (file: string): boolean => /\.jpe?g$/i.test(file)

/**
 * Write `tags` (see `metadataPlan`) into an exported file (never an
 * original). A JPEG's EXIF block is repaired first, whatever there is to
 * write (see `repairJpegExif`); one beyond repair is dropped and, given the
 * `source` photo, copied again from it, without what the export changed
 * (orientation, size, previews). A format ExifTool cannot write throws; the
 * exporter reports it as a warning.
 */
export async function embedMetadata(
  file: string,
  tags: Record<string, string | string[]>,
  opts: EmbedOptions
): Promise<void> {
  if (isJpeg(file)) {
    const fixed = repairJpegExif(await readFile(file))
    if (fixed.changed) {
      const tmp = `${file}.exif-${process.pid}`
      await writeFile(tmp, fixed.data)
      await rename(tmp, file)
    }
    if (fixed.dropped && opts.source) {
      await (
        await exiftool()
      ).write(
        file,
        {},
        {
          writeArgs: [
            '-overwrite_original',
            '-m',
            '-TagsFromFile',
            opts.source,
            '-exif:all',
            '--Orientation',
            '--ThumbnailImage',
            '--PreviewImage',
            '--ExifImageWidth',
            '--ExifImageHeight'
          ]
        }
      )
    }
  }
  const args = ['-overwrite_original']
  if (opts.removeLocation) args.push('-gps:all=', '-xmp-exif:gps*=')
  if (Object.keys(tags).length === 0 && !opts.removeLocation) return
  // -m: a format without IPTC (PNG, WebP) takes the rest instead of failing.
  await (await exiftool()).write(file, tags as WriteTags, { writeArgs: ['-m', ...args] })
}
