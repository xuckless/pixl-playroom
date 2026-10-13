// scripts/engine-dev.mjs: an engine development kit laid over the installed
// packages and taken off again. A kit is refused by name (no kit.json,
// another schema, another engine version, no addon for this computer);
// only what kit.json lists is installed; pnpm's hard-linked store is never
// written through; install → restore is byte for byte.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  checkKit,
  install,
  installedPackages,
  installPlan,
  KitError,
  kitDirOf,
  MARKER,
  parseArgs,
  readKit,
  restore,
  status
  // @ts-expect-error: a plain .mjs module, no types
} from '../scripts/engine-dev.mjs'

const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

/** Every file under `dir`, by relative path, with its bytes' hash. */
function snapshot(dir: string, under = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of readdirSync(join(dir, under), { withFileTypes: true })) {
    const rel = under ? `${under}/${e.name}` : e.name
    if (e.isDirectory()) Object.assign(out, snapshot(dir, rel))
    else out[rel] = sha(readFileSync(join(dir, rel)))
  }
  return out
}

/** A small kit: an addon for `plat`, the models package's files, one model's weights. */
function fakeKit(root: string, plat: string, version = '0.19.2'): string {
  const kit = join(root, 'kit')
  const files: Record<string, string> = {
    [`engine/${plat}/pixl-engine.${plat}.node`]: 'the kit’s addon',
    [`engine/${plat}/libpixl_libraw.dylib`]: 'the kit’s libraw',
    'pixl-models/roster.json': '{"models":["released","pixl-demosaic-bayer"]}',
    'pixl-models/index.js': 'module.exports = "the same in both"',
    'pixl-models/index.d.ts': 'export declare const kit: true',
    'pixl-models/package.json': '{"name":"@xuckless/pixl-models","version":"0.19.2"}',
    'pixl-models/README.md': 'the kit’s readme',
    'pixl-models/licences/demosaicnet.txt': 'MIT',
    'pixl-models/licences/pixl-dev.txt': 'not released',
    'models/pixl-demosaic-bayer/0.1.0-dev.1/pixl_demosaic_bayer.onnx': 'weights'
  }
  for (const [rel, text] of Object.entries(files)) put(kit, rel, text)
  // What browsing the folder on a Mac leaves: not the kit's, never installed.
  put(kit, '.DS_Store', 'finder')
  put(kit, `engine/${plat}/.DS_Store`, 'finder')
  put(kit, 'pixl-models/licences/.DS_Store', 'finder')
  put(kit, `engine/${plat}/notes.txt`, 'left by hand')
  writeFileSync(
    join(kit, 'kit.json'),
    JSON.stringify({
      schema: 1,
      made: '2026-10-13T18:43:29.954Z',
      engine: { commit: '9e368c379efb', version, platforms: [plat] },
      models: [
        { id: 'pixl-demosaic-bayer', version: '0.1.0-dev.1', files: ['pixl_demosaic_bayer.onnx'] }
      ],
      files: Object.fromEntries(
        Object.entries(files).map(([rel, text]) => [
          rel,
          { bytes: Buffer.byteLength(text), sha256: sha(text) }
        ])
      )
    })
  )
  return kit
}

/**
 * An app checkout as pnpm lays it out: each package's files hard-linked from
 * a store, the package itself a symlink into `node_modules/.pnpm`.
 */
function fakeApp(root: string): { app: string; store: string } {
  const app = join(root, 'app')
  const store = join(root, 'store')
  put(app, 'package.json', '{"name":"pixl-playroom","scripts":{"dev":"electron-vite dev"}}')
  const packages: Record<string, Record<string, string>> = {
    'pixl-engine': {
      'package.json': '{"name":"@xuckless/pixl-engine","version":"0.19.2"}',
      'index.js': 'the loader',
      'lib.js': 'the entry'
    },
    'pixl-models': {
      'package.json': '{"name":"@xuckless/pixl-models","version":"0.19.2"}',
      'roster.json': '{"models":["released"]}',
      'index.js': 'module.exports = "the same in both"',
      'index.d.ts': 'export declare const released: true',
      'README.md': 'the released readme',
      'licences/demosaicnet.txt': 'MIT'
    }
  }
  mkdirSync(join(app, 'node_modules/@xuckless'), { recursive: true })
  for (const [name, files] of Object.entries(packages)) {
    const real = join(
      app,
      `node_modules/.pnpm/@xuckless+${name}@0.19.2/node_modules/@xuckless/${name}`
    )
    for (const [rel, text] of Object.entries(files)) {
      put(store, `${name}/${rel}`, text)
      mkdirSync(dirname(join(real, rel)), { recursive: true })
      linkSync(join(store, `${name}/${rel}`), join(real, rel))
    }
    symlinkSync(real, join(app, 'node_modules/@xuckless', name), 'dir')
  }
  return { app, store }
}

