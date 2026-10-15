/**
 * Soft proofing, its second part (shared/proof.ts, main/proofing.ts,
 * main/iccprofiles.ts): the settings and their signature, ICC headers and
 * what engine 0.21 can do with each kind, the picker's groups, the proof's
 * requests, proof copies (sidecar, project, index), and the proof as the
 * engine makes it. No photo: pictures are a few pixels made here, and the
 * profile is one the engine writes itself.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import {
  DEFAULT_PROOF,
  mergeBySha,
  normaliseProfile,
  normaliseProof,
  paperName,
  pickerLabels,
  profileGroups,
  proofChip,
  proofCopyName,
  proofKey,
  proofUse,
  pushRecent,
  readIccHeader,
  returnPolicy,
  surroundColour,
  warnOnly,
  type FoundProfile,
  type IccProof,
  type ProofSettings
} from '../src/shared/proof'
import type { ConvertRequest } from '../src/shared/engine-types'

const SHA = (c: string): string => c.repeat(64)

/** An ICC header (and a `desc` tag) as a profile of this class, space and version would have. */
function iccBytes(
  cls: string,
  space: string,
  version: number,
  desc: { type: 'desc' | 'mluc'; text: string } | null = null
): Uint8Array {
  const head = new Uint8Array(128)
  const ascii = (s: string, at: number): void => {
    for (let i = 0; i < 4; i++) head[at + i] = (s.padEnd(4, ' ').charCodeAt(i) ?? 32) & 0xff
  }
  head[8] = version
  ascii(cls, 12)
  ascii(space, 16)
  ascii('XYZ', 20)
  ascii('acsp', 36)
  const tags: number[] = []
  const be = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const str = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
  if (!desc) tags.push(...be(0))
  else {
    const body =
      desc.type === 'desc'
        ? [...str('desc'), 0, 0, 0, 0, ...be(desc.text.length + 1), ...str(desc.text), 0]
        : [
            ...str('mluc'),
            0,
            0,
            0,
            0,
            ...be(1),
            ...be(12),
            ...str('enUS'),
            ...be(desc.text.length * 2),
            ...be(28),
            ...[...desc.text].flatMap((c) => [0, c.charCodeAt(0)])
          ]
    tags.push(...be(1), ...str('desc'), ...be(128 + 4 + 12), ...be(body.length), ...body)
  }
  const out = new Uint8Array(128 + tags.length)
  out.set(head)
  out.set(tags, 128)
  const size = be(out.length)
  out.set(size, 0)
  return out
}

const found = (over: Partial<FoundProfile>): FoundProfile => ({
  sha: SHA('a'),
  name: 'Profile',
  path: '/p/a.icc',
  cls: 'prtr',
  space: 'RGB',
  use: 'proof',
  size: 1000,
  ...over
})

test('settings are read back as Playroom stores them, with defaults for anything else', () => {
  assert.deepEqual(normaliseProof(null), DEFAULT_PROOF)
  assert.deepEqual(normaliseProof({ profile: 'Nope', intent: 'Saturation', bpc: 'yes' }), {
    ...DEFAULT_PROOF
  })
  const icc: IccProof = {
    sha: SHA('b'),
    name: 'P900 Lustre',
    path: '/x.icc',
    cls: 'prtr',
    space: 'RGB'
  }
  const s = normaliseProof({ profile: icc, intent: 'Perceptual', bpc: false, simulate: true })
  assert.deepEqual(s, { profile: icc, intent: 'Perceptual', bpc: false, simulate: true })
  // A profile without a SHA-256 is no profile Playroom could have stored.
  assert.equal(normaliseProfile({ ...icc, sha: 'abc' }), null)
  assert.equal(normaliseProfile('AdobeRgb'), 'AdobeRgb')
})

