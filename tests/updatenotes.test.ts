// The update feed's release notes (shared/releasenotes.ts): written as
// Markdown at build time, read back by an installed build before updating.
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('the notes round-trip through the feed’s Markdown', async () => {
  const { RELEASE_NOTES, releaseNotesMarkdown, parseReleaseNotes } =
    await import('../src/shared/releasenotes')
  for (const n of RELEASE_NOTES) {
    const back = parseReleaseNotes(releaseNotesMarkdown(n), n.version)
    assert.deepEqual(back, n, n.version)
  }
})

test('0.4.0-beta says where local AI stands, and what is coming (a cookie too)', async () => {
  const { RELEASE_NOTES } = await import('../src/shared/releasenotes')
  const n = RELEASE_NOTES.find((x) => x.version === '0.4.0-beta')!
  assert.ok(n.sections.some((s) => /local AI/i.test(s.title)))
  assert.ok(!JSON.stringify(n).includes('Gemma'), 'no held model named')
  const next = (n.next ?? []).map((x) => x.title).join(' | ')
  assert.match(next, /language models/)
  assert.match(next, /MCP/)
  assert.match(next, /cookie/i)
})

test('a feed with other notes still reads: a list, HTML, plain text, nothing', async () => {
  const { parseReleaseNotes } = await import('../src/shared/releasenotes')
  assert.equal(parseReleaseNotes(null, '1.0.0'), null)
  assert.equal(parseReleaseNotes('', '1.0.0'), null)
  const html = parseReleaseNotes(
    '<p>Faster.</p><h2>Fixes</h2><ul><li>A</li><li>B &amp; C</li></ul>',
    '1.0.0'
  )!
  assert.equal(html.headline, 'Faster.')
  assert.deepEqual(html.sections, [{ title: 'Fixes', items: ['A', 'B & C'] }])
  const list = parseReleaseNotes(
    [
      { version: '1.0.0', note: 'One.\n\n- a' },
      { version: '0.9.0', note: 'Old.' }
    ],
    '1.0.0'
  )!
  assert.equal(list.headline, 'One.')
  assert.deepEqual(list.sections[0].items, ['a'])
  assert.equal(parseReleaseNotes('Just a line.', '1.0.0')!.headline, 'Just a line.')
})
