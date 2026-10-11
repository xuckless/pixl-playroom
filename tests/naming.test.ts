// Gemma's names (shared/naming.ts): kept from its answer, routed by
// Playroom's own map, found by the Library's search; and kept in the index.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import type { PhotoNames, PlaneShare } from '../src/shared/naming'
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

// With no brain (engine 0.19.2's default flow): the named planes the photo
// holds and the subject, as found chips (main/ai/found.ts).
const share = (coverage: number, rawMax = 1, name = ''): PlaneShare => ({ name, coverage, rawMax })
const planes = (names: string[], coverage = 0.1): PlaneShare[] =>
  names.map((n) => share(coverage, 1, n))

test('found chips: the subject, then the scene, then the parts, each at 0.5 % of the frame or more', async () => {
  const { foundThings } = await import('../src/shared/naming')
  const found = foundThings({
    subject: share(0.3),
    scene: [share(0.2, 1, 'water'), share(0.004, 1, 'sky'), share(0.005, 1, 'vegetation')],
    // Face skin is the face, body skin the skin; a plane no chip names is left.
    parts: [
      share(0.1, 1, 'clothes'),
      share(0.02, 1, 'face_skin'),
      share(0.001, 1, 'body_skin'),
      share(0.03, 1, 'hair'),
      share(0.5, 1, 'others')
    ]
  })
  assert.deepEqual(
    found.map((f) => f.label),
    ['subject', 'vegetation', 'water', 'hair', 'face', 'clothes']
  )
  assert.equal(found[0].subject, true)
  assert.ok(found.slice(1).every((f) => !f.subject))
})

test('found chips: nothing salient is no subject; a model that did not run gives none', async () => {
  const { foundThings } = await import('../src/shared/naming')
  // U²-Netp's flat answer stretched to full range covers a lot and means nothing.
  assert.deepEqual(foundThings({ subject: share(0.6, 0.1), scene: null, parts: null }), [])
  assert.deepEqual(foundThings({ subject: share(0.003), scene: null, parts: null }), [])
  assert.deepEqual(foundThings({ subject: null, scene: null, parts: null }), [])
})

test('found chips each go to the tool whose plane they were found on', async () => {
  const { foundThings, routeName } = await import('../src/shared/naming')
  const all = foundThings({
    subject: share(0.2),
    scene: planes(['sky', 'vegetation', 'water']),
    parts: planes(['hair', 'face_skin', 'body_skin', 'clothes'])
  })
  assert.deepEqual(
    all.map((f) => routeName(f)),
    [
      { kind: 'subject' },
      { kind: 'scene', target: 'sky' },
      { kind: 'scene', target: 'vegetation' },
      { kind: 'scene', target: 'water' },
      { kind: 'part', part: 'hair' },
      { kind: 'part', part: 'face' },
      { kind: 'part', part: 'skin' },
      { kind: 'part', part: 'clothes' }
    ]
  )
})

test('found chips leave out what a name (Gemma’s or typed) already covers', async () => {
  const { foundChips, foundThings } = await import('../src/shared/naming')
  const found = foundThings({
    subject: share(0.2),
    scene: planes(['sky', 'vegetation', 'water']),
    parts: planes(['hair', 'clothes'])
  })
  const names = [
    // Gemma's ★ is the subject; "trees" is the vegetation plane; "woman's hair" is hair.
    { label: 'building', intent: '', subject: true },
    { label: 'trees', intent: '', subject: false },
    { label: "woman's hair", intent: '', subject: false },
    // Typed, word for word.
    { label: 'sky', intent: '', subject: false, user: true },
    // A phrase covers no plane.
    { label: 'red car', intent: '', subject: false, user: true }
  ]
  assert.deepEqual(
    foundChips(found, names).map((f) => f.label),
    ['water', 'clothes']
  )
  // No names: every one.
  assert.equal(foundChips(found, []).length, found.length)
})

test('the people-parts model runs only where a person is plausible', async () => {
  const { peoplePlausible } = await import('../src/shared/naming')
  // Nothing known: run it.
  assert.equal(peoplePlausible(null, null), true)
  assert.equal(peoplePlausible(share(0.2), null), true)
  assert.equal(peoplePlausible(share(0.2), 2), true)
  // Nothing salient, or the cull signals' face detector found no face: skip it.
  assert.equal(peoplePlausible(share(0.6, 0.1), null), false)
  assert.equal(peoplePlausible(share(0.2), 0), false)
  assert.equal(peoplePlausible(null, 0), false)
})