test('the signature changes with everything that changes the pixels', () => {
  const a: ProofSettings = { ...DEFAULT_PROOF }
  const keys = new Set([
    proofKey(a),
    proofKey({ ...a, profile: 'DisplayP3' }),
    proofKey({ ...a, intent: 'Perceptual' }),
    proofKey({ ...a, bpc: false }),
    proofKey({ ...a, simulate: true })
  ])
  assert.equal(keys.size, 5)
  // A file is its SHA-256, wherever it is.
  const p: IccProof = { sha: SHA('c'), name: 'x', path: '/one.icc', cls: 'prtr', space: 'RGB' }
  assert.equal(
    proofKey({ ...a, profile: p }),
    proofKey({ ...a, profile: { ...p, path: '/two.icc' } })
  )
})

test('simulating paper and ink comes back Absolute, without black point compensation', () => {
  assert.deepEqual(returnPolicy({ simulate: true }), {
    intent: 'AbsoluteColorimetric',
    black_point_compensation: false
  })
  assert.deepEqual(returnPolicy({ simulate: false }), {
    intent: 'RelativeColorimetric',
    black_point_compensation: true
  })
})

test('a header says the class, the space, the version and the name (v2 desc, v4 mluc)', () => {
  const v2 = readIccHeader(iccBytes('prtr', 'RGB', 2, { type: 'desc', text: 'SC-P900 Lustre' }))
  assert.deepEqual(v2 && { ...v2, size: 0 }, {
    size: 0,
    version: 2,
    cls: 'prtr',
    space: 'RGB',
    pcs: 'XYZ',
    name: 'SC-P900 Lustre'
  })
  const v4 = readIccHeader(iccBytes('mntr', 'RGB', 4, { type: 'mluc', text: 'Studio' }))
  assert.equal(v4?.name, 'Studio')
  assert.equal(readIccHeader(iccBytes('prtr', 'CMYK', 2))?.name, null)
  // Not a profile: no 'acsp'.
  assert.equal(readIccHeader(new Uint8Array(200)), null)
  // Plain numbers read as bytes do (what the engine is given).
  assert.equal(readIccHeader(Array.from(iccBytes('spac', 'RGB', 4)))?.cls, 'spac')
})

test('what engine 0.21 can do: proof an RGB output, warn against CMYK and grey, refuse the rest', () => {
  const use = (cls: string, space: string, v = 2): string => {
    const u = proofUse(readIccHeader(iccBytes(cls, space, v))!)
    return u.use === 'none' ? `none: ${u.why}` : u.use
  }
  assert.equal(use('prtr', 'RGB'), 'proof')
  assert.equal(use('mntr', 'RGB', 4), 'proof')
  assert.equal(use('prtr', 'CMYK'), 'warning')
  assert.equal(use('mntr', 'GRAY'), 'warning')
  assert.equal(use('link', 'RGB'), 'none: device link')
  assert.equal(use('abst', 'Lab'), 'none: abstract profile')
  assert.equal(use('nmcl', 'RGB'), 'none: named colours')
  assert.equal(use('prtr', 'RGB', 5), 'none: iccMAX profile')
  assert.equal(use('spac', 'Lab'), 'none: not RGB, CMYK or grey')
  assert.ok(warnOnly({ sha: SHA('d'), name: '', path: '', cls: 'prtr', space: 'CMYK' }))
  assert.ok(!warnOnly('Srgb'))
})

