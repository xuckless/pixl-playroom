import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import {
  handOffOpens,
  onOpenPaths,
  pathsFromArgv,
  queueOpen,
  rendererGone,
  takeHandOff,
  takeOpens
} from '../src/main/open'

function fixture(): { root: string; done(): void } {
  const root = mkdtempSync(join(tmpdir(), 'playroom-open-'))
  for (const f of ['a.CR2', 'b.jpg', 'c.Jpeg', 'notes.txt', 'noext'])
    writeFileSync(join(root, f), '')
  mkdirSync(join(root, 'shoot'))
  return { root, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('pathsFromArgv skips the executable and the app path', () => {
  const f = fixture()
  const exe = join(f.root, 'b.jpg')
  // Packaged: only the executable goes; in development the app path too.
  assert.deepEqual(pathsFromArgv([exe, join(f.root, 'a.CR2')], f.root, 1), [join(f.root, 'a.CR2')])
  assert.deepEqual(pathsFromArgv([exe, f.root, join(f.root, 'a.CR2')], '/', 2), [
    join(f.root, 'a.CR2')
  ])
  f.done()
})

test('pathsFromArgv drops switches', () => {
  const f = fixture()
  const argv = ['exe', '--allow-file-access-from-files', '-psn_0_123', 'b.jpg', '--', '-']
  assert.deepEqual(pathsFromArgv(argv, f.root, 1), [join(f.root, 'b.jpg')])
  f.done()
})

test('pathsFromArgv resolves relative paths against the cwd', () => {
  const f = fixture()
  const argv = ['exe', 'a.CR2', join('shoot', '..', 'b.jpg'), join(f.root, 'c.Jpeg')]
  assert.deepEqual(pathsFromArgv(argv, f.root, 1), [
    join(f.root, 'a.CR2'),
    join(f.root, 'b.jpg'),
    join(f.root, 'c.Jpeg')
  ])
  f.done()
})

test('pathsFromArgv keeps photos by extension, whatever the case', () => {
  const f = fixture()
  const argv = ['exe', 'notes.txt', 'noext', 'c.Jpeg', 'a.CR2']
  assert.deepEqual(pathsFromArgv(argv, f.root, 1), [join(f.root, 'c.Jpeg'), join(f.root, 'a.CR2')])
  f.done()
})

test('pathsFromArgv keeps folders, marked with a trailing separator', () => {
  const f = fixture()
  assert.deepEqual(pathsFromArgv(['exe', 'shoot', `shoot${sep}`], f.root, 1), [
    join(f.root, 'shoot') + sep
  ])
  f.done()
})

test('pathsFromArgv drops what does not exist', () => {
  const f = fixture()
  assert.deepEqual(pathsFromArgv(['exe', 'gone.CR2', join(f.root, 'gone')], f.root, 1), [])
  f.done()
})

test('opens queue until the renderer takes them, then go straight to it', () => {
  const sent: string[][] = []
  onOpenPaths((paths) => sent.push(paths))
  // Before the renderer's boot: queued, once each.
  queueOpen(['/a.jpg', '/a.jpg', '/b.jpg'])
  queueOpen([])
  assert.deepEqual(sent, [])
  assert.deepEqual(takeOpens(), ['/a.jpg', '/b.jpg'])
  assert.deepEqual(takeOpens(), [])
  // After it: pushed.
  queueOpen(['/c.jpg'])
  assert.deepEqual(sent, [['/c.jpg']])
  // A reload or a closed window queues again until the next boot.
  rendererGone()
  queueOpen(['/d.jpg'])
  assert.deepEqual(sent, [['/c.jpg']])
  assert.deepEqual(takeOpens(), ['/d.jpg'])
})

test('a relaunch hands its opens to the next process, once', () => {
  const f = fixture()
  const profile = join(f.root, 'profile')
  mkdirSync(profile)
  rendererGone()
  queueOpen([join(f.root, 'a.CR2'), join(f.root, 'gone.jpg')])
  handOffOpens(profile)
  // The next process, its renderer not up yet: what still exists, then nothing more.
  takeOpens()
  rendererGone()
  takeHandOff(profile)
  assert.deepEqual(takeOpens(), [join(f.root, 'a.CR2')])
  rendererGone()
  takeHandOff(profile)
  assert.deepEqual(takeOpens(), [])
  rendererGone()
  // A stale handoff (a relaunch that never came) is dropped.
  writeFileSync(
    join(profile, 'pending-opens.json'),
    JSON.stringify({ at: Date.now() - 3_600_000, paths: [join(f.root, 'b.jpg')] })
  )
  takeHandOff(profile)
  assert.deepEqual(takeOpens(), [])
  f.done()
})
