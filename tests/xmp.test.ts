import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { embedMetadata, endExiftool, exiftool, repairJpegExif } from '../src/main/exiftool'
import { exiftoolXmp, metaToTags, tagsToMeta, xmpPathFor } from '../src/main/indexer/xmp'
import { encodeGreyPng } from '../src/main/pngio'
import { defaultExportSettings, metadataPlan, type ExportSettings } from '../src/shared/export'
import { flatSubjects, keywordPrefixes, normaliseKeywords } from '../src/shared/keywords'
import type { PhotoMeta } from '../src/shared/ipc'

const meta: PhotoMeta = {
  title: 'Lake at dusk',
  caption: 'Winnipeg Beach, late August',
  copyright: '© 2026 Ali',
  keywords: ['Places|Canada|Winnipeg', 'Places|Canada|Gimli', 'Water']
}

test('sidecar paths: a RAW shares its base name, anything else keeps its extension', () => {
  assert.equal(xmpPathFor('/p/IMG_1.CR2', true), '/p/IMG_1.xmp')
  assert.equal(xmpPathFor('/p/IMG_1.jpg', false), '/p/IMG_1.jpg.xmp')
})

test('keywords: tidy, prefixes, flat subjects', () => {
  assert.deepEqual(normaliseKeywords([' A | B ', 'A|B', '', '|C|', 'A||B']), ['A|B', 'C'])
  assert.deepEqual(keywordPrefixes('A|B|C'), ['A', 'A|B', 'A|B|C'])
  assert.deepEqual(flatSubjects(meta.keywords), ['Places', 'Canada', 'Winnipeg', 'Gimli', 'Water'])
})

test('metaToTags: subject gets every level, the hierarchy the paths, empties delete', () => {
  assert.deepEqual(metaToTags(meta), {
    'XMP-dc:Title': 'Lake at dusk',
    'XMP-dc:Description': 'Winnipeg Beach, late August',
    'XMP-dc:Rights': '© 2026 Ali',
    'XMP-dc:Subject': ['Places', 'Canada', 'Winnipeg', 'Gimli', 'Water'],
    'XMP-lr:HierarchicalSubject': meta.keywords
  })
  assert.deepEqual(metaToTags({ title: ' ', caption: null, copyright: '', keywords: [] }), {
    'XMP-dc:Title': null,
    'XMP-dc:Description': null,
    'XMP-dc:Rights': null,
    'XMP-dc:Subject': null,
    'XMP-lr:HierarchicalSubject': null
  })
})

test('tagsToMeta: the hierarchy wins, flat extras are top-level, ExifTool shapes are undone', () => {
  assert.deepEqual(
    tagsToMeta({
      'XMP-dc:Title': 2024,
      'XMP-dc:Subject': ['Places', 'Canada', 'Winnipeg', 'Sunset', 1999],
      'XMP-lr:HierarchicalSubject': 'Places|Canada|Winnipeg'
    }),
    {
      title: '2024',
      caption: null,
      copyright: null,
      keywords: ['Places|Canada|Winnipeg', 'Sunset', '1999']
    }
  )
  assert.deepEqual(tagsToMeta({ 'XMP-dc:Subject': 'Solo' }).keywords, ['Solo'])
  assert.deepEqual(tagsToMeta({}), { title: null, caption: null, copyright: null, keywords: [] })
})

/** What an export with these settings writes for `m`. */
const tagsFor = (
  m: PhotoMeta,
  metaMode: ExportSettings['metaMode'],
  copyright = ''
): Record<string, string | string[]> =>
  metadataPlan({ ...defaultExportSettings(), metaMode, copyright }, m).tags

/** Whether perl and the vendored ExifTool can start here. */
async function exiftoolWorks(): Promise<boolean> {
  try {
    await (await exiftool()).version()
    return true
  } catch {
    return false
  }
}

