import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { randomBytes } from 'crypto'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  PIXL_APPLICATION_ID,
  PIXL_FORMAT_VERSION,
  BLOB_CHUNK,
  jpegSize,
  PixlFile,
  sha256File,
  type Origin
} from '../src/main/project/pixlfile'
import { planFor } from '../src/main/project/embedplan'
import type { SourceInfo } from '../src/shared/engine-types'
import { newProjectPath, projectName, projectsDirFor } from '../src/main/project/locate'
import { IndexService } from '../src/main/indexer/service'
import { emptySidecar, sidecarPath } from '../src/main/sidecar'
import type { XmpIo } from '../src/main/indexer/xmp'
import { defaultRecipe, newLocalLayer, type BrushComponent } from '../src/shared/recipe'
import { keyOf } from '../src/main/keys'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pixl-'))

const origin = (dir: string): Origin => ({
  name: 'a.jpg',
  ext: 'jpg',
  size: 10,
  mtime: 1,
  path: join(dir, 'a.jpg'),
  isRaw: false,
  sha1: null
})

const brush = (png: string): BrushComponent => ({
  id: `b-${png.length}`,
  kind: 'brush',
  mode: 'Add',
  opacity: 100,
  invert: false,
  feather: 0,
  width: 4,
  height: 4,
  png
})

test('a project is a SQLite file that says what it is, with no journal left beside it', () => {
  const dir = tmp()
  const path = join(dir, 'a.pixl')
  PixlFile.create(path, origin(dir)).close()
  const db = new DatabaseSync(path)
  const pragma = (name: string): number =>
    (db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)[name]
  assert.equal(pragma('application_id'), PIXL_APPLICATION_ID)
  assert.equal(pragma('user_version'), PIXL_FORMAT_VERSION)
  assert.equal(pragma('page_size'), 16384)
  // 2 = incremental
  assert.equal(pragma('auto_vacuum'), 2)
  db.close()
  const p = PixlFile.open(path)
  assert.equal(p.meta('format'), 'pixl-project')
  assert.equal(p.origin()?.name, 'a.jpg')
  p.close()
  assert.deepEqual(readdirSync(dir), ['a.pixl'])
  rmSync(dir, { recursive: true })
})

test('a file that is not a project is refused, and left alone', () => {
  const dir = tmp()
  const path = join(dir, 'b.pixl')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE x (y)')
  db.close()
  assert.throws(() => PixlFile.open(path), /not a Pixl project/)
  assert.equal(PixlFile.peekOrigin(path), null)
  rmSync(dir, { recursive: true })
})

test('what a sidecar holds goes in and comes back, planes kept once by reference', () => {
  const dir = tmp()
  const p = PixlFile.create(join(dir, 'a.pixl'), origin(dir))
  const s = emptySidecar()
  const r = defaultRecipe(false)
  r.basic.exposure = 0.7
  const l = newLocalLayer('Mask 1')
  l.components.push(brush('iVBORw0KGgo-plane-one'))
  r.layers.push(l)
  s.photo = { rating: 4, flag: 'pick', label: 'red', recipe: r, snapshots: [] }
  s.copies.push({
    id: 'c1',
    name: 'Copy 1',
    rating: 0,
    flag: null,
    label: null,
    recipe: structuredClone(r),
    snapshots: [{ id: 's1', name: 'Before', at: 'now', recipe: structuredClone(r) }]
  })
  s.stack = { id: 'st', position: 1 }
  p.write(s)
  // Three recipes name one plane: it is stored once, and recipes hold its reference.
  assert.equal([...p.planes()].length, 1)
  const back = p.read(false)
  assert.equal(back.photo.rating, 4)
  assert.equal(back.photo.flag, 'pick')
  assert.equal(back.photo.recipe?.basic.exposure, 0.7)
  const c = back.photo.recipe!.layers[0].components[0] as BrushComponent
  assert.equal(c.png, 'iVBORw0KGgo-plane-one')
  assert.equal(back.copies.length, 1)
  assert.equal(back.copies[0].snapshots[0].name, 'Before')
  assert.deepEqual(back.stack, { id: 'st', position: 1 })
  // A copy gone from what is written goes from the project, with its history.
  p.history.append('c1', 'Opened', r)
  p.write({ ...back, copies: [] })
  assert.equal(p.read(false).copies.length, 0)
  assert.equal(p.history.history('c1').base, null)
  p.close()
  rmSync(dir, { recursive: true })
})

