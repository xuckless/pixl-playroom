import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { IndexService } from '../src/main/indexer/service'
import { PixlFile } from '../src/main/project/pixlfile'
import type { IndexEvent } from '../src/main/indexer/protocol'
import type { XmpIo } from '../src/main/indexer/xmp'
import type { Store } from '../src/main/db'
import type { PhotoMeta } from '../src/shared/ipc'
import { defaultRecipe, newLocalLayer, planeRef, type BrushComponent } from '../src/shared/recipe'

interface Fixture {
  root: string
  folder: string
  events: IndexEvent[]
  index: IndexService
  xmp: StubXmp
  /** Another index over the same files (a lost or new index). */
  reopen(): IndexService
  done(): void
}

interface StubXmp extends XmpIo {
  writes: string[]
}

/** `.xmp` sidecars as JSON: what ExifTool would keep, without ExifTool. */
function stubXmp(): StubXmp {
  const writes: string[] = []
  return {
    writes,
    async read(path) {
      if (!existsSync(path)) return null
      return JSON.parse(readFileSync(path, 'utf8')) as PhotoMeta
    },
    async write(path, meta) {
      writes.push(path)
      writeFileSync(path, JSON.stringify(meta))
    },
    end: () => Promise.resolve()
  }
}

function fixture(files: string[] = ['a.jpg', 'b.CR2']): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'playroom-index-'))
  const folder = join(root, 'photos')
  mkdirSync(folder)
  for (const f of files) writeFileSync(join(folder, f), 'not really a photo')
  const events: IndexEvent[] = []
  const xmp = stubXmp()
  const index = new IndexService({
    userData: join(root, 'userData'),
    emit: (e) => events.push(e),
    xmp
  })
  const others: IndexService[] = []
  return {
    root,
    folder,
    events,
    index,
    xmp,
    reopen: () => {
      const again = new IndexService({
        userData: join(root, `userData-${others.length + 2}`),
        emit: () => {},
        xmp
      })
      others.push(again)
      return again
    },
    done: () => {
      index.close()
      for (const o of others) o.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}

/** The index's own store, for what a test cannot reach through files (capture times). */
const storeOf = (index: IndexService): Store => (index as unknown as { store: Store }).store

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

    // Stored since the index opened: in use, kept whatever the history says.
    assert.equal(f.index.prunePlanes(), 0)
    // At the next start the one nothing names goes.
    const again = new IndexService({
      userData: join(f.root, 'userData'),
      emit: () => {},
      xmp: f.xmp
    })
    try {
      assert.equal(again.prunePlanes(), 1)
    } finally {
      again.close()
    }
    assert.equal(f.index.plane(planeRef(kept)), kept)
    assert.equal(f.index.plane(planeRef(dropped)), undefined)
  } finally {
    f.done()
  }
})

// ── the library: metadata, keywords, collections, stacks, duplicates ──

/** Give an .xmp a new modification time, as another app's save would. */
const touch = (path: string, secondsAgo: number): void => {
  const t = new Date(Date.now() - secondsAgo * 1000)
  utimesSync(path, t, t)
}

test('setMetadata writes the .xmp (RAW beside, others with extension) and mirrors it', async () => {
  const f = fixture()
  try {
    const [a, b] = await f.index.listFolder(f.folder)
    const copy = f.index.createCopy(a.key)
    f.events.length = 0
    const after = await f.index.setMetadata([a.key, copy.key, b.key], {
      title: '  Dusk ',
      addKeywords: ['Places | Canada | Winnipeg', 'Water']
    })
    assert.deepEqual(f.xmp.writes.sort(), [join(f.folder, 'a.jpg.xmp'), join(f.folder, 'b.xmp')])
    assert.equal(after[0]?.title, 'Dusk')
    assert.deepEqual(
      after[1]?.keywords,
      ['Places|Canada|Winnipeg', 'Water'],
      'a copy shows its photo’s'
    )
    assert.ok(f.events.some((e) => e.name === 'sources'))

    const [again] = await f.index.setMetadata([a.key], {
      removeKeywords: ['Places'],
      addKeywords: ['People|Ali'],
      caption: 'A caption'
    })
    assert.deepEqual(
      again?.keywords,
      ['People|Ali', 'Water'],
      'a keyword goes with what is under it'
    )
    assert.equal(again?.title, 'Dusk', 'untouched fields stay')
    assert.equal(again?.caption, 'A caption')

    // Nothing to say: no sidecar made.
    const writes = f.xmp.writes.length
    const c = join(f.folder, 'c.jpg')
    writeFileSync(c, 'another')
    const { keys } = await f.index.resolvePaths([c])
    await f.index.setMetadata(keys, { title: '' })
    assert.equal(f.xmp.writes.length, writes)
    assert.equal(existsSync(c + '.xmp'), false)
  } finally {
    f.done()
  }
})

