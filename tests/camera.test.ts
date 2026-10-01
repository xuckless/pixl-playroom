import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { emptyCamera, readCamera } from '../src/main/camera'

/** A real (if tiny) JPEG: SOI, an EXIF APP1 naming its camera, EOI. */
function jpegWithExif(make: string, model: string): Buffer {
  const strings = [`${make}\0`, `${model}\0`]
  const ifdAt = 8
  const entries = 2
  const dataAt = ifdAt + 2 + entries * 12 + 4
  const tiff = Buffer.alloc(dataAt + strings.reduce((n, s) => n + s.length, 0))
  tiff.write('II', 0, 'latin1')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(ifdAt, 4)
  tiff.writeUInt16LE(entries, ifdAt)
  let at = dataAt
  ;[0x010f, 0x0110].forEach((tag, i) => {
    const e = ifdAt + 2 + i * 12
    tiff.writeUInt16LE(tag, e)
    tiff.writeUInt16LE(2, e + 2) // ASCII
    tiff.writeUInt32LE(strings[i].length, e + 4)
    tiff.writeUInt32LE(at, e + 8)
    tiff.write(strings[i], at, 'latin1')
    at += strings[i].length
  })
  tiff.writeUInt32LE(0, ifdAt + 2 + entries * 12)
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const len = Buffer.alloc(2)
  len.writeUInt16BE(exif.length + 2)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    len,
    exif,
    Buffer.from([0xff, 0xd9])
  ])
}

test('the camera is read from the file’s own bytes; a truncated file reads as unknown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'playroom-camera-'))
  try {
    const whole = jpegWithExif('Canon', 'EOS R5')
    writeFileSync(join(dir, 'a.jpg'), whole)
    const cam = await readCamera(join(dir, 'a.jpg'))
    assert.equal(cam.make, 'Canon')
    assert.equal(cam.model, 'EOS R5')
    // Cut off inside its EXIF: no tags, and nothing thrown or left open.
    writeFileSync(join(dir, 'cut.jpg'), whole.subarray(0, 24))
    assert.deepEqual(await readCamera(join(dir, 'cut.jpg')), emptyCamera())
    assert.deepEqual(await readCamera(join(dir, 'missing.jpg')), emptyCamera())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