test('a real .xmp round trip, keeping tags that are not ours', async (t) => {
  if (!(await exiftoolWorks())) {
    t.skip('exiftool cannot start')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'playroom-xmp-'))
  const io = exiftoolXmp()
  try {
    const file = join(dir, 'IMG_1.xmp')
    assert.equal(await io.read(file), null, 'no sidecar yet')
    await io.write(file, meta)
    assert.deepEqual(await io.read(file), meta)

    // Someone else's tag survives our next write.
    await (
      await exiftool()
    ).write(file, { 'XMP-xmp:Label': 'Red' } as never, {
      writeArgs: ['-overwrite_original']
    })
    await io.write(file, { ...meta, title: null, keywords: ['Water'] })
    assert.deepEqual(await io.read(file), { ...meta, title: null, keywords: ['Water'] })
    const all = (await (await exiftool()).readRaw(file, { readArgs: ['-G1'] })) as Record<
      string,
      unknown
    >
    assert.equal(all['XMP-xmp:Label'], 'Red')
    assert.match(readFileSync(file, 'utf8'), /hierarchicalSubject/)

    // Embedding into an exported file (a PNG has no IPTC: the rest still lands).
    const png = join(dir, 'out.png')
    writeFileSync(png, encodeGreyPng(new Uint8Array(16).fill(128), 4, 4))
    await embedMetadata(png, tagsFor(meta, 'all'), { removeLocation: true })
    const out = (await (await exiftool()).readRaw(png, { readArgs: ['-G1'] })) as Record<
      string,
      unknown
    >
    assert.equal(out['XMP-dc:Title'], 'Lake at dusk')
    assert.equal(out['XMP-dc:Rights'], '© 2026 Ali')
  } finally {
    await io.end()
    await endExiftool()
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── the engine's JPEGs: a doubled `Exif\0\0` header ──

/** An 8×8 grey JPEG with no metadata at all. */
const BARE_JPEG = Buffer.from(
  '/9j/wAALCAAIAAgBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAA' +
    'F9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpT' +
    'VFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJyt' +
    'LT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9sAQwAGBgYGBgYKBgYKDgoKCg4SDg4ODhIXEhISEhIXHBcXFxcX' +
    'FxwcHBwcHBwcIiIiIiIiJycnJycsLCwsLCwsLCws/90ABAAB/9oACAEBAAA/AOar/9k=',
  'base64'
)

/** A big-endian TIFF block holding only IFD0:Make. */
function tiffWithMake(make: string): Buffer {
  const value = Buffer.from(make + '\0', 'latin1')
  const b = Buffer.alloc(26 + value.length)
  b.write('MM', 0, 'latin1')
  b.writeUInt16BE(42, 2)
  b.writeUInt32BE(8, 4)
  b.writeUInt16BE(1, 8) // one entry
  b.writeUInt16BE(0x010f, 10) // Make
  b.writeUInt16BE(2, 12) // ASCII
  b.writeUInt32BE(value.length, 14)
  b.writeUInt32BE(26, 18) // where the text is
  b.writeUInt32BE(0, 22) // no next IFD
  value.copy(b, 26)
  return b
}

/** The bare JPEG with an APP1 of `headers` × `Exif\0\0` and then `body`. */
function jpegWithApp1(headers: number, body: Buffer): Buffer {
  const head = Buffer.from('Exif\0\0', 'latin1')
  const payload = Buffer.concat([...Array<Buffer>(headers).fill(head), body])
  const seg = Buffer.alloc(4)
  seg.writeUInt16BE(0xffe1, 0)
  seg.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([BARE_JPEG.subarray(0, 2), seg, payload, BARE_JPEG.subarray(2)])
}

test('repairJpegExif: a doubled header goes, a good block stays, a hopeless one is dropped', () => {
  const tiff = tiffWithMake('Canon')
  const good = jpegWithApp1(1, tiff)
  assert.deepEqual(repairJpegExif(good), { data: good, changed: false, dropped: false })
  const fixed = repairJpegExif(jpegWithApp1(2, tiff))
  assert.equal(fixed.changed, true)
  assert.equal(fixed.dropped, false)
  assert.ok(fixed.data.equals(good), 'the same as if written right')
  const hopeless = repairJpegExif(jpegWithApp1(2, Buffer.from('garbage!')))
  assert.equal(hopeless.dropped, true)
  assert.ok(hopeless.data.equals(BARE_JPEG))
  assert.equal(repairJpegExif(Buffer.from('not a jpeg')).changed, false)
})

test('embedding into the engine’s JPEG keeps its EXIF, or copies it from the source', async (t) => {
  if (!(await exiftoolWorks())) {
    t.skip('exiftool cannot start')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'playroom-jpeg-'))
  try {
    const out = join(dir, 'export.jpg')
    writeFileSync(out, jpegWithApp1(2, tiffWithMake('Canon')))
    await embedMetadata(out, tagsFor(meta, 'all'), { removeLocation: false })
    const tags = (await (await exiftool()).readRaw(out, { readArgs: ['-G1'] })) as Record<
      string,
      unknown
    >
    assert.equal(tags['ExifTool:Warning'], undefined)
    assert.equal(tags['IFD0:Make'], 'Canon')
    assert.equal(tags['IFD0:Copyright'], '© 2026 Ali')
    assert.equal(tags['XMP-dc:Title'], 'Lake at dusk')

    // Nothing to write: the EXIF is still put right.
    const plain = join(dir, 'plain.jpg')
    writeFileSync(plain, jpegWithApp1(2, tiffWithMake('Canon')))
    await embedMetadata(plain, {}, { removeLocation: false })
    assert.ok(readFileSync(plain).equals(jpegWithApp1(1, tiffWithMake('Canon'))))

    // Location removed, the rest kept.
    await (
      await exiftool()
    ).write(out, { GPSLatitude: 49.9, GPSLatitudeRef: 'N' } as never, {
      writeArgs: ['-overwrite_original']
    })
    await embedMetadata(out, {}, { removeLocation: true })
    const noGps = (await (await exiftool()).readRaw(out, { readArgs: ['-G1'] })) as Record<
      string,
      unknown
    >
    assert.deepEqual(
      Object.keys(noGps).filter((k) => /gps/i.test(k)),
      []
    )
    assert.equal(noGps['IFD0:Make'], 'Canon')

    // Beyond repair: the source photo's EXIF instead, and the dialog's
    // copyright for a photo without one.
    const source = join(dir, 'source.jpg')
    writeFileSync(source, jpegWithApp1(1, tiffWithMake('Nikon')))
    const broken = join(dir, 'broken.jpg')
    writeFileSync(broken, jpegWithApp1(2, Buffer.from('garbage!')))
    await embedMetadata(broken, tagsFor({ ...meta, copyright: null }, 'copyrightOnly', 'Studio'), {
      removeLocation: false,
      source
    })
    const b = (await (await exiftool()).readRaw(broken, { readArgs: ['-G1'] })) as Record<
      string,
      unknown
    >
    assert.equal(b['IFD0:Make'], 'Nikon')
    assert.equal(b['IFD0:Copyright'], 'Studio')
    assert.equal(b['XMP-dc:Title'], undefined, 'copyright only')
  } finally {
    await endExiftool()
    rmSync(dir, { recursive: true, force: true })
  }
})
