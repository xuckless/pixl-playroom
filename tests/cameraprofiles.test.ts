/**
 * DNG camera profiles as a RAW's colour (engine 0.21, E21): the colour that
 * names one, what the engine is told under each develop, the exposure offset
 * Adobe's renderer adds, which body a profile is for, and where the profile
 * itself is kept (Playroom's store, the index, a sidecar, a project).
 * No Adobe profile is in the repository: the engine-backed check reads one
 * where Adobe's own installer put it, and skips without.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DcpProfile, SourceInfo } from '../src/shared/engine-types'
import {
  cameraColourOf,
  dcpIdOf,
  developMark,
  exposureOffsetOf,
  parseRawColour,
  profileFits,
  rawColourLabel,
  readProfile,
  registerDcp,
  resolveRawColour,
  usableColour
} from '../src/shared/rawcolour'
import { RAW_DEVELOP_REV } from '../src/shared/pixels'
import { compile, type CompileContext } from '../src/shared/compile'
import { defaultRecipe } from '../src/shared/recipe'
import {
  adobeFolders,
  CameraProfiles,
  namedFor,
  NotAProfile,
  profileId
} from '../src/main/cameraprofiles'

const camera = {
  illuminants: [
    {
      light: 'D65',
      color_matrix: [
        [0.7952, -0.1689, -0.0575],
        [-0.3746, 1.0825, 0.3378],
        [-0.0405, 0.1362, 0.612]
      ],
      camera_calibration: null,
      forward_matrix: null
    }
  ],
  analog_balance: null
}

const profile = (more: Partial<DcpProfile> = {}): DcpProfile => ({
  name: 'Camera Standard',
  unique_camera_model: 'Canon EOS 200D',
  calibration_signature: 'com.adobe',
  copyright: null,
  camera,
  hue_sat_maps: [{ hue_divisions: 2, sat_divisions: 2, val_divisions: 1, entries: [] }],
  hue_sat_map_encoding: 'Linear',
  look_table: null,
  look_table_encoding: 'Linear',
  tone_curve: [
    [0, 0],
    [0.5, 0.6],
    [1, 1]
  ],
  baseline_exposure_offset: 0.35,
  ...more
})

const cam = (make = 'Canon', model = 'EOS 200D'): Pick<SourceInfo, 'camera_colour'> => ({
  camera_colour: {
    form: 'LibRaw' as const,
    make,
    model,
    pixl_versions: [1],
    pixl_camera: `${make} ${model}`,
    as_shot_white: null
  }
})

registerDcp('0a1b2c3d', profile())

test('a camera profile is a colour of its own, named by its id', () => {
  assert.equal(parseRawColour('dcp:0a1b2c3d'), 'dcp:0a1b2c3d')
  assert.equal(parseRawColour('dcp:0A1B2C3D'), null)
  assert.equal(parseRawColour('dcp:0a1b'), null)
  assert.equal(dcpIdOf('dcp:0a1b2c3d'), '0a1b2c3d')
  assert.equal(dcpIdOf('pixl:1'), null)
  assert.equal(developMark('dcp:0a1b2c3d'), `${RAW_DEVELOP_REV}d0a1b2c3d`)
  assert.notEqual(developMark('dcp:0a1b2c3d'), developMark('container'))
  assert.equal(rawColourLabel(cam(), 'dcp:0a1b2c3d'), 'Camera Standard')
})

test('the scene develop states the profile, its tone curve never; a linear DNG’s its matrices', () => {
  const scene = cameraColourOf('dcp:0a1b2c3d', 'scene')
  assert.ok(typeof scene === 'object' && 'Dcp' in scene)
  assert.equal(scene.Dcp.tone_curve, null)
  assert.equal(scene.Dcp.hue_sat_maps.length, 1)
  assert.equal(scene.Dcp.baseline_exposure_offset, 0.35)
  assert.deepEqual(cameraColourOf('dcp:0a1b2c3d', 'develop'), { Stated: camera })
  // The built-in colours are as they were.
  assert.equal(cameraColourOf('container', 'develop'), 'Container')
  assert.deepEqual(cameraColourOf('pixl:1', 'scene'), { Pixl: { version: 1 } })
})

test('a profile this process does not hold develops as the file’s own, never a failure', () => {
  assert.equal(usableColour('dcp:ffffffff'), 'container')
  assert.equal(cameraColourOf('dcp:ffffffff'), 'Container')
  assert.equal(resolveRawColour('dcp:ffffffff', cam()), 'container')
  assert.equal(resolveRawColour('dcp:0a1b2c3d', cam()), 'dcp:0a1b2c3d')
  assert.equal(exposureOffsetOf('dcp:ffffffff'), 0)
})

test('the exposure offset is the profile’s, added to a RAW’s exposure as Lightroom adds it', () => {
  assert.equal(exposureOffsetOf('dcp:0a1b2c3d'), 0.35)
  assert.equal(exposureOffsetOf('pixl:1'), 0)
  const ctx: CompileContext = {
    isRaw: true,
    asShot: null,
    sourceOrientation: 'Normal',
    frameWidth: 600,
    frameHeight: 400,
    scale: 1,
    seed: 1,
    brushPaths: {},
    applyCrop: true
  }
  const exposureOf = (c: CompileContext, stops: number): number | null => {
    const r = defaultRecipe(c.isRaw)
    r.basic.exposure = stops
    const op = compile(r, c)
      .grade?.layers[0].stages.flatMap((s) => s.ops)
      .find((o) => 'Primary' in o && o.Primary.exposure !== 0)
    return op && 'Primary' in op ? op.Primary.exposure : null
  }
  assert.equal(exposureOf({ ...ctx, exposureOffset: 0.35 }, 0.5), 0.85)
  assert.equal(exposureOf({ ...ctx, exposureOffset: 0.35 }, 0), 0.35)
  assert.equal(exposureOf(ctx, 0.5), 0.5)
  // Only a RAW's develop has a camera profile.
  assert.equal(exposureOf({ ...ctx, isRaw: false, exposureOffset: 0.35 }, 0.5), 0.5)
})

test('a profile is offered for the body its UniqueCameraModel names', () => {
  assert.equal(profileFits(profile(), cam()), true)
  assert.equal(profileFits(profile({ unique_camera_model: 'canon eos  200d' }), cam()), true)
  assert.equal(profileFits(profile(), cam('Canon', 'EOS R5')), false)
  assert.equal(profileFits(profile({ unique_camera_model: null }), cam()), false)
  assert.equal(profileFits(profile(), { camera_colour: null }), false)
})

test('a profile read back from JSON is the engine’s shape, or nothing', () => {
  const p = profile()
  assert.deepEqual(readProfile(JSON.stringify(p)), p)
  assert.deepEqual(readProfile(p), p)
  assert.equal(readProfile('{"name":"x"}'), null)
  assert.equal(readProfile('not json'), null)
  assert.equal(readProfile(null), null)
})

test('Adobe’s folders, and a file named for a body', () => {
  assert.deepEqual(adobeFolders('darwin', {}, '/Users/sam'), [
    '/Library/Application Support/Adobe/CameraRaw/CameraProfiles',
    '/Users/sam/Library/Application Support/Adobe/CameraRaw/CameraProfiles'
  ])
  const win = adobeFolders('win32', { ProgramData: 'C:\\ProgramData', APPDATA: 'C:\\A' }, 'C:\\U')
  assert.equal(win.length, 2)
  assert.ok(win.every((f) => f.includes('CameraProfiles')))
  assert.deepEqual(adobeFolders('linux', {}, '/home/sam'), [])
  assert.equal(namedFor('/x/Canon EOS 200D Adobe Standard.dcp', ['Canon EOS 200D']), true)
  assert.equal(namedFor('/x/Canon EOS 200D Camera Faithful.dcp', ['canon eos 200d']), true)
  // Another body whose name starts the same is not this one.
  assert.equal(namedFor('/x/Canon EOS 2000D Adobe Standard.dcp', ['Canon EOS 200D']), false)
  assert.equal(namedFor('/x/Pentax K200D Adobe Standard.dcp', ['Canon EOS 200D']), false)
  assert.equal(profileId(new Uint8Array([1, 2, 3])).length, 8)
})

test('an imported profile is kept as JSON, known again next run, and found in Adobe’s folders', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcp-'))
  try {
    const adobe = join(dir, 'adobe')
    mkdirSync(join(adobe, 'Camera', 'Canon EOS 200D'), { recursive: true })
    mkdirSync(join(adobe, 'Adobe Standard'), { recursive: true })
    writeFileSync(join(adobe, 'Adobe Standard', 'Canon EOS 200D Adobe Standard.dcp'), 'std')
    writeFileSync(
      join(adobe, 'Camera', 'Canon EOS 200D', 'Canon EOS 200D Camera Faithful.dcp'),
      'f'
    )
    writeFileSync(join(adobe, 'Adobe Standard', 'Canon EOS R5 Adobe Standard.dcp'), 'r5')
    const mine = join(dir, 'mine.dcp')
    writeFileSync(mine, 'my profile')
    const read: string[] = []
    // A stand-in engine: each file's text names its profile.
    const engine = {
      readCameraProfile: async (bytes: Uint8Array) => {
        const text = Buffer.from(bytes).toString()
        read.push(text)
        return profile({
          name: text === 'std' ? 'Adobe Standard' : text === 'f' ? 'Camera Faithful' : 'Mine',
          unique_camera_model: text === 'r5' ? 'Canon EOS R5' : 'Canon EOS 200D'
        })
      }
    } as unknown as ConstructorParameters<typeof CameraProfiles>[1]
    const store = join(dir, 'store')
    const profiles = new CameraProfiles(store, engine, [adobe])
    const kept = await profiles.import(mine)
    assert.match(kept.id, /^[0-9a-f]{8}$/)
    assert.equal(kept.file, 'mine.dcp')
    assert.deepEqual(readdirSync(store), [`${kept.id}.json`])
    // Known to the develop at once, and to the next run.
    assert.equal(rawColourLabel(cam(), `dcp:${kept.id}`), 'Mine')
    const again = new CameraProfiles(store, engine, [adobe])
    again.load()
    assert.equal(again.get(kept.id)?.profile.name, 'Mine')
    assert.deepEqual(
      again.forCamera(cam()).map((k) => k.id),
      [kept.id]
    )
    assert.deepEqual(again.forCamera(cam('Canon', 'EOS R5')), [])
    // Adobe's for this body: the R5's file never read.
    read.length = 0
    const found = await again.adobe(cam())
    assert.deepEqual(
      found.map((f) => f.name),
      ['Adobe Standard', 'Camera Faithful']
    )
    assert.ok(!read.includes('r5'))
    // Asked again (every open of a photo asks): nothing is read twice.
    read.length = 0
    await again.adobe(cam())
    assert.deepEqual(read, [])
    // The renderer may name only a file found there.
    assert.equal(
      await again.isAdobe(join(adobe, 'Adobe Standard', 'Canon EOS 200D Adobe Standard.dcp')),
      true
    )
    assert.equal(await again.isAdobe(mine), false)
    assert.equal(await again.isAdobe('/etc/passwd'), false)
    // Imported once, the same file is the same profile.
    assert.equal((await again.import(mine)).id, kept.id)
    // What cannot be a profile is never read: a folder.
    read.length = 0
    await assert.rejects(again.import(adobe), NotAProfile)
    assert.deepEqual(read, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a sidecar carries the profile its colour names, and only then', async () => {
  const { emptySidecar, readSidecar, writeSidecar } = await import('../src/main/sidecar')
  const dir = mkdtempSync(join(tmpdir(), 'dcp-side-'))
  try {
    const photo = join(dir, 'x.CR2')
    writeSidecar(photo, {
      ...emptySidecar(),
      rawColour: 'dcp:0a1b2c3d',
      rawColourChosen: true,
      cameraProfile: profile()
    })
    const back = readSidecar(photo, true).sidecar
    assert.equal(back.rawColour, 'dcp:0a1b2c3d')
    assert.deepEqual(back.cameraProfile, profile())
    // Another colour: no profile is written.
    writeSidecar(photo, { ...emptySidecar(), rawColour: 'pixl:1', cameraProfile: profile() })
    assert.equal(readSidecar(photo, true).sidecar.cameraProfile, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the index keeps a chosen profile with the photo, and a new index reads it from the sidecar', async () => {
  const { IndexService } = await import('../src/main/indexer/service')
  const root = mkdtempSync(join(tmpdir(), 'dcp-index-'))
  const folder = join(root, 'photos')
  mkdirSync(folder)
  writeFileSync(join(folder, 'b.CR2'), 'not really a photo')
  const xmp = { read: async () => null, write: async () => undefined, end: async () => undefined }
  const open = (n: number): InstanceType<typeof IndexService> =>
    new IndexService({ userData: join(root, `userData-${n}`), emit: () => {}, xmp })
  const a = open(1)
  let b: InstanceType<typeof IndexService> | null = null
  try {
    const [item] = await a.listFolder(folder)
    const json = JSON.stringify(profile({ name: 'Carried' }))
    a.setCameraProfile('99aa88bb', json)
    a.setRawColour(item.photoId, 'dcp:99aa88bb', true)
    // Chosen: written to the photo's sidecar, the profile with it.
    const { readSidecar } = await import('../src/main/sidecar')
    const side = readSidecar(join(folder, 'b.CR2'), true).sidecar
    assert.equal(side.rawColour, 'dcp:99aa88bb')
    assert.equal(side.cameraProfile?.name, 'Carried')
    // Another machine's index: the profile comes in with the sidecar.
    b = open(2)
    await b.listFolder(folder)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(readProfile(b.cameraProfile('99aa88bb'))?.name, 'Carried')
    // Another profile chosen: the sidecar carries that one, not the first.
    a.setCameraProfile('cc11dd22', JSON.stringify(profile({ name: 'Second' })))
    a.setRawColour(item.photoId, 'dcp:cc11dd22', true)
    const now = readSidecar(join(folder, 'b.CR2'), true).sidecar
    assert.equal(now.rawColour, 'dcp:cc11dd22')
    assert.equal(now.cameraProfile?.name, 'Second')
    // A profile the index holds stands against one a sidecar carries for its id.
    b.setCameraProfile('cc11dd22', JSON.stringify(profile({ name: 'Held' })))
    await b.listFolder(folder)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(readProfile(b.cameraProfile('cc11dd22'))?.name, 'Held')
    // Nonsense is not kept.
    b.setCameraProfile('nothex!!', json)
    b.setCameraProfile('12345678', '{"name":"x"}')
    assert.equal(b.cameraProfile('12345678'), null)
  } finally {
    a.close()
    b?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

/** The native engine, where it is built (not in CI: this check skips). */
const engine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      readCameraProfile(bytes: Uint8Array): DcpProfile
    }
  } catch {
    return null
  }
})()

