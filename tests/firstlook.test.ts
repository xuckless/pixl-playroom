/**
 * The photo at once while it opens (engine 0.21, OBS-1d): the thumbnail,
 * then an unedited RAW's embedded preview, gone when the develop's picture
 * lands (after its fade) or when the photo is left.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIRST_LOOK_FADE_MS,
  lookArrived,
  lookFaded,
  lookOnOpen,
  lookOnPicture,
  wantsPreview
} from '../src/renderer/src/lib/firstlook'

type Item = Parameters<typeof lookOnOpen>[1]
const item = (
  key: string,
  isRaw = true,
  edited = false,
  thumbUrl: string | null = 'thumb'
): NonNullable<Item> => ({ key, isRaw, edited, thumbUrl })

test('an open shows the thumbnail at once; only an unedited RAW asks for its preview', () => {
  assert.deepEqual(lookOnOpen('a', item('a')), {
    key: 'a',
    url: 'thumb',
    from: 'thumbnail',
    leaving: false
  })
  assert.equal(lookOnOpen('a', item('a', true, false, null)), null)
  assert.equal(lookOnOpen('a', undefined), null)
  assert.equal(lookOnOpen('a', item('b')), null)
  assert.equal(wantsPreview(item('a')), true)
  // The camera's rendering would read as the edit.
  assert.equal(wantsPreview(item('a', true, true)), false)
  assert.equal(wantsPreview(item('a', false)), false)
  // Not listed in the library: main decides.
  assert.equal(wantsPreview(undefined), true)
})

test('the preview replaces the thumbnail while the photo opens, never after its picture', () => {
  const thumb = lookOnOpen('a', item('a'))
  const preview = lookArrived(thumb, 'a', 'preview', 'a', false)
  assert.deepEqual(preview, { key: 'a', url: 'preview', from: 'preview', leaving: false })
  // No thumbnail yet: the preview alone.
  assert.equal(lookArrived(null, 'a', 'preview', 'a', false)?.url, 'preview')
  // The picture landed first, or another photo is opening: nothing changes.
  assert.equal(lookArrived(thumb, 'a', 'preview', 'a', true), thumb)
  assert.equal(lookArrived(null, 'a', 'preview', 'b', false), null)
  const other = lookOnOpen('b', item('b'))
  assert.equal(lookArrived(other, 'a', 'preview', 'a', false), other)
})

test('the first look fades out when the picture lands, and goes after the fade', () => {
  const look = lookArrived(null, 'a', 'preview', 'a', false)
  const leaving = lookOnPicture(look, 'a')
  assert.equal(leaving?.leaving, true)
  // A late preview does not bring it back.
  assert.equal(lookArrived(leaving, 'a', 'preview2', 'a', false), leaving)
  // Another photo's picture leaves it be.
  assert.equal(lookOnPicture(look, 'b'), look)
  assert.equal(lookFaded(leaving, 'a'), null)
  // Not faded until it is leaving, nor for another photo.
  assert.equal(lookFaded(look, 'a'), look)
  assert.equal(lookFaded(leaving, 'b'), leaving)
  assert.ok(FIRST_LOOK_FADE_MS >= 100 && FIRST_LOOK_FADE_MS <= 250)
})
