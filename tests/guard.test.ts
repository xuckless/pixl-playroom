import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appPage, externalAllowed } from '../src/main/guard'

const PAGE =
  'file:///Applications/Pixl%20Playroom.app/Contents/Resources/app.asar/out/renderer/index.html'

test('the packaged page, with or without a hash, is the app', () => {
  const isApp = appPage(PAGE)
  assert.equal(isApp(PAGE), true)
  assert.equal(isApp(`${PAGE}#/develop`), true)
  assert.equal(isApp(`${PAGE}?x=1`), true)
})

test('any other page, file or origin is not', () => {
  const isApp = appPage(PAGE)
  assert.equal(isApp(undefined), false)
  assert.equal(isApp(''), false)
  assert.equal(isApp('not a url'), false)
  assert.equal(isApp('file:///tmp/evil.html'), false)
  assert.equal(isApp(PAGE.replace('index.html', 'other.html')), false)
  assert.equal(isApp('https://pixlfoundation.com/'), false)
  assert.equal(isApp('pixl://c/thumb.jpg'), false)
  assert.equal(isApp('about:blank'), false)
})

test('under pnpm dev, the dev server origin is the app, and the file is not', () => {
  const isApp = appPage(PAGE, 'http://localhost:5173/')
  assert.equal(isApp('http://localhost:5173/'), true)
  assert.equal(isApp('http://localhost:5173/index.html#/library'), true)
  assert.equal(isApp('http://localhost:5174/'), false)
  assert.equal(isApp('http://127.0.0.1:5173/'), false)
  assert.equal(isApp(PAGE), false)
})

test('links open only to our sites and the checkout, over https', () => {
  assert.equal(externalAllowed('https://pixlfoundation.com/account/'), true)
  assert.equal(externalAllowed('https://playroom.pixlfoundation.com/#pricing'), true)
  assert.equal(externalAllowed('https://pixl.lemonsqueezy.com/checkout/buy/abc'), true)
  assert.equal(externalAllowed('http://pixlfoundation.com/'), false)
  assert.equal(externalAllowed('https://pixlfoundation.com.evil.example/'), false)
  assert.equal(externalAllowed('https://evilpixlfoundation.com/'), false)
  assert.equal(externalAllowed('https://user:pw@pixlfoundation.com/'), false)
  assert.equal(externalAllowed('file:///etc/passwd'), false)
  assert.equal(externalAllowed('javascript:alert(1)'), false)
  assert.equal(externalAllowed('smb://host/share'), false)
  assert.equal(externalAllowed('nonsense'), false)
})
