import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync
} from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import {
  isBareName,
  isBlobHash,
  isPlaneHash,
  isPlainExt,
  isSafeId,
  safeIdOf
} from '../src/shared/ids'
import { cacheFile, isDevicePath, isSafeLocalPath, isUncPath, within } from '../src/main/contain'
import { NotAProject, PixlFile, validOrigin, type Origin } from '../src/main/project/pixlfile'
import { IndexService } from '../src/main/indexer/service'
import type { XmpIo } from '../src/main/indexer/xmp'
import { defaultRecipe, normaliseRecipe, type Recipe } from '../src/shared/recipe'
import {
  compile,
  customFiles,
  CUSTOM_FILE_NOTE,
  LUT_MISSING_NOTE,
  lutNamesOf,
  type CompileContext
} from '../src/shared/compile'
import { LUT_MAX_BYTES, lutFileIn, lutsFor } from '../src/main/lutfile'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pixl-sec-'))
const HASH = 'a'.repeat(64)
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

const noXmp: XmpIo = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
  end: () => Promise.resolve()
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300))

const origin = (dir: string, patch: Partial<Origin> = {}): Origin => ({
  name: 'a.jpg',
  ext: 'jpg',
  size: 10,
  mtime: 1,
  path: join(dir, 'a.jpg'),
  isRaw: false,
  sha1: null,
  ...patch
})

// ── names ──

