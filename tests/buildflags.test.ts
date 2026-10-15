import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { DEV_BUILD, devEnv, REMOTE_DEBUGGING_SWITCHES, refusesSwitches } from '../src/main/build'

test('a release build refuses remote debugging; a development build allows it', () => {
  const has =
    (...names: string[]) =>
    (n: string): boolean =>
      names.includes(n)
  for (const s of REMOTE_DEBUGGING_SWITCHES) assert.equal(refusesSwitches(has(s), false), true, s)
  assert.equal(refusesSwitches(has('lang', 'force-device-scale-factor'), false), false)
  assert.equal(refusesSwitches(has('remote-debugging-port'), true), false)
})

test('without a bundler (tests) the build is a development one, and the switches are read', () => {
  assert.equal(DEV_BUILD, true)
  process.env.PLAYROOM_TEST_SWITCH = 'on'
  assert.equal(devEnv('PLAYROOM_TEST_SWITCH'), 'on')
  delete process.env.PLAYROOM_TEST_SWITCH
})

test('no main-process code decides what a release trusts by how it runs', () => {
  // The development root and the gate's skip follow the build (build.ts), not app.isPackaged.
  const licence = readFileSync(new URL('../src/main/licence.ts', import.meta.url), 'utf8')
  assert.match(licence, /roots: DEV_BUILD \?/)
  const gate = readFileSync(new URL('../src/main/gate.ts', import.meta.url), 'utf8')
  assert.match(gate, /DEV_BUILD && \(!app\.isPackaged \|\| HIDDEN\)/)
  // The automation and feed switches go through devEnv everywhere.
  for (const f of ['index', 'app', 'paths', 'policy', 'updater', 'crash', 'licence', 'gate']) {
    const src = readFileSync(new URL(`../src/main/${f}.ts`, import.meta.url), 'utf8')
    assert.doesNotMatch(
      src,
      /process\.env\[?['.]?(PLAYROOM_HIDDEN|PLAYROOM_USER_DATA|PLAYROOM_UPDATE_URL|PLAYROOM_POLICY_URL)/,
      f
    )
  }
  const config = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')
  assert.match(config, /__DEV__: JSON\.stringify\(DEV_BUILD\)/)
})
