import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorPayload, MAX_PROBLEM_LOG, problemPayload, scrub } from '../src/shared/crash'

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

const ABOUT = {
  version: '0.9.0',
  engine: '0.15.0',
  platform: 'darwin',
  arch: 'arm64',
  os: '25.0.0'
}

test('a problem report keeps the words, drops an empty email, and sends no log unless asked', () => {
  const p = problemPayload(
    { message: '  Export hangs at 90%  ', email: '  ', includeLog: false },
    ABOUT,
    'a log line',
    ['/Users/sam'],
    'T'
  )
  assert.deepEqual(p, { app: 'playroom', message: 'Export hangs at 90%', ...ABOUT, at: 'T' })
})

test("a problem report's log is the scrubbed end of the file, from a whole line", () => {
  const line = 'opened /Users/sam/Photos/IMG_1.CR3\n'
  const log = line.repeat(Math.ceil((MAX_PROBLEM_LOG * 1.5) / line.length))
  const p = problemPayload({ message: 'x', email: 'a@b.co', includeLog: true }, ABOUT, log, [
    '/Users/sam'
  ])
  assert.equal(p.email, 'a@b.co')
  assert.ok(p.log)
  assert.ok(p.log.length <= MAX_PROBLEM_LOG)
  assert.ok(p.log.startsWith('opened ~/Photos/IMG_1.CR3'))
  assert.ok(!p.log.includes('/Users/sam'))
})