const scratch = (): string => mkdtempSync(join(tmpdir(), 'playroom-engine-dev-'))

test('the kit’s folder: --kit, else PLAYROOM_DEV_KIT, else ~/Public/pixl-weights', () => {
  assert.equal(kitDirOf('/a/kit', { PLAYROOM_DEV_KIT: '/b' }, '/home/x'), '/a/kit')
  assert.equal(kitDirOf(null, { PLAYROOM_DEV_KIT: '/b' }, '/home/x'), '/b')
  assert.equal(kitDirOf(null, {}, '/home/x'), '/home/x/Public/pixl-weights')
})

test('the script’s flags, then the dev script’s arguments as they came', () => {
  assert.equal(parseArgs([]).action, 'install')
  assert.equal(parseArgs(['--check']).action, 'check')
  assert.equal(parseArgs(['--restore', '--kit', '/k']).kit, '/k')
  // `pnpm dev:kit -- photo.CR2`, whether or not the package manager keeps the `--`.
  assert.deepEqual(parseArgs(['--run', '--', '/p/photo.CR2']).rest, ['--', '/p/photo.CR2'])
  assert.deepEqual(parseArgs(['--run', '/p/photo.CR2']).rest, ['/p/photo.CR2'])
  assert.deepEqual(parseArgs(['--run', '--no-load', '--scale=1.5']).rest, ['--scale=1.5'])
  assert.throws(() => parseArgs(['--check', '--restore']), KitError)
  assert.throws(() => parseArgs(['--kit']), /needs a folder/)
  assert.throws(() => parseArgs(['photo.CR2']), /unknown argument photo\.CR2/)
})