test('hashes, ids, extensions and bare names are told from anything else', () => {
  assert.ok(isPlaneHash(HASH))
  assert.ok(isBlobHash(sha('x')))
  for (const bad of ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}/`, '../x', '', 7, null])
    assert.equal(isPlaneHash(bad), false, String(bad))
  assert.ok(isSafeId('k3j2h1abc-_Z'))
  for (const bad of ['', '../x', 'a/b', 'a\\b', 'x'.repeat(65), 'a b', 5])
    assert.equal(isSafeId(bad), false)
  // A bad id becomes the same safe one every time it is read.
  assert.equal(safeIdOf('ok_id'), 'ok_id')
  assert.equal(safeIdOf('../../evil'), safeIdOf('../../evil'))
  assert.ok(isSafeId(safeIdOf('../../evil')))
  assert.notEqual(safeIdOf('../../evil'), safeIdOf('../../other'))
  assert.equal(safeIdOf(''), null)
  assert.equal(safeIdOf(3), null)
  assert.ok(isPlainExt('cr2'))
  for (const bad of ['CR2', 'x/../y', '', 'toolong', '.jpg']) assert.equal(isPlainExt(bad), false)
  assert.ok(isBareName('IMG_1.CR2'))
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a\0b']) assert.equal(isBareName(bad), false)
})

test('a cache file stays in its folder', () => {
  const dir = tmp()
  assert.equal(cacheFile(dir, 'original-abc.jpg'), join(resolve(dir), 'original-abc.jpg'))
  for (const bad of ['../x', 'x/../../y', 'a/b.png', '..', '.', 'a\\b', 'x\0'])
    assert.throws(() => cacheFile(dir, bad), /outside/, bad)
  assert.ok(within(dir, join(dir, 'a', 'b')))
  assert.ok(!within(dir, join(dir, '..', 'x')))
  assert.ok(!within(join(dir, 'a'), join(dir, 'ab')))
  rmSync(dir, { recursive: true })
})

test('a path a file names: never a device, a share only inside the library, always absolute', () => {
  for (const dev of ['\\\\.\\PhysicalDrive0', '\\\\?\\C:\\x', '//./pipe/x', '//?/x']) {
    assert.ok(isDevicePath(dev), dev)
    assert.equal(isSafeLocalPath(dev), false, dev)
  }
  assert.ok(isUncPath('\\\\attacker.example\\s\\a.cube'))
  assert.ok(isUncPath('//attacker.example/s/a.cube'))
  assert.equal(isSafeLocalPath('\\\\attacker.example\\s\\a.jpg'), false)
  // A NAS library: a share the user added is looked at, one beside it is not.
  const nas = ['\\\\nas\\Photos\\2026']
  assert.ok(isSafeLocalPath('\\\\nas\\Photos\\2026\\Trip\\a.CR2', nas))
  assert.ok(isSafeLocalPath('\\\\NAS\\photos\\2026', nas))
  assert.equal(isSafeLocalPath('\\\\nas\\Photos\\2026-other\\a.CR2', nas), false)
  assert.equal(isSafeLocalPath('\\\\evil\\Photos\\2026\\a.CR2', nas), false)
  assert.ok(isSafeLocalPath('/Users/me/Pictures/a.jpg'))
  assert.ok(isSafeLocalPath('C:\\Users\\me\\a.jpg'))
  for (const bad of ['relative/a.jpg', '', '/a\0b', 7, null])
    assert.equal(isSafeLocalPath(bad), false)
})

// ── SEC-1: a crafted project ──

/** A project made as Playroom makes it, then edited by hand as an attacker would. */
function craft(path: string, at: string, sql: (db: DatabaseSync) => void): void {
  PixlFile.create(path, origin(at)).close()
  const db = new DatabaseSync(path)
  sql(db)
  db.close()
}

test('an origin no Playroom wrote makes the file not a project', () => {
  const dir = tmp()
  assert.ok(validOrigin(origin(dir)))
  assert.ok(
    validOrigin(origin(dir, { path: '\\\\nas\\Photos\\a.jpg' })),
    'a NAS library is fine here'
  )
  for (const bad of [
    { ext: 'x/../../../../.zshenv' },
    { ext: 'JPG' },
    { ext: 'exe' },
    { name: '../a.jpg' },
    { name: 'sub/a.jpg' },
    // A backslash is a separator on Windows; a macOS name may hold one.
    ...(process.platform === 'win32' ? [{ name: 'sub\\a.jpg' }] : []),
    { name: '..' },
    { path: 'relative/a.jpg' },
    { path: '\\\\.\\PhysicalDrive0' }
  ] as Partial<Origin>[])
    assert.equal(validOrigin(origin(dir, bad)), false, JSON.stringify(bad))
  // Playroom never writes one either.
  assert.throws(() => PixlFile.create(join(dir, 'b.pixl'), origin(dir, { ext: '../x' })))
  assert.equal(existsSync(join(dir, 'b.pixl')), false)

  const path = join(dir, 'IMG_1.pixl')
  craft(path, dir, (db) => db.prepare("UPDATE origin SET ext = 'x/../../../../.zshenv'").run())
  assert.throws(
    () => PixlFile.open(path),
    (e: Error) => e instanceof NotAProject
  )
  assert.equal(PixlFile.peekOrigin(path), null)
  rmSync(dir, { recursive: true })
})

test('a crafted project in a folder writes nothing outside the cache', async () => {
  const root = tmp()
  const folder = join(root, 'photos')
  const home = join(root, 'home')
  mkdirSync(folder)
  mkdirSync(home)
  const script = Buffer.from('echo owned\n')
  const hash = sha(script)
  // The attack the audit found: an orphan project whose origin's extension
  // climbs out of the cache, carrying a "verbatim original" that is a script.
  craft(join(folder, 'IMG_1.pixl'), folder, (db) => {
    db.prepare('UPDATE origin SET ext = ?').run(`x/../../../../../../../home/.zshenv`)
    db.prepare(
      "INSERT INTO blobs(hash, kind, codec, bytes, created_at) VALUES (?, 'original', 'jpg', ?, '')"
    ).run(hash, script.length)
    db.prepare('INSERT INTO blob_chunks(hash, idx, data) VALUES (?, 0, ?)').run(hash, script)
    db.prepare(
      "INSERT INTO original(id, kind, blob, state, note) VALUES (1, 'verbatim', ?, 'ready', NULL)"
    ).run(hash)
  })
  // And one whose original's name is not a hash.
  craft(join(folder, 'IMG_2.pixl'), folder, (db) => {
    db.prepare("UPDATE origin SET name = 'IMG_2.jpg'").run()
    db.prepare(
      "INSERT INTO blobs(hash, kind, codec, bytes, created_at) VALUES ('../../../../x', 'original', 'jpg', 1, '')"
    ).run()
    db.prepare("INSERT INTO blob_chunks(hash, idx, data) VALUES ('../../../../x', 0, X'41')").run()
    db.prepare(
      "INSERT INTO original(id, kind, blob, state, note) VALUES (1, 'verbatim', '../../../../x', 'ready', NULL)"
    ).run()
  })
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  try {
    const items = await index.listFolder(folder)
    assert.deepEqual(
      items.map((i) => i.name),
      ['IMG_2.jpg'],
      'the crafted origin is not a project; the other stands in for its photo'
    )
    const row = index.sourceRow(items[0].key)
    assert.equal(row.embedded, null, 'an original not named by its hash is never written out')
    assert.deepEqual(readdirSync(home), [])
    assert.equal(existsSync(join(root, 'x')), false)
  } finally {
    await settle()
    index.close()
    rmSync(root, { recursive: true })
  }
})

test('a blob is written out only under its own hash, and only when its bytes are that hash', () => {
  const dir = tmp()
  const path = join(dir, 'a.pixl')
  const good = Buffer.from('the original bytes')
  craft(path, dir, (db) => {
    const add = (h: string, b: Buffer): void => {
      db.prepare(
        "INSERT INTO blobs(hash, kind, codec, bytes, created_at) VALUES (?, 'original', 'jpg', ?, '')"
      ).run(h, b.length)
      db.prepare('INSERT INTO blob_chunks(hash, idx, data) VALUES (?, 0, ?)').run(h, b)
    }
    add(sha(good), good)
    // Filed under a hash its bytes are not.
    add(HASH, Buffer.from('something else'))
  })
  const p = PixlFile.open(path)
  try {
    assert.equal(p.writeBlobTo(sha(good), join(dir, 'good.jpg')), true)
    assert.equal(p.writeBlobTo(HASH, join(dir, 'liar.jpg')), false)
    assert.equal(p.writeBlobTo('../x', join(dir, 'x.jpg')), false)
    assert.deepEqual(readdirSync(dir).sort(), ['a.pixl', 'good.jpg'])
  } finally {
    p.close()
    rmSync(dir, { recursive: true })
  }
})

// ── SEC-2: names in a recipe ──

test('a recipe’s ids and plane references are kept only when they are safe names', () => {
  const r = JSON.parse(JSON.stringify(defaultRecipe(false))) as Record<string, unknown>
  const comp = (patch: Record<string, unknown>): Record<string, unknown> => ({
    id: 'c1',
    kind: 'brush',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: 4,
    height: 4,
    png: '',
    ...patch
  })
  r.layers = [
    {
      id: '../../../Documents/secret',
      name: 'Mask',
      components: [
        comp({ id: 'a/b', ref: HASH }),
        comp({ id: 'c2', ref: '../../Documents/secret', png: 'UE5H' }),
        comp({ id: 'c3', ref: '../../Documents/secret' }),
        comp({ id: 'c4', kind: 'depth', ref: 'not-a-hash' }),
        comp({ id: 'c5', kind: 'depth', ref: HASH })
      ]
    }
  ]
  r.pointColors = [{ id: 'x/../y', hue: 10 }]
  const once = normaliseRecipe(r, false)
  const again = normaliseRecipe(r, false)
  const l = once.layers[0]
  assert.ok(isSafeId(l.id))
  assert.equal(l.id, again.layers[0].id, 'the same safe id every time it is read')
  assert.ok(isSafeId(once.pointColors[0].id))
  assert.deepEqual(
    l.components.map((c) => [c.id, 'ref' in c ? (c.ref ?? null) : null]),
    [
      [safeIdOf('a/b'), HASH],
      // Named again from its PNG when it is stored or drawn.
      ['c2', null],
      // c3 and c4: no plane to name, so no plane.
      ['c5', HASH]
    ]
  )
})

// ── SEC-3: LUTs and files in a recipe ──

test('a LUT is read only from Playroom’s LUT folder, by its name', async () => {
  const luts = tmp()
  writeFileSync(join(luts, 'Film.cube'), 'LUT_3D_SIZE 2\n')
  mkdirSync(join(luts, 'Dir.cube'))
  writeFileSync(join(luts, 'Huge.cube'), '')
  truncateSync(join(luts, 'Huge.cube'), LUT_MAX_BYTES + 1)
  writeFileSync(join(luts, 'Empty.cube'), '')
  const film = join(resolve(luts), 'Film.cube')
  // A path from another computer finds the LUT of that name here.
  assert.equal(await lutFileIn(luts, '/Users/someone/Library/luts/Film.cube'), film)
  assert.equal(await lutFileIn(luts, 'C:\\Users\\x\\luts\\Film.cube'), film)
  assert.equal(await lutFileIn(luts, '\\\\attacker.example\\s\\Film.cube'), film)
  for (const bad of [
    '/dev/zero',
    '\\\\attacker.example\\s\\a.cube',
    '../Film.cube/..',
    '/x/Dir.cube',
    '/x/Huge.cube',
    '/x/Empty.cube',
    '/x/Gone.cube',
    ''
  ])
    assert.equal(await lutFileIn(luts, bad), null, bad)
  rmSync(luts, { recursive: true })
})

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 600,
  frameHeight: 400,
  scale: 1,
  seed: 1,
  brushPaths: {},
  applyCrop: true
}

const lutOps = (c: ReturnType<typeof compile>): unknown[] =>
  JSON.stringify(c.grade).match(/"Lut":\{"lut":\{"Path":"[^"]*"\}/g) ?? []

test('a recipe’s LUT reaches the engine only as the file main found', async () => {
  const luts = tmp()
  writeFileSync(join(luts, 'Film.cube'), 'LUT_3D_SIZE 2\n')
  const r: Recipe = defaultRecipe(false)
  r.profile = { kind: 'lut', name: 'Film', path: '\\\\attacker.example\\s\\Film.cube' }
  r.custom = [
    {
      id: 'k1',
      name: 'Advanced',
      enabled: true,
      layer: {
        name: 'x',
        enabled: true,
        opacity: 1,
        mask: null,
        blend: { mode: 'Normal', space: 'LinearWorking' },
        stages: [
          {
            space: 'LinearWorking',
            ops: [{ Lut: { lut: { Path: '/dev/zero' }, amount: 1, out_of_domain: 'Clamp' } }]
          }
        ]
      }
    } as unknown as Recipe['custom'][number]
  ]
  assert.deepEqual(lutNamesOf(r), ['\\\\attacker.example\\s\\Film.cube', '/dev/zero'])
  const found = await lutsFor(r, luts)
  assert.deepEqual(found, {
    '\\\\attacker.example\\s\\Film.cube': join(resolve(luts), 'Film.cube')
  })
  const c = compile(r, { ...ctx, luts: found })
  assert.deepEqual(lutOps(c), [
    `"Lut":{"lut":{"Path":${JSON.stringify(join(resolve(luts), 'Film.cube'))}}`
  ])
  assert.ok(c.notes.includes(CUSTOM_FILE_NOTE), 'the custom layer naming /dev/zero is left out')
  // Without it found: no LUT at all, and the render says so.
  const none = compile(r, ctx)
  assert.deepEqual(lutOps(none), [])
  assert.ok(none.notes.includes(LUT_MISSING_NOTE))
  rmSync(luts, { recursive: true })
})

test('an Advanced layer that reads a raster from a file is left out', () => {
  const layer = (source: unknown): unknown => ({
    stages: [],
    mask: { Raster: { source, resampler: 'Bilinear' } }
  })
  assert.equal(customFiles(layer({ Png: '\\\\attacker.example\\s\\m.png' }), {}), null)
  assert.equal(customFiles(layer({ Tiff: '/etc/x.tif' }), {}), null)
  assert.deepEqual(customFiles(layer({ PngBytes: [1, 2] }), {}), layer({ PngBytes: [1, 2] }))
  assert.deepEqual(
    customFiles(
      { ops: [{ Lut: { lut: { Path: 'a.cube' }, amount: 1 } }] },
      { 'a.cube': '/l/a.cube' }
    ),
    { ops: [{ Lut: { lut: { Path: '/l/a.cube' }, amount: 1 } }] }
  )
  assert.deepEqual(customFiles({ ops: [{ Lut: { lut: { Cube: 'x' } } }] }, {}), {
    ops: [{ Lut: { lut: { Cube: 'x' } } }]
  })
})

// ── SEC-3: folders a file names ──

test('a project naming a folder the library never opened is looked in only once allowed', async () => {
  const root = tmp()
  const elsewhere = join(root, 'elsewhere')
  const shared = join(root, 'shared')
  mkdirSync(elsewhere)
  mkdirSync(shared)
  writeFileSync(join(elsewhere, 'a.jpg'), 'a photo')
  const project = join(shared, 'a.pixl')
  PixlFile.create(project, origin(elsewhere, { size: 7 })).close()
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  try {
    assert.deepEqual(index.foldersToAsk([project]), [elsewhere])
    const declined = await index.resolvePaths([project])
    assert.equal(declined.folder, shared, 'declined: only the project’s own folder')
    assert.equal(index.items(elsewhere).length, 0, 'the named folder was not scanned')
    const allowed = await index.resolvePaths([project], [elsewhere])
    assert.equal(allowed.folder, elsewhere)
    // Once the library knows it, nothing more to ask.
    assert.deepEqual(index.foldersToAsk([project]), [])
  } finally {
    await settle()
    index.close()
    rmSync(root, { recursive: true })
  }
})

test('a collections file naming a share or a device scans nothing there', async () => {
  const root = tmp()
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  try {
    const file = {
      app: 'pixl-playroom',
      kind: 'collections',
      collections: [
        {
          id: 'c',
          kind: 'manual',
          name: 'C',
          items: [
            { path: '\\\\attacker.example\\s\\a.jpg' },
            { path: '\\\\.\\PhysicalDrive0' },
            { path: 'relative/a.jpg' },
            { path: join(root, 'nowhere', 'a.jpg') }
          ]
        }
      ]
    }
    assert.deepEqual(index.collectionFoldersToAsk(file), [])
    const added = await index.importCollections(file, [dirname('\\\\attacker.example\\s\\a.jpg')])
    assert.equal(added.length, 1)
  } finally {
    await settle()
    index.close()
    rmSync(root, { recursive: true })
  }
})
