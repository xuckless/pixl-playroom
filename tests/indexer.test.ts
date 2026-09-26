import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { IndexService } from '../src/main/indexer/service'
import type { IndexEvent } from '../src/main/indexer/protocol'
import { defaultRecipe, newLocalLayer, planeRef, type BrushComponent } from '../src/shared/recipe'

interface Fixture {
  root: string
  folder: string
  events: IndexEvent[]
  index: IndexService
  done(): void
}

function fixture(files: string[] = ['a.jpg', 'b.CR2']): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'playroom-index-'))
  const folder = join(root, 'photos')
  mkdirSync(folder)
  for (const f of files) writeFileSync(join(folder, f), 'not really a photo')
  const events: IndexEvent[] = []
  const index = new IndexService({ userData: join(root, 'userData'), emit: (e) => events.push(e) })
  return {
    root,
    folder,
    events,
    index,
    done: () => {
      index.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}

/** Let background scans and the exif fill finish. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  await new Promise((r) => setTimeout(r, 50))
}

test('the first listing scans the folder, skipping hidden and AppleDouble files', async () => {
  const f = fixture(['a.jpg', 'b.CR2', '._a.jpg', '.DS_Store', 'notes.txt'])
  try {
    const items = await f.index.listFolder(f.folder)
    assert.deepEqual(
      items.map((i) => [i.name, i.isRaw, i.copyId]),
      [
        ['a.jpg', false, null],
        ['b.CR2', true, null]
      ]
    )
  } finally {
    f.done()
  }
})

test('a listing answers from the index, and a rescan with nothing new says nothing', async () => {
  const f = fixture()
  try {
    await f.index.listFolder(f.folder)
    await settle()
    f.events.length = 0
    const again = await f.index.listFolder(f.folder)
    assert.equal(again.length, 2)
    await settle()
    assert.deepEqual(f.events, [])

    writeFileSync(join(f.folder, 'c.jpg'), 'another')
    const stale = await f.index.listFolder(f.folder)
    assert.equal(stale.length, 2, 'the listing is the index as it was')
    await settle()
    assert.ok(f.events.some((e) => e.name === 'changed' && e.folder === f.folder))
    assert.equal(f.index.items(f.folder).length, 3)
  } finally {
    f.done()
  }
})

test('an unreadable folder keeps its rows', async () => {
  const f = fixture()
  try {
    await f.index.listFolder(f.folder)
    await settle()
    rmSync(f.folder, { recursive: true })
    await f.index.rescan(f.folder)
    assert.equal(f.index.items(f.folder).length, 2)
  } finally {
    f.done()
  }
})

test('meta and recipe writes keep each other (read-modify-write in the index)', async () => {
  const f = fixture()
  try {
    const [a] = await f.index.listFolder(f.folder)
    const r = defaultRecipe(false)
    r.basic.exposure = 1
    f.index.saveRecipe(a.key, r)
    const [after] = f.index.setMeta([a.key], { rating: 4, flag: 'pick' })
    assert.equal(after?.rating, 4)
    assert.equal(after?.edited, true)
    assert.equal(f.index.recipe(a.key).basic.exposure, 1)
    f.index.saveRecipe(a.key, { ...r, basic: { ...r.basic, exposure: 2 } })
    assert.equal(f.index.item(a.key)?.rating, 4)
  } finally {
    f.done()
  }
})

test('an unedited photo leaves no sidecar', async () => {
  const f = fixture()
  try {
    const [a] = await f.index.listFolder(f.folder)
    f.index.saveRecipe(a.key, defaultRecipe(false))
    assert.equal(existsSync(a.path + '.playroom.json'), false)
  } finally {
    f.done()
  }
})

test('batch saves, resets and copies', async () => {
  const f = fixture()
  try {
    const items = await f.index.listFolder(f.folder)
    const pairs = items.map((it) => {
      const r = defaultRecipe(it.isRaw)
      r.basic.contrast = 20
      return { key: it.key, recipe: r }
    })
    const saved = f.index.saveRecipes(pairs)
    assert.deepEqual(
      saved.map((i) => i?.edited),
      [true, true]
    )

    const copy = f.index.createCopy(items[0].key)
    assert.equal(copy.copyName, 'Copy 1')
    assert.equal(f.index.recipe(copy.key).basic.contrast, 20)
    // The copy follows its photo in a listing.
    assert.deepEqual(
      f.index.items(f.folder).map((i) => i.key),
      [items[0].key, copy.key, items[1].key]
    )

    const { items: reset, recipes } = f.index.resetRecipes([items[0].key])
    assert.equal(reset[0]?.edited, false)
    assert.equal(recipes[items[0].key].basic.contrast, 0)

    f.index.deleteCopy(copy.key)
    assert.equal(f.index.item(copy.key), undefined)
  } finally {
    f.done()
  }
})

test('a thumbnail is asked for once per recipe, and not again for a file that failed', async () => {
  const f = fixture()
  try {
    const [a, b] = await f.index.listFolder(f.folder)
    const job = f.index.thumbJob(a.photoId, null)
    assert.ok(job)
    assert.equal(job.edited, false)
    const out = join(f.root, 'thumb.jpg')
    writeFileSync(out, 'jpeg')
    f.index.setThumb(a.photoId, null, out, job.stamp)
    assert.equal(f.index.thumbJob(a.photoId, null), null)
    assert.match(f.index.item(a.key)?.thumbUrl ?? '', /^pixl:\/\/c\//)

    const r = defaultRecipe(false)
    r.basic.exposure = 1
    f.index.saveRecipe(a.key, r)
    assert.ok(f.index.thumbJob(a.photoId, null), 'an edit needs a new thumbnail')

    f.index.markFailed(b.photoId, 'unrecognised container')
    assert.equal(f.index.thumbJob(b.photoId, null), null)
    assert.equal(f.index.item(b.key)?.unreadable, true)
  } finally {
    f.done()
  }
})

test('pruning keeps the planes the history names, and only those', async () => {
  const f = fixture()
  try {
    const [a] = await f.index.listFolder(f.folder)
    const kept = 'iVBORw0KGgo=kept'
    const dropped = 'iVBORw0KGgo=dropped'
    f.index.putPlane(planeRef(kept), kept)
    f.index.putPlane(planeRef(dropped), dropped)
    const r = defaultRecipe(false)
    const layer = newLocalLayer('brush')
    const brush: BrushComponent = {
      id: 'b1',
      kind: 'brush',
      mode: 'Add',
      opacity: 100,
      invert: false,
      feather: 0,
      width: 4,
      height: 4,
      png: '',
      ref: planeRef(kept)
    }
    layer.components.push(brush)
    r.layers.push(layer)
    f.index.appendHistory(a.key, 'Brush', r)

    assert.equal(f.index.prunePlanes(), 1)
    assert.equal(f.index.plane(planeRef(kept)), kept)
    assert.equal(f.index.plane(planeRef(dropped)), undefined)
  } finally {
    f.done()
  }
})
