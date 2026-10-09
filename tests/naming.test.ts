// Gemma's names (shared/naming.ts): kept from its answer, routed by
// Playroom's own map, found by the Library's search; and kept in the index.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type { PhotoNames } from '../src/shared/naming'
import { item } from './items'

const target = (label: string, subject = false, extra: object = {}): object => ({
  label,
  finder: 'text',
  prompt: label,
  box: null,
  intent: `why ${label}`,
  subject,
  ...extra
})

test('from Gemma’s answer: label, subject and intent only, cleaned, flagged ones dropped', async () => {
  const { namesFromPlan } = await import('../src/shared/naming')
  // Labels as Gemma gave them on the Mac (2026-10-09).
  const plan = {
    describe: 'A woman sits on a sofa by a window.',
    targets: [
      target('Woman', true),
      target("Woman's Shirt"),
      target('Face_Skin'),
      target('main_subject'),
      target('Sofa', true),
      target('Wall Background'),
      target('the Sofa'),
      target('Window/Curtain Area', false, { box: [0.9, 0.1, 0.5, 0.5] })
    ]
  }
  const n = namesFromPlan(plan, [{ path: '/targets/7/box' }], 'gemma-4-e2b-it', 'T')
  assert.deepEqual(
    n.things.map((t) => t.label),
    ['woman', "woman's shirt", 'sofa', 'wall background'],
    'finder names, a repeat and the flagged target dropped'
  )
  assert.equal(n.things.filter((t) => t.subject).length, 1, 'one subject: the first marked')
  assert.equal(n.things[0].subject, true)
  assert.equal(n.things[1].intent, "why Woman's Shirt")
  assert.equal(n.describe, 'A woman sits on a sofa by a window.')
  assert.deepEqual(namesFromPlan({}, [], 'x', 'T').things, [])
})

test('each name goes to Playroom’s own tool, whatever Gemma marked', async () => {
  const { routeName } = await import('../src/shared/naming')
  const r = (label: string, subject = false, people = 1): unknown =>
    routeName({ label, subject }, people)
  assert.deepEqual(r('overcast sky'), { kind: 'scene', target: 'sky' })
  // Gemma once called the sky the subject: the sky plane all the same.
  assert.deepEqual(r('sky dominant area', true), { kind: 'scene', target: 'sky' })
  assert.deepEqual(r('dense tree line'), { kind: 'scene', target: 'vegetation' })
  assert.deepEqual(r('lake'), { kind: 'scene', target: 'water' })
  assert.deepEqual(r('hair'), { kind: 'part', part: 'hair' })
  assert.deepEqual(r("person's clothes"), { kind: 'part', part: 'clothes' })
  assert.deepEqual(r('face skin'), { kind: 'part', part: 'face' })
  assert.deepEqual(r('eyes'), { kind: 'face', part: 'eyes' })
  assert.deepEqual(r('lips'), { kind: 'face', part: 'lips' })
  assert.deepEqual(r('cityscape', true), { kind: 'subject' })
  assert.deepEqual(r('man on the left'), { kind: 'person' })
  assert.deepEqual(r('woman', false, 3), { kind: 'person' }, 'one of several')
  assert.deepEqual(r('woman', false, 1), { kind: 'phrase', text: 'woman' })
  assert.deepEqual(r('red couch'), { kind: 'phrase', text: 'red couch' })
  assert.deepEqual(r("woman's shirt"), { kind: 'phrase', text: "woman's shirt" })
})

test('the user’s own list: a chip off, a name typed, read back whole', async () => {
  const { withAdded, withRemoved, readNames } = await import('../src/shared/naming')
  const base: PhotoNames = {
    v: 1,
    by: 'gemma-4-e2b-it',
    at: 'T',
    describe: '',
    things: [{ label: 'sky', intent: '', subject: false }]
  }
  const added = withAdded(base, '  The Red_Car ', 'T')!
  assert.deepEqual(added.things[1], { label: 'red car', intent: '', subject: false, user: true })
  assert.equal(added.edited, true)
  assert.equal(withAdded(added, 'red car', 'T')!.things.length, 2, 'once')
  assert.equal(withAdded(null, 'dog', 'T')!.things[0].label, 'dog')
  assert.deepEqual(
    withRemoved(added, 'sky').things.map((t) => t.label),
    ['red car']
  )
  assert.deepEqual(readNames(JSON.stringify(added)), added)
  assert.equal(readNames('not json'), null)
  assert.equal(readNames({ v: 2, things: [] }), null)
})