test('the picker: the same file once, printers, other RGB, CMYK, and Recent of what is still found', () => {
  const list = [
    found({ sha: SHA('1'), name: 'Lustre', path: '/drv/v1/Lustre.icc' }),
    found({ sha: SHA('1'), name: 'Lustre', path: '/drv/v2/Lustre.icc' }),
    found({ sha: SHA('2'), name: 'Lustre', path: '/other/Lustre.icc' }),
    found({ sha: SHA('3'), name: 'Studio', cls: 'mntr' }),
    found({ sha: SHA('4'), name: 'Coated', space: 'CMYK', use: 'warning' }),
    found({ sha: SHA('5'), name: 'Link', cls: 'link', use: 'none', why: 'device link' })
  ]
  assert.equal(mergeBySha(list).length, 5)
  const gone: IccProof = { sha: SHA('9'), name: 'Gone', path: '/g.icc', cls: 'prtr', space: 'RGB' }
  const groups = profileGroups(list, ['DisplayP3', gone])
  const names = Object.fromEntries(
    groups.map((g) => [g.id, g.profiles.map((p) => (typeof p === 'string' ? p : p.name))])
  )
  assert.deepEqual(names, {
    recent: ['DisplayP3'],
    screen: ['Srgb', 'DisplayP3', 'AdobeRgb'],
    printers: ['Lustre', 'Lustre'],
    other: ['Studio'],
    cmyk: ['Coated']
  })
  // Two of one name are told apart by their folder.
  const labels = pickerLabels(mergeBySha(list))
  assert.equal(labels.get(SHA('1')), 'Lustre · v1')
  assert.equal(labels.get(SHA('2')), 'Lustre · other')
  assert.equal(labels.get(SHA('3')), 'Studio')
  // macOS names each display's profile "Display": its file's name (less its UUID) tells them apart.
  const displays = pickerLabels([
    found({
      sha: SHA('6'),
      name: 'Display',
      path: '/D/Color LCD-37D8832A-2D66-02CA-B9F7-8F30A301B230.icc'
    }),
    found({
      sha: SHA('7'),
      name: 'Display',
      path: '/D/Sidecar Display-15C3A3D7-3B16-4630-ACDE-95D1EAFF6DB1.icc'
    }),
    // Two of one screen: the start of each file's UUID.
    found({
      sha: SHA('8'),
      name: 'Display',
      path: '/D/HDMI-92D42E4A-769D-4089-93CF-F50BF227DBA8.icc'
    }),
    found({
      sha: SHA('9'),
      name: 'Display',
      path: '/D/HDMI-A581A141-E7EB-482E-8970-076639333B9D.icc'
    })
  ])
  assert.deepEqual(
    [...displays.values()],
    [
      'Display · Color LCD',
      'Display · Sidecar Display',
      'Display · HDMI 92D42E4A',
      'Display · HDMI A581A141'
    ]
  )
  // No printer profiles: the group is there, empty (the setup says where to find them).
  assert.deepEqual(profileGroups([], [])[2], { id: 'printers', label: 'Printers', profiles: [] })
})

test('Recent keeps the newest five, each once', () => {
  let r: ReturnType<typeof pushRecent> = []
  for (const p of ['Srgb', 'DisplayP3', 'AdobeRgb', 'Srgb'] as const) r = pushRecent(r, p)
  assert.deepEqual(r, ['Srgb', 'AdobeRgb', 'DisplayP3'])
  for (let i = 0; i < 6; i++)
    r = pushRecent(r, {
      sha: SHA(String(i)),
      name: `${i}`,
      path: `/${i}`,
      cls: 'prtr',
      space: 'RGB'
    })
  assert.equal(r.length, 5)
  assert.equal((r[0] as IccProof).name, '5')
})

test('a proof copy is named for its paper', () => {
  const p: IccProof = {
    sha: SHA('e'),
    name: 'SC-P900 Premium Luster Profile.icc',
    path: '/x',
    cls: 'prtr',
    space: 'RGB'
  }
  assert.equal(paperName(p), 'SC-P900 Premium Luster')
  assert.equal(proofCopyName(p), 'SC-P900 Premium Luster proof')
  assert.equal(proofCopyName('Srgb'), 'sRGB proof')
  assert.ok(paperName({ ...p, name: 'x'.repeat(80) }).length <= 40)
})

