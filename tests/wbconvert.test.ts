import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Store } from '../src/main/db'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import { convertWb, opOf, wbFromOp, type WbContext } from '../src/shared/wbconvert'

const RAW: WbContext = {
  isRaw: true,
  asShot: { x: 0.3363, y: 0.3491, temperature_kelvin: 5300, tint: 0.003 }
}
const JPEG: WbContext = { isRaw: false, asShot: null }

const custom = (temperature: number, tint: number): Recipe['wb'] => ({
  mode: 'custom',
  temperature,
  tint,
  preset: null
})

const close = (a: number, b: number, eps: number, what: string): void =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not within ${eps} of ${b}`)

test('RAW → JPEG → RAW comes back within 20 K', () => {
  for (const [k, t] of [
    [3200, 0],
    [4500, 12],
    [5300, 9],
    [6500, -20],
    [8000, 30]
  ]) {
    const jpeg = convertWb(custom(k, t), RAW, JPEG)
    assert.equal(jpeg.mode, 'custom')
    const back = convertWb(jpeg, JPEG, RAW)
    close(back.temperature, k, 20, `${k} K`)
    close(back.tint, t, 2, `tint ${t}`)
  }
})

test('same-kind conversion is the identity', () => {
  const a = custom(4800, 7)
  assert.equal(convertWb(a, RAW, RAW), a)
  const b = custom(-30, 15)
  assert.equal(convertWb(b, JPEG, JPEG), b)
})

test('wbFromOp undoes opOf on each kind', () => {
  for (const [ctx, wb] of [
    [RAW, custom(4200, -10)],
    [RAW, custom(7200, 25)],
    [JPEG, custom(-40, 12)],
    [JPEG, custom(35, -20)]
  ] as const) {
    const back = wbFromOp(opOf(wb, ctx), ctx)
    close(back.temperature, wb.temperature, 1, 'temperature')
    close(back.tint, wb.tint, 1, 'tint')
  }
})

test('a develop preset keeps its engine white through the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'playroom-wb-'))
  try {
    const store = Store.open(join(dir, 'playroom.db'))
    const recipe = { ...defaultRecipe(true), wb: custom(4300, 8) }
    const wbOp = opOf(recipe.wb, RAW)
    const base = { name: 'Warm', group: 'Mine', builtin: false, groups: ['whiteBalance' as const] }
    store.savePreset({ ...base, id: 'a', recipe, wbOp })
    store.savePreset({ ...base, id: 'b', name: 'Plain', recipe })
    const [a, b] = ['a', 'b'].map((id) => store.presets().find((p) => p.id === id))
    assert.deepEqual(a?.wbOp, wbOp)
    assert.equal(b?.wbOp, undefined)
    // Below the RAW's as-shot 5300 K is a cooler picture: negative on a JPEG.
    const onJpeg = wbFromOp(a!.wbOp!, JPEG)
    assert.ok(onJpeg.temperature < 0, `temperature ${onJpeg.temperature}`)
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