test('a scan picks up an .xmp changed or removed by another app', async () => {
  const f = fixture()
  try {
    const [a] = await f.index.listFolder(f.folder)
    const file = join(f.folder, 'a.jpg.xmp')
    const meta: PhotoMeta = {
      title: 'From Lightroom',
      caption: null,
      copyright: 'X',
      keywords: ['K']
    }
    writeFileSync(file, JSON.stringify(meta))
    touch(file, 10)
    await f.index.rescan(f.folder)
    await settle()
    assert.equal(f.index.item(a.key)?.title, 'From Lightroom')
    assert.deepEqual(f.index.item(a.key)?.keywords, ['K'])
    assert.ok(f.events.some((e) => e.name === 'sources'))

    unlinkSync(file)
    await f.index.rescan(f.folder)
    await settle()
    assert.equal(f.index.item(a.key)?.title, null)
    assert.deepEqual(f.index.keywordTree(), [])
  } finally {
    f.done()
  }
})

test('the keyword tree counts photos under each level; a keyword source lists them', async () => {
  const f = fixture(['a.jpg', 'b.jpg', 'c.jpg'])
  try {
    const [a, b, c] = await f.index.listFolder(f.folder)
    const copy = f.index.createCopy(a.key)
    await f.index.setMetadata([a.key], { keywords: ['Places|Canada|Winnipeg', 'Places|Canada'] })
    await f.index.setMetadata([b.key], { keywords: ['Places|France', 'places|canada|gimli'] })
    await f.index.setMetadata([c.key], { keywords: ['Water'] })
    const tree = f.index.keywordTree()
    const flat = (nodes: typeof tree, out: string[] = []): string[] => {
      for (const n of nodes) {
        out.push(`${n.path}=${n.count}`)
        flat(n.children, out)
      }
      return out
    }
    // Case makes another keyword (as in Lightroom's tree), sorted beside it.
    assert.deepEqual(flat(tree), [
      'Places=2',
      'Places|Canada=1',
      'Places|Canada|Winnipeg=1',
      'Places|France=1',
      'places=1',
      'places|canada=1',
      'places|canada|gimli=1',
      'Water=1'
    ])
    const { items } = await f.index.listSource({ kind: 'keyword', path: 'Places' })
    assert.deepEqual(
      items.map((i) => i.key),
      [a.key, copy.key, b.key]
    )
    const exact = await f.index.listSource({ kind: 'keyword', path: 'Places|Canada|Winnipeg' })
    assert.deepEqual(
      exact.items.map((i) => i.key),
      [a.key, copy.key]
    )
    // A LIKE wildcard in a name is only a character.
    await f.index.setMetadata([c.key], { addKeywords: ['50%'] })
    const pct = await f.index.listSource({ kind: 'keyword', path: '5%' })
    assert.equal(pct.items.length, 0)
  } finally {
    f.done()
  }
})

test('a manual collection spans folders and holds copies on their own', async () => {
  const f = fixture()
  try {
    const other = join(f.root, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'z.jpg'), 'elsewhere')
    const [a, b] = await f.index.listFolder(f.folder)
    const [z] = await f.index.listFolder(other)
    const copy = f.index.createCopy(b.key)
    const col = f.index.saveCollection({
      name: ' Trip ',
      kind: 'manual',
      parent: null,
      rules: null,
      sort: 0
    })
    assert.equal(col.name, 'Trip')
    f.index.collectionItems(col.id, [a.key, copy.key, z.key], 'add')
    f.index.collectionItems(col.id, [a.key], 'add') // twice is once
    const { items } = await f.index.listSource({ kind: 'collection', id: col.id })
    assert.deepEqual(
      items.map((i) => [i.key, i.folder]),
      [
        [z.key, other],
        [a.key, f.folder],
        [copy.key, f.folder]
      ].sort((x, y) => x[1].localeCompare(y[1]))
    )
    assert.equal(f.index.collections()[0].count, 3)

    f.index.collectionItems(col.id, [a.key], 'remove')
    f.index.deleteCopy(copy.key)
    const after = await f.index.listSource({ kind: 'collection', id: col.id })
    assert.deepEqual(
      after.items.map((i) => i.key),
      [z.key]
    )

    // A file gone from a present folder shows offline in a collection.
    f.index.collectionItems(col.id, [b.key], 'add')
    unlinkSync(b.path)
    const gone = await f.index.listSource({ kind: 'collection', id: col.id })
    assert.equal(gone.items.find((i) => i.key === b.key)?.offline, true)
    assert.equal(gone.items.find((i) => i.key === z.key)?.offline, false)
    assert.throws(() =>
      f.index.saveCollection({ name: 'x', kind: 'manual', parent: col.id, rules: null, sort: 0 })
    )
  } finally {
    f.done()
  }
})