test('the chip: proofed, on its way, a drag, a warning only, or why it went off', () => {
  const want = proofKey(DEFAULT_PROOF)
  const full = (
    key?: string,
    warnOnly?: boolean
  ): { kind: string; proof?: { key: string; warnOnly?: boolean } } => ({
    kind: 'full',
    ...(key ? { proof: { key, warnOnly } } : {})
  })
  const chip = (
    on: boolean,
    picture: ReturnType<typeof full> | null,
    issue: { kind: 'missing' | 'unusable' } | null = null
  ): string | null => proofChip({ on, issue, want, picture })
  assert.equal(chip(false, full()), null)
  assert.equal(chip(false, full(), { kind: 'missing' }), 'missing')
  assert.equal(chip(true, full(want)), 'on')
  assert.equal(chip(true, full(want, true)), 'warn')
  // A setting changed since this picture was made: the new proof is on its way.
  assert.equal(chip(true, full('other')), 'proofing')
  assert.equal(chip(true, full()), 'proofing')
  assert.equal(chip(true, { kind: 'draft' }), 'drag')
})

test('the surround: dim paper (its own white when simulating), grey or black', () => {
  assert.equal(surroundColour('black', null, false), 'color(display-p3 0 0 0)')
  assert.equal(surroundColour('paper', null, false), 'color(display-p3 0.8 0.8 0.8)')
  assert.equal(surroundColour('paper', [255, 240, 230], false), 'color(display-p3 0.8 0.8 0.8)')
  assert.equal(surroundColour('paper', [255, 204, 102], true), 'color(display-p3 0.8 0.64 0.32)')
  assert.match(surroundColour('grey', null, true), /^color\(display-p3 0\.46 0\.46 0\.46\)$/)
})

// ── the proof's requests ──