test('the Library finds a named photo by its names, their class and close words', async () => {
  const { searchWords } = await import('../src/shared/naming')
  const { applyFilter, DEFAULT_FILTER } = await import('../src/shared/filter')
  const n = (...labels: string[]): PhotoNames => ({
    v: 1,
    by: 'g',
    at: 'T',
    describe: 'Boats in a harbour at dusk.',
    things: labels.map((label) => ({ label, intent: '', subject: false }))
  })
  const items = [
    item({ key: 'ocean', name: 'IMG_1.jpg', names: searchWords(n('ocean', 'pier')) }),
    item({ key: 'lake', name: 'IMG_2.jpg', names: searchWords(n('lake', 'dense forest')) }),
    item({ key: 'none', name: 'IMG_3.jpg' })
  ]
  const find = (text: string): string[] =>
    applyFilter(items, { ...DEFAULT_FILTER, text }).map((i) => i.key)
  assert.deepEqual(find('sea'), ['ocean'], '“sea” finds the ocean, not the lake')
  assert.deepEqual(find('water'), ['ocean', 'lake'])
  assert.deepEqual(find('vegetation'), ['lake'])
  assert.deepEqual(find('pier'), ['ocean'])
  assert.deepEqual(find('trees'), ['lake'], '“dense forest” answers to “trees”')
  assert.deepEqual(find('piers'), ['ocean'], 'either number')
  assert.deepEqual(find('harbour'), ['ocean', 'lake'], 'Gemma’s sentence is searched too')
  assert.deepEqual(searchWords(null), [])
})

test('the index keeps names, and which photos are still to name', async () => {
  const { Store } = await import('../src/main/db')
  const dir = mkdtempSync(join(tmpdir(), 'playroom-names-'))
  try {
    const file = join(dir, 'playroom.db')
    Store.open(file).close()
    const db = new DatabaseSync(file)
    const add = db.prepare(
      `INSERT INTO photos (path, folder, name, ext, size, mtime, is_raw, added) VALUES (?, '/a', ?, 'jpg', 1, 1, 0, ?)`
    )
    add.run('/a/old.jpg', 'old.jpg', 1)
    add.run('/a/new.jpg', 'new.jpg', 2)
    add.run('/a/bad.jpg', 'bad.jpg', 3)
    db.prepare("UPDATE photos SET failed_key = 'k' WHERE name = 'bad.jpg'").run()
    db.close()
    const store = Store.open(file)
    const id = (name: string): number => store.photoByPath(`/a/${name}`)!.id
    assert.deepEqual(
      store.unnamed(10),
      [id('new.jpg'), id('old.jpg')],
      'newest first, readable only'
    )
    store.setNames(id('new.jpg'), '{"v":1}')
    store.setNamesTried(id('old.jpg'), 'T')
    assert.deepEqual(store.unnamed(10), [])
    assert.equal(store.photo(id('new.jpg'))!.names, '{"v":1}')
    // Named after a failed try: the try is forgotten.
    store.setNames(id('old.jpg'), '{"v":1}')
    assert.equal(store.photo(id('old.jpg'))!.names_tried, null)
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a sidecar keeps the names, and one with only names is still written', async () => {
  const { emptySidecar, readSidecar, writeSidecar } = await import('../src/main/sidecar')
  const dir = mkdtempSync(join(tmpdir(), 'playroom-names-side-'))
  try {
    const photo = join(dir, 'x.jpg')
    const names: PhotoNames = {
      v: 1,
      by: 'gemma-4-e2b-it',
      at: 'T',
      describe: 'A pier.',
      things: [{ label: 'pier', intent: 'the subject', subject: true }]
    }
    assert.notEqual(writeSidecar(photo, { ...emptySidecar(), names }), null)
    assert.deepEqual(readSidecar(photo, false).sidecar.names, names)
    // Names gone and nothing else said: the sidecar goes.
    assert.equal(writeSidecar(photo, { ...emptySidecar(), names: null }), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