test('history lives in the project, and gc drops planes nothing names', () => {
  const dir = tmp()
  const p = PixlFile.create(join(dir, 'a.pixl'), origin(dir))
  const r = defaultRecipe(false)
  p.history.append('', 'Opened', r)
  const next = structuredClone(r)
  next.basic.contrast = 20
  const log = p.history.append('', 'Contrast', next)
  assert.equal(log.steps.length, 1)
  p.putPlane('orphan', 'x')
  p.putPlane('kept', 'y')
  const named = structuredClone(next)
  const l = newLocalLayer('m')
  l.components.push({ ...brush(''), ref: 'kept' })
  named.layers.push(l)
  p.history.append('', 'Mask', named)
  assert.equal(p.gc(), 1)
  assert.equal(p.plane('kept'), 'y')
  assert.equal(p.plane('orphan'), undefined)
  p.close()
  rmSync(dir, { recursive: true })
})

test('a RAW and its JPEG get a project each; a locked folder uses the projects folder', () => {
  assert.equal(projectName('IMG_1.CR3', ['IMG_1.CR3', 'IMG_2.CR3']), 'IMG_1.pixl')
  assert.equal(projectName('IMG_1.CR3', ['IMG_1.CR3', 'IMG_1.JPG']), 'IMG_1.CR3.pixl')
  assert.equal(projectName('IMG_1.JPG', ['IMG_1.CR3', 'IMG_1.JPG']), 'IMG_1.JPG.pixl')
  const dir = tmp()
  writeFileSync(join(dir, 'IMG_1.pixl'), '')
  // Taken: the next free name.
  assert.equal(
    newProjectPath(join(dir, 'IMG_1.jpg'), 'beside', ['IMG_1.jpg']),
    join(dir, 'IMG_1 (2).pixl')
  )
  const root = join(dir, 'projects')
  const p = newProjectPath(join(dir, 'IMG_1.jpg'), { folder: root }, ['IMG_1.jpg'])
  assert.equal(p, join(projectsDirFor(root, dir), 'IMG_1.pixl'))
  assert.ok(existsSync(projectsDirFor(root, dir)))
  // Two folders of one name never share a projects subfolder.
  assert.notEqual(projectsDirFor(root, '/a/Export'), projectsDirFor(root, '/b/Export'))
  rmSync(dir, { recursive: true })
})

const noXmp: XmpIo = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
  end: () => Promise.resolve()
}