test('a kit is refused by name: none there, another schema, another version, no addon', () => {
  const root = scratch()
  try {
    assert.throws(() => readKit(join(root, 'nowhere')), /no development kit at .*no kit\.json/)
    const kitDir = fakeKit(root, 'darwin-arm64')
    const kit = readKit(kitDir)
    const here = { installedVersion: '0.19.2', platform: 'darwin-arm64' }
    assert.doesNotThrow(() => checkKit(kit, kitDir, here))
    // The package would refuse an addon of another version: said before anything is copied.
    assert.throws(
      () => checkKit(kit, kitDir, { ...here, installedVersion: '0.19.3' }),
      /the kit's engine is 0\.19\.2, but @xuckless\/pixl-engine 0\.19\.3 is installed/
    )
    // Linux, or a Mac the kit was not built on: which platforms it has.
    assert.throws(
      () => checkKit(kit, kitDir, { ...here, platform: 'linux-x64' }),
      /this kit has no addon for linux-x64 \(it has darwin-arm64\)/
    )
    writeFileSync(join(kitDir, 'kit.json'), JSON.stringify({ ...kit, schema: 2 }))
    assert.throws(() => readKit(kitDir), /schema 2; this script reads schema 1/)
    writeFileSync(join(kitDir, 'kit.json'), '{"schema": 1, "eng')
    assert.throws(() => readKit(kitDir), /is not JSON/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('only what kit.json lists is installed: no .DS_Store, no stray file', () => {
  const root = scratch()
  try {
    const kitDir = fakeKit(root, 'darwin-arm64')
    const plan = installPlan(readKit(kitDir), 'darwin-arm64') as { pkg: string; path: string }[]
    assert.deepEqual(
      plan.map((p) => `${p.pkg}:${p.path}`),
      [
        'engine:libpixl_libraw.dylib',
        'engine:pixl-engine.darwin-arm64.node',
        'models:index.d.ts',
        'models:index.js',
        'models:licences/demosaicnet.txt',
        'models:licences/pixl-dev.txt',
        'models:roster.json'
      ]
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('install, check and restore: byte for byte, the store never written through', () => {
  const root = scratch()
  try {
    const plat = 'darwin-arm64'
    const kitDir = fakeKit(root, plat)
    const { app, store } = fakeApp(root)
    const dirs = installedPackages(app)
    assert.equal(dirs.version, '0.19.2')
    // The real directory, not the symlink in node_modules.
    assert.match(dirs.engine, /\.pnpm/)
    const before = { engine: snapshot(dirs.engine), models: snapshot(dirs.models) }
    const storeBefore = snapshot(store)
    const kitBefore = snapshot(kitDir)
    assert.equal(status(dirs).installed, false)

    const marker = install(readKit(kitDir), kitDir, plat, dirs)
    assert.equal(marker.engine.commit, '9e368c379efb')
    assert.equal(marker.kit, kitDir)
    assert.equal(status(dirs).installed, true)
    // The addon sits beside the loader; the roster is the kit's; the released one is kept.
    const addon = join(dirs.engine, `pixl-engine.${plat}.node`)
    assert.equal(readFileSync(addon, 'utf8'), 'the kit’s addon')
    assert.match(readFileSync(join(dirs.models, 'roster.json'), 'utf8'), /pixl-demosaic-bayer/)
    assert.equal(
      readFileSync(join(dirs.models, 'roster.json.released'), 'utf8'),
      '{"models":["released"]}'
    )
    // Not the kit's to install: its package.json, its README, what Finder left.
    assert.match(readFileSync(join(dirs.models, 'README.md'), 'utf8'), /released/)
    assert.equal(existsSync(join(dirs.engine, '.DS_Store')), false)
    assert.equal(existsSync(join(dirs.engine, 'notes.txt')), false)
    assert.equal(existsSync(join(dirs.models, 'licences/.DS_Store')), false)
    // A released file that already is the kit's, byte for byte, is left alone: still the store's.
    const state = (path: string): string =>
      (marker.files as { path: string; state: string }[]).find((f) => f.path === path)!.state
    assert.equal(state('roster.json'), 'replaced')
    assert.equal(state(`pixl-engine.${plat}.node`), 'added')
    assert.equal(state('index.js'), 'same')
    assert.equal(
      statSync(join(dirs.models, 'index.js')).ino,
      statSync(join(store, 'pixl-models/index.js')).ino
    )
    // The kit's copies are new files, and the store holds the released bytes.
    assert.notEqual(
      statSync(join(dirs.models, 'roster.json')).ino,
      statSync(join(store, 'pixl-models/roster.json')).ino
    )
    assert.deepEqual(snapshot(store), storeBefore)
    assert.deepEqual(snapshot(kitDir), kitBefore)

    // Again (every `pnpm dev:kit`): nothing moves, the released copies are not overwritten.
    const again = install(readKit(kitDir), kitDir, plat, dirs)
    assert.deepEqual(
      (again.files as { state: string }[]).map((f) => f.state),
      (marker.files as { state: string }[]).map((f) => f.state)
    )
    assert.equal(
      readFileSync(join(dirs.models, 'roster.json.released'), 'utf8'),
      '{"models":["released"]}'
    )

    // A newer kit over it: its addon replaces the earlier kit's, which is not kept as "released".
    put(kitDir, `engine/${plat}/pixl-engine.${plat}.node`, 'a newer addon')
    put(kitDir, 'pixl-models/index.js', 'module.exports = "the kit’s own now"')
    const kit2 = readKit(kitDir)
    for (const rel of [`engine/${plat}/pixl-engine.${plat}.node`, 'pixl-models/index.js']) {
      const bytes = readFileSync(join(kitDir, rel))
      kit2.files[rel] = { bytes: bytes.length, sha256: sha(bytes) }
    }
    // A file that is not what kit.json names is refused before anything is touched.
    const stale = readKit(kitDir)
    assert.throws(() => install(stale, kitDir, plat, dirs), /pixl-engine\.darwin-arm64\.node is/)
    assert.equal(status(dirs).installed, true)
    install(kit2, kitDir, plat, dirs)
    assert.equal(readFileSync(addon, 'utf8'), 'a newer addon')
    assert.equal(existsSync(`${addon}.released`), false)
    // The file left alone until now is the store's: kept beside, not removed.
    assert.equal(
      readFileSync(join(dirs.models, 'index.js.released'), 'utf8'),
      'module.exports = "the same in both"'
    )
    assert.deepEqual(snapshot(store), storeBefore)

    const r = restore(dirs)
    assert.deepEqual(r, { restored: true, lost: [] })
    assert.equal(existsSync(join(dirs.engine, MARKER)), false)
    assert.deepEqual({ engine: snapshot(dirs.engine), models: snapshot(dirs.models) }, before)
    assert.deepEqual(snapshot(store), storeBefore)
    // The released files are the store's own again, hard-linked as pnpm left them.
    for (const rel of ['roster.json', 'index.js', 'index.d.ts', 'licences/demosaicnet.txt'])
      assert.equal(
        statSync(join(dirs.models, rel)).ino,
        statSync(join(store, `pixl-models/${rel}`)).ino,
        rel
      )
    assert.equal(status(dirs).installed, false)
    assert.deepEqual(restore(dirs), { restored: false, lost: [] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