test('smart collections and sets list what their rules and children say', async () => {
  const f = fixture(['a.jpg', 'b.CR2', 'c.jpg'])
  try {
    const [a, b, c] = await f.index.listFolder(f.folder)
    f.index.setMeta([a.key], { rating: 4 })
    f.index.setMeta([b.key], { rating: 2, flag: 'pick' })
    const picked = f.index.saveCollection({
      name: 'Picked',
      kind: 'manual',
      parent: null,
      rules: null,
      sort: 0
    })
    f.index.collectionItems(picked.id, [c.key], 'add')
    const set = f.index.saveCollection({
      name: 'All',
      kind: 'set',
      parent: null,
      rules: null,
      sort: 0
    })
    // Rated 3+, or (RAW and picked), or in "Picked".
    const smart = f.index.saveCollection({
      name: 'Good',
      kind: 'smart',
      parent: set.id,
      sort: 0,
      rules: {
        match: 'any',
        rules: [
          { field: 'rating', op: 'gte', value: 3 },
          {
            match: 'all',
            rules: [
              { field: 'kind', op: 'is', value: 'raw' },
              { field: 'flag', op: 'is', value: 'pick' }
            ]
          },
          { field: 'collection', op: 'is', value: picked.id }
        ]
      }
    })
    const keys = async (id: string): Promise<string[]> =>
      (await f.index.listSource({ kind: 'collection', id })).items.map((i) => i.key)
    assert.deepEqual(await keys(smart.id), [a.key, b.key, c.key])
    f.index.setMeta([b.key], { flag: null })
    assert.deepEqual(await keys(smart.id), [a.key, c.key], 'rules are evaluated when listed')
    assert.deepEqual(await keys(set.id), [a.key, c.key], 'a set is its children')
    const counts = Object.fromEntries(f.index.collections().map((x) => [x.name, x.count]))
    assert.deepEqual(counts, { All: 2, Good: 2, Picked: 1 })

    // A set cannot sit inside itself, even through a child.
    const inner = f.index.saveCollection({
      name: 'Inner',
      kind: 'set',
      parent: set.id,
      rules: null,
      sort: 0
    })
    assert.throws(() => f.index.saveCollection({ ...set, parent: inner.id }))
    assert.throws(() => f.index.saveCollection({ ...picked, kind: 'smart' }), /change kind/)
    f.index.removeCollection(set.id)
    const rest = f.index.collections()
    assert.equal(rest.find((x) => x.id === smart.id)?.parent, null, 'children move to the top')
  } finally {
    f.done()
  }
})