/** Let the index's background fills (exif, xmp) finish before the files go. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300))

test('the first edit makes the project: the sidecar and the index history move into it', async () => {
  const root = tmp()
  const folder = join(root, 'photos')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.jpg'), 'not really a photo')
  writeFileSync(join(folder, 'b.jpg'), 'not really a photo')
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  const items = await index.listFolder(folder)
  const a = items.find((i) => i.name === 'a.jpg')!.key
  const b = items.find((i) => i.name === 'b.jpg')!.key

  // A rating alone is a sidecar, never a project.
  index.setMeta([b], { rating: 3 })
  assert.ok(existsSync(sidecarPath(join(folder, 'b.jpg'))))
  assert.equal(index.projectPath(b), null)

  // Opening records a base in the index; a rating goes to the sidecar.
  const r = defaultRecipe(false)
  index.appendHistory(a, 'Opened', r)
  index.setMeta([a], { rating: 5 })
  assert.equal(index.projectPath(a), null)
  // The first real step makes the project, beside the photo.
  const edited = structuredClone(r)
  edited.basic.exposure = 1
  const log = index.appendHistory(a, 'Exposure', edited)
  assert.equal(log.base?.label, 'Opened')
  assert.equal(log.steps.length, 1)
  const project = index.projectPath(a)
  assert.equal(project, join(folder, 'a.pixl'))
  assert.equal(existsSync(sidecarPath(join(folder, 'a.jpg'))), false)
  index.saveRecipe(a, edited)
  assert.equal(index.recipe(a).basic.exposure, 1)
  assert.equal(index.item(a)?.rating, 5)
  assert.equal(index.item(a)?.edited, true)
  assert.equal(index.item(a)?.project, project)

  // Copies and their history live in it too.
  const copy = index.createCopy(a)
  index.appendHistory(copy.key, 'Opened', edited)
  assert.equal(index.history(copy.key).base?.label, 'Opened')

  // A new index (a lost one, another machine) finds the project and reads it.
  await settle()
  index.close()
  const again = new IndexService({ userData: join(root, 'ud2'), emit: () => {}, xmp: noXmp })
  const listed = await again.listFolder(folder)
  const a2 = listed.find((i) => i.name === 'a.jpg' && i.copyId === null)!
  assert.equal(a2.project, project)
  assert.equal(a2.rating, 5)
  assert.equal(again.recipe(a2.key).basic.exposure, 1)
  assert.equal(again.history(a2.key).steps.length, 1)
  assert.equal(listed.filter((i) => i.copyId !== null).length, 1)
  // The library lists the photo once: the project is not an item.
  assert.equal(listed.filter((i) => i.copyId === null).length, 2)
  await settle()
  again.close()
  rmSync(root, { recursive: true })
})

test('a project the user deletes lets the photo go back to unedited', async () => {
  const root = tmp()
  const folder = join(root, 'photos')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.jpg'), 'x')
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  const [it] = await index.listFolder(folder)
  const r = defaultRecipe(false)
  r.basic.exposure = 0.5
  index.saveRecipe(it.key, r)
  const project = index.projectPath(it.key)!
  assert.ok(existsSync(project))
  index.close()
  rmSync(project)
  const again = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  await again.rescan(folder)
  assert.equal(again.projectPath(keyOf(it.photoId, null)), null)
  assert.equal(again.item(it.key)?.edited, false)
  await settle()
  again.close()
  rmSync(root, { recursive: true })
})

test('a blob goes in by its hash, in chunks, and comes out whole', () => {
  const dir = tmp()
  const p = PixlFile.create(join(dir, 'a.pixl'), origin(dir))
  const file = join(dir, 'big.bin')
  writeFileSync(file, randomBytes(BLOB_CHUNK * 2 + 12345))
  const info = { kind: 'original', codec: 'raw', width: 1, height: 1, channels: null, depth: null }
  const hash = p.putBlobFile(file, info)
  assert.equal(hash, sha256File(file))
  // Stored once, however often it is put.
  assert.equal(p.putBlobFile(file, info), hash)
  const out = join(dir, 'out.bin')
  assert.ok(p.writeBlobTo(hash, out))
  assert.equal(sha256File(out), hash)
  assert.equal(p.blob(hash)?.bytes, BLOB_CHUNK * 2 + 12345)
  // Named by nothing, it stays while it may be on its way into a recipe…
  p.gc()
  assert.ok(p.blob(hash))
  // …and goes at the first collection after that.
  p.prepare("UPDATE blobs SET created_at = '2000-01-01T00:00:00.000Z'").run()
  p.gc()
  assert.equal(p.blob(hash), null)
  p.close()
  rmSync(dir, { recursive: true })
})

const probed = (input: SourceInfo['input'], more: Partial<SourceInfo> = {}): SourceInfo =>
  ({ input, gain_map: null, ...more }) as SourceInfo

test('each format is carried as compactly as it can be without losing a bit', () => {
  const MB = 1024 * 1024
  assert.equal(planFor('cr3', 30 * MB, probed('Raw')).kind, 'dng')
  assert.equal(planFor('dng', 30 * MB, probed('Raw')).kind, 'verbatim')
  assert.equal(planFor('jpg', 5 * MB, probed('Jpeg')).kind, 'jxl-jpeg')
  assert.equal(
    planFor('jpg', 5 * MB, probed('Jpeg', { gain_map: {} as SourceInfo['gain_map'] })).kind,
    'verbatim'
  )
  assert.equal(planFor('png', 2 * MB, probed('Png')).kind, 'verbatim')
  assert.equal(planFor('tif', 60 * MB, probed('Tiff')).kind, 'jxl-lossless')
  assert.equal(planFor('heic', 3 * MB, probed('Heif')).kind, 'verbatim')
  // A DNG holds the camera's EXIF only; everything else keeps all of it.
  assert.equal(planFor('cr3', 30 * MB, probed('Raw')).metadata.icc, false)
  assert.equal(planFor('jpg', 5 * MB, probed('Jpeg')).metadata.icc, true)
})

test('a JPEG preview knows its size', () => {
  // SOI, APP0 (len 4), SOF0 with 300 high × 400 wide.
  const b = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01,
    0x90, 0x03, 0x00, 0x00, 0x00, 0x00
  ])
  assert.deepEqual(jpegSize(b), { width: 400, height: 300 })
  assert.equal(jpegSize(Uint8Array.from([1, 2, 3])), null)
})

/** An index over a folder of stand-in photos, with a project for `a.jpg` carrying its original. */
async function withProject(location?: unknown): Promise<{
  root: string
  folder: string
  index: IndexService
  key: string
  project: string
  done(): Promise<void>
}> {
  const root = tmp()
  const folder = join(root, 'photos')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.jpg'), 'the original bytes')
  writeFileSync(join(folder, 'b.jpg'), 'another photo')
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  if (location !== undefined) index.setSetting('projects.location', location)
  const items = await index.listFolder(folder)
  const key = items.find((i) => i.name === 'a.jpg')!.key
  const r = defaultRecipe(false)
  r.basic.exposure = 0.8
  index.saveRecipe(key, r)
  index.putOriginal(key, join(folder, 'a.jpg'), 'verbatim', {
    codec: 'jpg',
    width: 1,
    height: 1,
    note: null
  })
  return {
    root,
    folder,
    index,
    key,
    project: index.projectPath(key)!,
    done: async () => {
      await settle()
      index.close()
      rmSync(root, { recursive: true })
    }
  }
}

