import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorPayload, scrub } from '../src/shared/crash'

test('a report never carries the home folder, in either slash direction', () => {
  const mac = 'Error: ENOENT /Users/alex/Pictures/IMG_1.CR2\n    at open (/Users/alex/app.js:1:2)'
  assert.equal(
    scrub(mac, ['/Users/alex']),
    'Error: ENOENT ~/Pictures/IMG_1.CR2\n    at open (~/app.js:1:2)'
  )
  const win = String.raw`C:\Users\Alex\Pictures\a.jpg and c:/users/alex/b.jpg`
  assert.equal(scrub(win, [String.raw`C:\Users\Alex`]), String.raw`~\Pictures\a.jpg and ~/b.jpg`)
})

test('file URLs keep only their file name', () => {
  assert.equal(
    scrub('at file:///Applications/Playroom.app/x/index.js:3', []),
    'at file://…/index.js:3'
  )
  assert.equal(scrub("load 'file:///opt/app/renderer.js'", []), "load 'file://…/renderer.js'")
})

test('a root or empty home is ignored rather than scrubbing every slash', () => {
  assert.equal(scrub('/usr/lib/x', ['/', '']), '/usr/lib/x')
})

test('long text is cut, and the payload is scrubbed and stamped', () => {
  assert.ok(scrub('x'.repeat(20_000), []).length <= 8_001)
  const p = errorPayload(
    {
      kind: 'main',
      message: 'boom in /home/sam/photos',
      stack: 'at /home/sam/app.js',
      version: '1.0.0',
      platform: 'linux',
      arch: 'x64',
      at: '2026-09-29T00:00:00.000Z'
    },
    ['/home/sam']
  )
  assert.equal(p.message, 'boom in ~/photos')
  assert.equal(p.stack, 'at ~/app.js')
  assert.equal(p.at, '2026-09-29T00:00:00.000Z')
})