const picture = (over: Partial<ConvertRequest> = {}): ConvertRequest =>
  ({
    source: { Path: '/proxy.tiff' },
    sink: { Path: '/view.jpg' },
    input: 'Tiff',
    pixel: { depth: 'Eight', channels: 3 },
    encode: { Jpeg: { quality: 95, subsampling: 'Quarter', optimize: false } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: {
      ConvertTo: {
        to: 'DisplayP3',
        intent: 'RelativeColorimetric',
        black_point_compensation: false
      }
    },
    grade: { ops: [] },
    framing: null,
    lens: null,
    retouch: null,
    region: { x: 0, y: 0, width: 10, height: 10, margin: 0 },
    measure: { at: 'Output' },
    threads: 4,
    ...over
  }) as unknown as ConvertRequest

test('a proof is the picture into the profile at 16 bits, then back as the picture asked', async () => {
  const { proofPlan, proofSteps } = await import('../src/main/proofing')
  const plan = proofPlan(
    { ...DEFAULT_PROOF, intent: 'Perceptual', simulate: true },
    {
      Icc: [1, 2, 3]
    }
  )
  const [into, back, ...rest] = proofSteps(picture(), plan, ['/m0.tiff', '/m1.tiff'])
  assert.equal(rest.length, 0)
  // The grade, the region and the framing go with the first step, into the profile.
  assert.deepEqual(into.sink, { Path: '/m1.tiff' })
  assert.deepEqual(into.color, {
    ConvertTo: { to: { Icc: [1, 2, 3] }, intent: 'Perceptual', black_point_compensation: true }
  })
  assert.deepEqual(into.pixel, { depth: 'Sixteen', channels: 3 })
  assert.deepEqual(into.encode, { Tiff: { compression: 'None' } })
  assert.ok(into.metadata.icc, 'the file carries the profile the next step reads')
  assert.equal(into.measure, null)
  assert.deepEqual(into.grade, { ops: [] })
  assert.notEqual(into.region, null)
  // Back from it to the screen's space, by Absolute (simulating): the picture's sink and measure.
  assert.deepEqual(back.source, { Path: '/m1.tiff' })
  assert.deepEqual(back.sink, { Path: '/view.jpg' })
  assert.deepEqual(back.color, {
    ConvertTo: { to: 'DisplayP3', intent: 'AbsoluteColorimetric', black_point_compensation: false }
  })
  assert.equal(back.grade, null)
  assert.equal(back.region, null)
  assert.deepEqual(back.measure, { at: 'Output' })
  // A float frame comes back as one, linear.
  const frame = proofSteps(
    picture({
      sink: 'Bytes',
      pixel: { depth: 'F32', channels: 4 },
      encode: { Pixels: { sample: 'F16' } },
      color: {
        ConvertTo: {
          to: 'LinearDisplayP3',
          intent: 'RelativeColorimetric',
          black_point_compensation: false
        }
      }
    }),
    plan,
    ['/m0.tiff', '/m1.tiff']
  )
  assert.deepEqual(frame[0].pixel, { depth: 'Sixteen', channels: 4 })
  assert.equal(frame[1].sink, 'Bytes')
  assert.deepEqual(frame[1].encode, { Pixels: { sample: 'F16' } })
  assert.equal((frame[1].color as { ConvertTo: { to: string } }).ConvertTo.to, 'LinearDisplayP3')
})

test('an HDR source is tone mapped as it is shown first, then proofed', async () => {
  const { proofPlan, proofSteps } = await import('../src/main/proofing')
  const toneMap = {
    ToneMap: {
      to: 'DisplayP3',
      operator: 'Bt2390',
      mode: 'PerChannel',
      source_peak: { Nits: 1000 },
      target_peak_nits: 203,
      gamut: 'Compress',
      intent: 'RelativeColorimetric',
      black_point_compensation: false
    }
  } as const
  const steps = proofSteps(picture({ color: toneMap }), proofPlan(DEFAULT_PROOF, 'Srgb'), [
    '/m0.tiff',
    '/m1.tiff'
  ])
  assert.equal(steps.length, 3)
  assert.deepEqual(steps[0].color, toneMap)
  assert.deepEqual(steps[0].sink, { Path: '/m0.tiff' })
  assert.deepEqual(steps[1].source, { Path: '/m0.tiff' })
  assert.equal(steps[1].grade, null)
  assert.deepEqual(steps[1].color, {
    ConvertTo: { to: 'Srgb', intent: 'RelativeColorimetric', black_point_compensation: true }
  })
  assert.deepEqual(steps[2].source, { Path: '/m1.tiff' })
  assert.equal((steps[2].color as { ConvertTo: { to: string } }).ConvertTo.to, 'DisplayP3')
})

// ── proof copies ──

test('a copy is named as asked, else numbered in main’s words', async () => {
  const { copyName } = await import('../src/main/indexer/service')
  assert.equal(copyName({ name: '  Lustre proof ' }, 3), 'Lustre proof')
  assert.equal(copyName({ template: 'Kopie {{n}}' }, 2), 'Kopie 2')
  assert.equal(copyName({}, 1), 'Copy 1')
})

test('a proof copy keeps its proof in the sidecar and the project; the photo never has one', async () => {
  const { emptySidecar, readSidecar, writeSidecar } = await import('../src/main/sidecar')
  const { proofsOf } = await import('../src/main/project/pixlfile')
  const dir = mkdtempSync(join(tmpdir(), 'proof-side-'))
  const proof: ProofSettings = { ...DEFAULT_PROOF, profile: 'AdobeRgb', simulate: true }
  try {
    const photo = join(dir, 'x.jpg')
    const copy = {
      id: 'k3x9a1b2',
      name: 'Adobe RGB proof',
      rating: 0,
      flag: null,
      label: null,
      recipe: null,
      snapshots: []
    }
    writeSidecar(photo, {
      ...emptySidecar(),
      copies: [
        { ...copy, proof },
        { ...copy, id: 'k3x9a1b3' }
      ]
    })
    const back = readSidecar(photo, false).sidecar
    assert.deepEqual(back.copies[0].proof, proof)
    assert.equal(back.copies[1].proof, undefined)
    assert.equal('proof' in back.photo, false)
    // The project's meta: by copy, each read as settings; a crafted id is left out.
    assert.deepEqual(proofsOf(JSON.stringify({ k3x9a1b2: proof, '../x': proof })), {
      k3x9a1b2: proof
    })
    assert.deepEqual(proofsOf('not json'), {})
    assert.deepEqual(proofsOf(null), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the index makes a proof copy, opens it with its proof, and Sync leaves the proof alone', async () => {
  const { IndexService } = await import('../src/main/indexer/service')
  const { PixlFile } = await import('../src/main/project/pixlfile')
  const root = mkdtempSync(join(tmpdir(), 'proof-index-'))
  const folder = join(root, 'photos')
  mkdirSync(folder)
  writeFileSync(join(folder, 'a.jpg'), 'not really a photo')
  const index = new IndexService({
    userData: join(root, 'userData'),
    emit: () => {},
    xmp: { read: async () => null, write: async () => {}, end: () => Promise.resolve() }
  })
  const proof: ProofSettings = {
    profile: { sha: SHA('f'), name: 'Lustre', path: '/l.icc', cls: 'prtr', space: 'RGB' },
    intent: 'Perceptual',
    bpc: true,
    simulate: true
  }
  try {
    const [a] = await index.listFolder(folder)
    const copy = index.createCopy(a.key, { name: 'Lustre proof', proof })
    assert.equal(copy.copyName, 'Lustre proof')
    assert.deepEqual(index.openData(copy.key).proof, proof)
    assert.equal(index.openData(a.key).proof, null)
    // A plain copy, numbered in the words main gave.
    assert.equal(index.createCopy(a.key, { template: 'Copie {{n}}' }).copyName, 'Copie 2')
    // Copies live in the photo's project: the proof is kept there.
    const project = PixlFile.open(index.projectPath(copy.key)!)
    try {
      assert.deepEqual(project.read(false).copies[0].proof, proof)
    } finally {
      project.close()
    }
    // Sync settings (a recipe pasted onto the copy) changes its recipe, never its proof.
    const recipe = index.recipe(a.key)
    recipe.basic.exposure = 0.5
    index.saveRecipes([{ key: copy.key, recipe }])
    assert.deepEqual(index.openData(copy.key).proof, proof)
    assert.equal(index.recipe(copy.key).basic.exposure, 0.5)
  } finally {
    index.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ── keys ──

test('S, ⌥S and ⇧Y proof in Develop and clash with no other default', async () => {
  const { allConflicts, parseChord } = await import('../src/renderer/src/lib/keys')
  // The defaults as commands.ts lists them (it needs the window's stores to load).
  const src = readFileSync(new URL('../src/renderer/src/lib/commands.ts', import.meta.url), 'utf8')
  const cmds = [
    ...src.matchAll(/id: '([^']+)',[\s\S]*?context: '([^']+)',\s*keys: \[([^\]]*)\]/g)
  ].map((m) => ({
    id: m[1],
    context: m[2] as 'develop',
    keys: [...m[3].matchAll(/'([^']+)'/g)].map((k) => parseChord(k[1]))
  }))
  const byId = Object.fromEntries(cmds.map((c) => [c.id, c]))
  assert.deepEqual(byId['view.proof'].keys, [parseChord('S')])
  assert.deepEqual(byId['view.proofSetup'].keys, [parseChord('Alt+S')])
  assert.deepEqual(byId['view.proofSplit'].keys, [parseChord('Shift+Y')])
  assert.equal(byId['view.proof'].context, 'develop')
  const ours = new Set(['view.proof', 'view.proofSetup', 'view.proofSplit'])
  const clashes = allConflicts(cmds, Object.fromEntries(cmds.map((c) => [c.id, c.keys]))).filter(
    (c) => ours.has(c.a) || ours.has(c.b)
  )
  assert.deepEqual(clashes, [])
})

// ── profiles on disk ──

test('a scan finds profiles in nested folders, the same file once, and finds a moved one by its hash', async () => {
  const { readProfile, resetProfiles, scanProfiles, profileBytes } =
    await import('../src/main/iccprofiles')
  const root = mkdtempSync(join(tmpdir(), 'proof-scan-'))
  try {
    resetProfiles()
    const a = join(root, 'a')
    const b = join(root, 'b', 'Driver.bundle', 'Resources')
    mkdirSync(a)
    mkdirSync(b, { recursive: true })
    const lustre = iccBytes('prtr', 'RGB', 2, { type: 'desc', text: 'Lustre' })
    writeFileSync(join(a, 'Lustre.icc'), lustre)
    writeFileSync(join(b, 'Lustre copy.ICM'), lustre)
    writeFileSync(
      join(b, 'Coated.icc'),
      iccBytes('prtr', 'CMYK', 2, { type: 'desc', text: 'Coated' })
    )
    writeFileSync(join(a, 'notes.icc'), 'not a profile at all, just words in a file')
    writeFileSync(join(a, 'readme.txt'), 'ignored')
    const list = await scanProfiles([a, join(root, 'b'), join(root, 'missing')])
    assert.deepEqual(list.map((f) => [f.name, f.use]).sort(), [
      ['Coated', 'warning'],
      ['Lustre', 'proof']
    ])
    const l = list.find((f) => f.name === 'Lustre')!
    assert.equal(l.path, join(a, 'Lustre.icc'))
    assert.deepEqual(await readProfile(join(a, 'notes.icc')), { error: 'not an ICC profile' })
    // The file chosen moved: found again by its hash (a scan of where it went), never another.
    const moved = join(root, 'b', 'Lustre moved.icc')
    writeFileSync(moved, lustre)
    rmSync(join(a, 'Lustre.icc'))
    rmSync(join(b, 'Lustre copy.ICM'))
    resetProfiles()
    await scanProfiles([a, join(root, 'b')])
    const bytes = await profileBytes({ ...l, path: join(a, 'Lustre.icc') })
    assert.deepEqual(bytes, Array.from(lustre))
    rmSync(moved)
    resetProfiles()
    await scanProfiles([a, join(root, 'b')])
    assert.equal(await profileBytes({ ...l, path: join(a, 'Lustre.icc') }), null)
  } finally {
    resetProfiles()
    rmSync(root, { recursive: true, force: true })
  }
})

// ── with the engine ──

/** The native engine, where it is built (not in CI: these skip). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{ width: number; inspected: string | null }>
    }
  } catch {
    return null
  }
})()
const skip = realEngine === null ? 'the engine is not built for this platform' : false

/** The ICC profile the engine embeds for a space: an RGB display profile to proof with. */
async function engineProfile(dir: string, to: 'Srgb' | 'AdobeRgb'): Promise<Buffer> {
  const { withRequiredFields } = await import('../src/main/engine/required')
  const { CICP_DISPLAY_P3, encodePng8, colourChunks } = await import('../src/main/pngio')
  const { blankRequest } = await import('../src/main/source')
  const src = join(dir, `src-${to}.png`)
  const out = join(dir, `icc-${to}.png`)
  writeFileSync(src, encodePng8(new Uint8Array([10, 20, 30, 255]), 1, 1, 1, [CICP_DISPLAY_P3]))
  await realEngine!.convert(
    withRequiredFields('convert', [
      {
        ...blankRequest(src, out, 'Png'),
        pixel: { depth: 'Eight', channels: 3 },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: {
          ConvertTo: { to, intent: 'RelativeColorimetric', black_point_compensation: false }
        }
      }
    ])[0]
  )
  const iccp = colourChunks(readFileSync(out)).find((c) => c.toString('ascii', 4, 8) === 'iCCP')
  assert.ok(iccp, 'the engine embeds its profile')
  const data = iccp.subarray(8, iccp.length - 4)
  const nul = data.indexOf(0)
  return inflateSync(data.subarray(nul + 2))
}

test(
  'the engine proofs a picture into a profile and back, the same as the screen where it fits',
  { skip },
  async () => {
    const { withRequiredFields } = await import('../src/main/engine/required')
    const { CICP_DISPLAY_P3, encodePng8, decodePng } = await import('../src/main/pngio')
    const { blankRequest } = await import('../src/main/source')
    const { proofPlan, proofSteps, checkRequests, paperPng } = await import('../src/main/proofing')
    const dir = mkdtempSync(join(tmpdir(), 'proof-engine-'))
    const send = (r: unknown): Promise<unknown> =>
      realEngine!.convert(withRequiredFields('convert', [r])[0])
    try {
      const icc = Array.from(await engineProfile(dir, 'Srgb'))
      const header = readIccHeader(icc)
      assert.equal(header?.space, 'RGB')
      // A Display P3 green past sRGB on the left, a mid grey on the right.
      const w = 8
      const rgba = new Uint8Array(w * 4 * 4)
      for (let i = 0; i < w * 4; i++)
        rgba.set(i % w < w / 2 ? [40, 250, 40, 255] : [128, 128, 128, 255], i * 4)
      const src = join(dir, 'p3.png')
      writeFileSync(src, encodePng8(rgba, w, 4, 1, [CICP_DISPLAY_P3]))
      const out = join(dir, 'proof.png')
      const req = {
        ...blankRequest(src, out, 'Png'),
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: {
          ConvertTo: {
            to: 'DisplayP3',
            intent: 'RelativeColorimetric',
            black_point_compensation: false
          }
        }
      } as ConvertRequest
      for (const step of proofSteps(req, proofPlan(DEFAULT_PROOF, { Icc: icc }), [
        join(dir, 'm0.tiff'),
        join(dir, 'm1.tiff')
      ]))
        await send(step)
      const px = decodePng(readFileSync(out)).rows
      const at = (x: number): number[] => [...px.subarray(x * 3, x * 3 + 3)]
      // The green comes back as sRGB can make it: less saturated (red lifted).
      assert.ok(at(1)[0] > 60, `green proofed into sRGB (${at(1)})`)
      // The grey fits: it comes back as it was, within a step.
      for (const c of at(w - 2)) assert.ok(Math.abs(c - 128) <= 2, `grey held (${at(w - 2)})`)
      // The setup's check: both transforms built, and the paper's white read (sRGB's is white).
      const png = join(dir, 'paper.png')
      writeFileSync(png, paperPng(icc))
      const paper = join(dir, 'paper-out.png')
      for (const r of checkRequests(
        { plan: proofPlan(DEFAULT_PROOF, { Icc: icc }), warnOnly: false },
        png,
        join(dir, 'paper.tiff'),
        paper
      ))
        await send(r)
      const white = [...decodePng(readFileSync(paper)).rows.subarray(0, 3)]
      for (const c of white) assert.ok(c >= 250, `the paper's white (${white})`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'a profile Little CMS cannot build a transform into is refused at its colour step',
  { skip },
  async () => {
    const { withRequiredFields } = await import('../src/main/engine/required')
    const { proofPlan, checkRequests, paperPng } = await import('../src/main/proofing')
    const dir = mkdtempSync(join(tmpdir(), 'proof-refuse-'))
    try {
      // An sRGB profile with its header saying CMYK data: what the engine cannot build.
      const icc = Array.from(await engineProfile(dir, 'AdobeRgb'))
      icc.splice(16, 4, ...[...'CMYK'].map((c) => c.charCodeAt(0)))
      const png = join(dir, 'paper.png')
      writeFileSync(png, paperPng(Array.from(await engineProfile(dir, 'Srgb'))))
      const [into] = checkRequests(
        { plan: proofPlan(DEFAULT_PROOF, { Icc: icc }), warnOnly: false },
        png,
        join(dir, 'm.tiff'),
        join(dir, 'out.png')
      )
      await assert.rejects(realEngine!.convert(withRequiredFields('convert', [into])[0]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
