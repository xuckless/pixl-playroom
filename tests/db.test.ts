import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, Store, migrate } from '../src/main/db'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'playroom-db-'))

const versionOf = (db: DatabaseSync): number =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

const columns = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

test('a fresh index runs every migration', () => {
  const dir = tmp()
  try {
    const file = join(dir, 'playroom.db')
    Store.open(file).close()
    const db = new DatabaseSync(file)
    assert.equal(versionOf(db), MIGRATIONS.length)
    assert.ok(columns(db, 'history').includes('patch'))
    assert.ok(columns(db, 'photos').includes('stack_id'))
    assert.ok(columns(db, 'presets').includes('wb_op'))
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an index from before versioning, already patched, migrates and backfills', () => {
  const dir = tmp()
  try {
    const file = join(dir, 'playroom.db')
    const old = new DatabaseSync(file)
    old.exec(`
CREATE TABLE photos (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, folder TEXT NOT NULL,
  name TEXT NOT NULL, ext TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL,
  is_raw INTEGER NOT NULL, rating INTEGER NOT NULL DEFAULT 0, flag TEXT, label TEXT,
  edited INTEGER NOT NULL DEFAULT 0, camera_json TEXT, thumb_path TEXT, thumb_key TEXT,
  sidecar_mtime REAL);
CREATE TABLE history (item_key TEXT NOT NULL, seq INTEGER NOT NULL, label TEXT NOT NULL,
  at TEXT NOT NULL, recipe TEXT NOT NULL, patch TEXT, hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_key, seq));
CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, grp TEXT NOT NULL,
  groups TEXT NOT NULL, recipe TEXT NOT NULL);`)
    old
      .prepare(
        "INSERT INTO photos (path, folder, name, ext, size, mtime, is_raw, camera_json) VALUES ('/a/x.cr2', '/a', 'x.cr2', 'cr2', 1, 1, 1, ?)"
      )
      .run(
        JSON.stringify({
          make: 'Canon',
          model: 'EOS 80D',
          lens: 'EF-S 18-135',
          iso: 400,
          exposureTime: 0.01,
          fNumber: 5.6,
          focalLength: 35,
          capturedAt: '2026-09-25T10:00:00.000Z',
          gps: null
        })
      )
    old.close()

    Store.open(file).close()
    const db = new DatabaseSync(file)
    assert.equal(versionOf(db), MIGRATIONS.length)
    const row = db
      .prepare('SELECT camera, lens, iso, focal, captured_at FROM photos')
      .get() as Record<string, unknown>
    assert.equal(row.camera, 'Canon EOS 80D')
    assert.equal(row.lens, 'EF-S 18-135')
    assert.equal(row.iso, 400)
    assert.equal(row.focal, 35)
    assert.equal(row.captured_at, '2026-09-25T10:00:00.000Z')
    // Running again is a no-op.
    migrate(db)
    assert.equal(versionOf(db), MIGRATIONS.length)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a preset saved by an older version comes back whole', async () => {
  const { compile } = await import('../src/shared/compile')
  const { defaultRecipe } = await import('../src/shared/recipe')
  const dir = tmp()
  const store = Store.open(join(dir, 'playroom.db'))
  try {
    // Saved before colour grading had `add` and effects had `wash`.
    const old = JSON.parse(JSON.stringify(defaultRecipe(false))) as Record<string, unknown>
    delete (old.colorGrade as Record<string, unknown>).add
    delete (old.effects as Record<string, unknown>).wash
    store.savePreset({
      id: 'p1',
      name: 'Old',
      group: 'User presets',
      builtin: false,
      groups: ['colorGrade', 'effects', 'gone' as never],
      recipe: old as never
    })
    const [p] = store.presets()
    assert.deepEqual(p.groups, ['colorGrade', 'effects'])
    assert.ok('add' in p.recipe.colorGrade && 'wash' in p.recipe.effects)
    compile(p.recipe, {
      isRaw: false,
      asShot: null,
      sourceOrientation: 'Normal',
      frameWidth: 600,
      frameHeight: 400,
      scale: 1,
      seed: 1,
      brushPaths: {},
      applyCrop: true
    })
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a preset keeps its smart instructions; a bad column loses only those', async () => {
  const { defaultRecipe } = await import('../src/shared/recipe')
  const dir = tmp()
  try {
    const file = join(dir, 'playroom.db')
    const store = Store.open(file)
    const smart = {
      masks: [
        {
          id: 'm1',
          name: 'Sky',
          parts: [
            { target: { kind: 'sky' as const }, mode: 'Add' as const },
            { target: { kind: 'subject' as const }, mode: 'Subtract' as const }
          ],
          adjust: { 'basic.exposure': -0.5 }
        }
      ],
      steps: [{ kind: 'denoise' as const, model: 'auto' as const, strength: 40, scope: 'm1' }]
    }
    store.savePreset({
      id: 'p1',
      name: 'Moody',
      group: 'User presets',
      builtin: false,
      groups: ['basicTone'],
      recipe: defaultRecipe(false),
      smart
    })
    store.savePreset({
      id: 'p2',
      name: 'Plain',
      group: 'User presets',
      builtin: false,
      groups: ['basicTone'],
      recipe: defaultRecipe(false)
    })
    const [moody, plain] = store.presets()
    assert.deepEqual(moody.smart, smart)
    assert.equal(plain.smart, undefined)
    store.close()
    const db = new DatabaseSync(file)
    assert.ok(columns(db, 'presets').includes('smart'))
    db.prepare('UPDATE presets SET smart = \'{"masks":[{"parts":[]}]}\' WHERE id = \'p1\'').run()
    db.close()
    const again = Store.open(file)
    const [broken] = again.presets()
    assert.equal(broken.name, 'Moody')
    assert.equal(broken.smart, undefined)
    again.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