test('stacks live in the sidecar and survive a lost index', async () => {
  const f = fixture(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
  try {
    const [a, b, c, d] = await f.index.listFolder(f.folder)
    const copy = f.index.createCopy(c.key)
    const made = f.index.stack([a.key, b.key, c.key], c.key)
    assert.deepEqual(
      made.map((i) => [i.key, i.stack?.position, i.stack?.size]),
      [
        [a.key, 1, 3],
        [b.key, 2, 3],
        [c.key, 0, 3],
        [copy.key, 0, 3]
      ]
    )
    // a's is in its sidecar; c has a virtual copy, so its truth is its project
    // (read by another connection: what the index gathered is committed first).
    f.index.flushProjects()
    assert.equal(JSON.parse(readFileSync(a.path + '.playroom.json', 'utf8')).stack.position, 1)
    const project = PixlFile.open(f.index.projectPath(c.key)!)
    assert.equal(project.read(false).stack?.position, 0)
    project.close()

    // A fresh index reads the stacks back from the sidecars.
    const other = f.reopen()
    const again = await other.listFolder(f.folder)
    assert.deepEqual(
      again.map((i) => [i.name, i.stack?.position ?? null, i.stack?.size ?? null]),
      [
        ['a.jpg', 1, 3],
        ['b.jpg', 2, 3],
        ['c.jpg', 0, 3],
        ['c.jpg', 0, 3],
        ['d.jpg', null, null]
      ]
    )

    // b on top; c and a keep their order under it.
    f.index.stackTop(b.key)
    assert.deepEqual(
      f.index.items(f.folder).map((i) => i.stack?.position ?? null),
      [2, 0, 1, 1, null]
    )
    // a leaves for a new stack with d; b and c stay a stack of two.
    f.index.stack([d.key, a.key], d.key)
    assert.deepEqual(
      f.index.items(f.folder).map((i) => i.stack?.position ?? null),
      [1, 0, 1, 1, 0]
    )
    // Taking b out as well leaves a and c alone: no stacks.
    f.index.stack([d.key, b.key], d.key)
    assert.deepEqual(
      f.index.items(f.folder).map((i) => i.stack?.position ?? null),
      [null, 1, null, null, 0]
    )
    const unstacked = f.index.unstack([b.key])
    assert.equal(unstacked.length, 2)
    assert.ok(f.index.items(f.folder).every((i) => i.stack === null))
    assert.equal(existsSync(a.path + '.playroom.json'), false, 'a sidecar with nothing to say goes')
  } finally {
    f.done()
  }
})

test('autoStack groups bursts by capture time', async () => {
  const f = fixture(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'])
  try {
    const items = await f.index.listFolder(f.folder)
    await settle()
    const store = storeOf(f.index)
    const base = Date.UTC(2026, 8, 1, 12, 0, 0)
    // a b c 2 s apart; d 10 s later; e f 1 s apart; f has no time.
    const at = [0, 2, 4, 14, 20, 21]
    items.forEach((it, i) => {
      store.setCamera(it.photoId, {
        make: null,
        model: null,
        lens: null,
        iso: null,
        exposureTime: null,
        fNumber: null,
        focalLength: null,
        capturedAt: i === 5 ? null : new Date(base + at[i] * 1000).toISOString(),
        gps: null
      })
    })
    assert.equal(f.index.autoStack(f.folder, 3), 1)
    assert.deepEqual(
      f.index.items(f.folder).map((i) => i.stack?.position ?? null),
      [0, 1, 2, null, null, null]
    )
    assert.equal(f.index.autoStack(f.folder, 10), 1, 'd and e now, the stacked ones are left alone')
  } finally {
    f.done()
  }
})

test('forgetting a missing photo cleans its keywords and collection places', async () => {
  const f = fixture()
  try {
    const [a] = await f.index.listFolder(f.folder)
    await f.index.setMetadata([a.key], { keywords: ['Gone'] })
    const col = f.index.saveCollection({
      name: 'C',
      kind: 'manual',
      parent: null,
      rules: null,
      sort: 0
    })
    f.index.collectionItems(col.id, [a.key], 'add')
    unlinkSync(a.path)
    await f.index.rescan(f.folder)
    assert.deepEqual(f.index.keywordTree(), [])
    assert.equal(f.index.collections()[0].count, 0)
    assert.equal(storeOf(f.index).collectionItems(col.id).length, 0)
  } finally {
    f.done()
  }
})

test('collections export by path and import into another index (and again, with new ids)', async () => {
  const f = fixture()
  try {
    const [a, b] = await f.index.listFolder(f.folder)
    const copy = f.index.createCopy(b.key)
    const set = f.index.saveCollection({
      name: 'Set',
      kind: 'set',
      parent: null,
      rules: null,
      sort: 0
    })
    const man = f.index.saveCollection({
      name: 'Man',
      kind: 'manual',
      parent: set.id,
      rules: null,
      sort: 0
    })
    f.index.collectionItems(man.id, [a.key, copy.key], 'add')
    const smart = f.index.saveCollection({
      name: 'Smart',
      kind: 'smart',
      parent: set.id,
      sort: 1,
      rules: { match: 'all', rules: [{ field: 'collection', op: 'is', value: man.id }] }
    })
    const file = JSON.parse(JSON.stringify(f.index.exportCollections([set.id])))
    assert.equal(file.collections.length, 3, 'a set brings its children')
    assert.deepEqual(file.collections.find((c: { id: string }) => c.id === man.id).items, [
      { path: a.path, copyId: null },
      { path: b.path, copyId: copy.copyId }
    ])

    // Another index has never seen the folder: importing indexes it.
    const other = f.reopen()
    const added = await other.importCollections(file)
    assert.deepEqual(added.map((c) => c.id).sort(), [set.id, man.id, smart.id].sort())
    const listed = await other.listSource({ kind: 'collection', id: smart.id })
    assert.deepEqual(
      listed.items.map((i) => [i.name, i.copyName]),
      [
        ['a.jpg', null],
        ['b.CR2', 'Copy 1']
      ]
    )

    // Into the same index: every id is taken, so all are new and still linked.
    const twice = await f.index.importCollections(file)
    const newMan = twice.find((c) => c.name === 'Man')
    const newSmart = twice.find((c) => c.name === 'Smart')
    const newSet = twice.find((c) => c.name === 'Set')
    assert.ok(newMan && newSmart && newSet)
    assert.notEqual(newMan.id, man.id)
    assert.equal(newMan.parent, newSet.id)
    assert.deepEqual(newSmart.rules?.rules[0], { field: 'collection', op: 'is', value: newMan.id })
    await assert.rejects(f.index.importCollections({ app: 'other' }))
  } finally {
    f.done()
  }
})

test('duplicates: exact by content, near by picture hash, exact groups first', async () => {
  const f = fixture(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'])
  try {
    // a and b the same bytes; c the same size, other bytes; d and e differ.
    writeFileSync(join(f.folder, 'c.jpg'), 'NOT really a photo')
    writeFileSync(join(f.folder, 'd.jpg'), 'a picture near e')
    writeFileSync(join(f.folder, 'e.jpg'), 'the other one')
    const [a, b, c, d, e] = await f.index.listFolder(f.folder)
    const work = f.index.dhashWork(f.folder)
    assert.equal(work.length, 5)
    assert.ok(
      work.every((w) => w.thumbPath === null),
      'no thumbnails yet'
    )
    const hashes: Record<string, string> = {
      [a.key]: 'f000000000000000',
      [b.key]: 'f000000000000000',
      [c.key]: 'ffffffffffffffff',
      [d.key]: '00000000000000ff',
      [e.key]: '000000000000000f'
    }
    for (const it of [a, b, c, d, e]) {
      const thumb = join(f.root, `${it.photoId}.jpg`)
      writeFileSync(thumb, 'jpeg')
      f.index.setThumb(it.photoId, null, thumb, 'stamp-1')
      f.index.setDhash(it.photoId, hashes[it.key], 'stamp-1')
    }
    assert.equal(f.index.dhashWork(f.folder).length, 0)

    const listing = await f.index.listSource({ kind: 'duplicates', folder: f.folder, threshold: 4 })
    assert.deepEqual(listing.groups, [
      { kind: 'exact', keys: [a.key, b.key] },
      { kind: 'near', keys: [d.key, e.key], distance: 4 }
    ])
    assert.deepEqual(
      listing.items.map((i) => i.key),
      [a.key, b.key, d.key, e.key]
    )
    // Wider: a stands in for its exact group among the near ones (b, identical, does not).
    const wide = await f.index.duplicates(null, 8)
    assert.deepEqual(wide.groups?.[1], { kind: 'near', keys: [a.key, d.key, e.key], distance: 12 })
    // A new thumbnail makes the hash stale.
    f.index.setThumb(a.photoId, null, join(f.root, `${a.photoId}.jpg`), 'stamp-2')
    assert.deepEqual(
      f.index.dhashWork(f.folder).map((w) => w.photoId),
      [a.photoId]
    )
  } finally {
    f.done()
  }
})

test('resolvePaths: the first file’s folder and each file’s key; a folder alone', async () => {
  const f = fixture()
  try {
    const other = join(f.root, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'z.jpg'), 'elsewhere')
    const r = await f.index.resolvePaths([
      join(f.folder, 'b.CR2'),
      join(other, 'z.jpg'),
      join(f.folder, 'notes.txt')
    ])
    assert.equal(r.folder, f.folder)
    assert.equal(r.keys.length, 2)
    assert.deepEqual(
      f.index.itemsFor(r.keys).map((i) => i?.name),
      ['b.CR2', 'z.jpg']
    )
    assert.deepEqual(await f.index.resolvePaths([other]), { folder: other, keys: [] })
    assert.deepEqual(await f.index.resolvePaths([]), { folder: null, keys: [] })
  } finally {
    f.done()
  }
})