/** One of Adobe's profiles, where Adobe's installer put them on this machine. */
const adobeProfile = (() => {
  for (const f of adobeFolders()) {
    const std = join(f, 'Adobe Standard')
    if (!existsSync(std)) continue
    const file = readdirSync(std).find((n) => n.endsWith('.dcp'))
    if (file) return join(std, file)
  }
  return null
})()

test(
  'the engine reads one of Adobe’s profiles into the shape Playroom keeps',
  {
    skip:
      engine === null
        ? 'the engine is not built for this platform'
        : adobeProfile === null
          ? 'no Adobe camera profiles on this machine'
          : false
  },
  async () => {
    const { readFileSync } = await import('node:fs')
    const p = engine!.readCameraProfile(readFileSync(adobeProfile!))
    assert.deepEqual(readProfile(JSON.stringify(p)), p)
    assert.equal(p.name, 'Adobe Standard')
    assert.ok(p.unique_camera_model)
  }
)

test('the white under a profile is read off a small binned develop the engine takes', async () => {
  const { profileWhiteRequest } = await import('../src/main/source')
  const info = { input: 'Raw' as const, width: 6288, height: 4056, gain_map: null }
  const r = profileWhiteRequest('/photos/x.CR2', info, 'dcp:0a1b2c3d', 2)
  assert.equal(r.sink, 'Bytes')
  // Pixels state their colour in the report: the engine refuses them without ICC.
  assert.deepEqual(r.encode, { Pixels: { sample: 'F32' } })
  assert.equal(r.metadata.icc, true)
  const scene = (r.raw as { Scene: { resolution: unknown; colour: unknown } }).Scene
  assert.ok(
    typeof scene.resolution === 'object' && scene.resolution && 'Binned' in scene.resolution
  )
  assert.ok(typeof scene.colour === 'object' && scene.colour && 'Dcp' in scene.colour)
})