test('a photo whose file is gone develops from the copy its project carries', async () => {
  const f = await withProject()
  assert.equal(f.index.originalState(f.key).state, 'ready')
  const before = f.index.sourceRow(f.key)
  assert.equal(before.embedded, undefined)
  assert.equal(before.seed_path, join(f.folder, 'a.jpg'))
  rmSync(join(f.folder, 'a.jpg'))
  const row = f.index.sourceRow(f.key)
  assert.ok(row.embedded)
  assert.equal(readFileSync(row.embedded!.path, 'utf8'), 'the original bytes')
  // The grain stays where it was.
  assert.equal(row.seed_path, join(f.folder, 'a.jpg'))
  await f.done()
})

test('a project whose photo is gone stands in for it in the library', async () => {
  const f = await withProject()
  rmSync(join(f.folder, 'a.jpg'))
  await f.index.rescan(f.folder)
  const items = f.index.items(f.folder)
  const a = items.find((i) => i.name === 'a.jpg')
  assert.ok(a, 'the photo is still listed')
  assert.equal(a!.path, f.project)
  assert.equal(a!.project, f.project)
  assert.equal(a!.edited, true)
  assert.equal(f.index.recipe(a!.key).basic.exposure, 0.8)
  assert.equal(readFileSync(f.index.sourceRow(a!.key).embedded!.path, 'utf8'), 'the original bytes')
  // The photo comes back: it is the photo again, with its project.
  writeFileSync(join(f.folder, 'a.jpg'), 'the original bytes')
  await f.index.rescan(f.folder)
  const back = f.index.items(f.folder).filter((i) => i.name === 'a.jpg')
  assert.equal(back.length, 1)
  assert.equal(back[0].path, join(f.folder, 'a.jpg'))
  assert.equal(back[0].project, f.project)
  await f.done()
})

test('a photo moved away from its project in a projects folder finds it again', async () => {
  const root = tmp()
  const f = await withProject({ folder: join(root, 'projects') })
  assert.ok(f.project.startsWith(join(root, 'projects')))
  const elsewhere = join(f.root, 'moved')
  mkdirSync(elsewhere)
  renameSync(join(f.folder, 'a.jpg'), join(elsewhere, 'a.jpg'))
  const items = await f.index.listFolder(elsewhere)
  const a = items.find((i) => i.name === 'a.jpg')!
  assert.equal(a.project, f.project)
  assert.equal(f.index.recipe(a.key).basic.exposure, 0.8)
  // The project now names where the photo is.
  assert.equal(PixlFile.peekOrigin(f.project)?.path, join(elsewhere, 'a.jpg'))
  await f.done()
  rmSync(root, { recursive: true })
})

test('opening a .pixl opens its photo', async () => {
  const f = await withProject()
  const { folder, keys } = await f.index.resolvePaths([f.project])
  assert.equal(folder, f.folder)
  assert.deepEqual(keys, [f.key])
  await f.done()
})

test('a blob a snapshot names is kept', () => {
  const dir = tmp()
  const p = PixlFile.create(join(dir, 'a.pixl'), origin(dir))
  const file = join(dir, 'x.bin')
  writeFileSync(file, 'pixels')
  const hash = p.putBlobFile(file, {
    kind: 'pixels',
    codec: 'jxl',
    width: 1,
    height: 1,
    channels: null,
    depth: null
  })
  const s = emptySidecar()
  const r = defaultRecipe(false)
  ;(r as unknown as { pixels: unknown[] }).pixels = [{ id: 'x', kind: 'denoise', blob: hash }]
  s.photo.snapshots = [{ id: 'sn', name: 'Before', at: 'now', recipe: r }]
  p.write(s)
  p.prepare("UPDATE blobs SET created_at = '2000-01-01T00:00:00.000Z'").run()
  p.gc()
  assert.ok(p.blob(hash))
  p.close()
  rmSync(dir, { recursive: true })
})
