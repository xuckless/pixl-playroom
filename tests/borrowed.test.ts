import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listed, REPLACED_BY } from '../src/shared/borrowed'
import { pixlCpuAnswer, readSwitches } from '../src/shared/heavy'

test('a borrowed model PIXL’s own replaces leaves Settings’ list, unless downloaded', () => {
  const pixl = (id: string): boolean => id.startsWith('pixl-')
  const none = (): boolean => false
  for (const id of Object.keys(REPLACED_BY)) {
    assert.equal(listed(id, false, pixl), false, `${id} hidden where its PIXL model is offered`)
    assert.equal(listed(id, true, pixl), true, `${id} still listed while downloaded, to remove it`)
    assert.equal(listed(id, false, none), true, `${id} listed where no PIXL model is offered`)
  }
  // DemosaicNet stays: the develop when the PIXL demosaic is off or refused.
  assert.equal(listed('demosaicnet-bayer', false, pixl), true)
  assert.equal(listed('pixl-enhance-v1', false, pixl), true)
})

test('the answer about PIXL’s models on the processor is this computer’s, else ask', () => {
  assert.equal(readSwitches({}).pixlCpu.answer, 'ask')
  const s = readSwitches({ pixlCpu: { answer: 'no', machine: 'M2 Pro · 32 GB' } })
  assert.equal(pixlCpuAnswer(s, 'M2 Pro · 32 GB'), 'no')
  assert.equal(pixlCpuAnswer(s, 'Ryzen · 64 GB'), 'ask')
  assert.equal(readSwitches({ pixlCpu: { answer: 'maybe' } }).pixlCpu.answer, 'ask')
})