/** A RAW of a body Adobe's installer left a profile for: `PIXL_DCP_RAW` (not in CI). */
const dcpRaw = process.env['PIXL_DCP_RAW'] ?? null

test(
  'the engine develops a RAW under an Adobe profile and says what ran',
  {
    skip:
      engine === null
        ? 'the engine is not built for this platform'
        : dcpRaw === null || !existsSync(dcpRaw)
          ? 'set PIXL_DCP_RAW to a RAW whose body has an Adobe profile here'
          : false
  },
  async () => {
    const { readFileSync } = await import('node:fs')
    const { profileWhiteRequest } = await import('../src/main/source')
    const e = engine as unknown as {
      probe(path: string): Promise<SourceInfo>
      convert(r: unknown): Promise<{
        raw: { white_temperature_kelvin: number; white_tint: number; profile_tables: string | null }
      }>
      readCameraProfile(bytes: Uint8Array): DcpProfile
    }
    const info = await e.probe(dcpRaw!)
    const cc = info.camera_colour!
    const file = adobeFolders()
      .map((f) => join(f, 'Adobe Standard', `${cc.make} ${cc.model} Adobe Standard.dcp`))
      .find((f) => existsSync(f))
    if (!file) return
    registerDcp('feedf00d', e.readCameraProfile(readFileSync(file)))
    const report = await e.convert(profileWhiteRequest(dcpRaw!, info, 'dcp:feedf00d', 2))
    assert.ok(Number.isFinite(report.raw.white_temperature_kelvin))
    assert.ok(Number.isFinite(report.raw.white_tint))
    assert.match(report.raw.profile_tables ?? '', /Adobe Standard/)
  }
)
