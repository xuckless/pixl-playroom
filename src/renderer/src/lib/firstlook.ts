/**
 * The photo at once while it opens (engine 0.21, OBS-1d; the owner,
 * 2026-10-14): the library's thumbnail straight away, and for an unedited
 * RAW its embedded preview at the stage's size as soon as main has decoded
 * it, marked "Developing…" until the develop's first picture lands, which
 * it cross-fades into. The camera's own rendering is never shown for an
 * edited photo: it would read as the edit.
 *
 * Pure, for tests/firstlook.test.ts; the develop store keeps the state.
 */
import type { LibraryItem } from '../../../shared/ipc'

/** How long the first look takes to fade into the develop's picture. */
export const FIRST_LOOK_FADE_MS = 150

export interface FirstLook {
  /** The photo it is of. */
  key: string
  url: string
  /** The camera's embedded preview, or the library's thumbnail. */
  from: 'preview' | 'thumbnail'
  /** The develop's picture landed: it is fading out over it. */
  leaving: boolean
}

type Item = Pick<LibraryItem, 'key' | 'thumbUrl' | 'isRaw' | 'edited'>

/** What an open shows first: the photo's thumbnail when it has one. */
export function lookOnOpen(key: string, item: Item | undefined): FirstLook | null {
  if (!item || item.key !== key || !item.thumbUrl) return null
  return { key, url: item.thumbUrl, from: 'thumbnail', leaving: false }
}

/** Whether to ask main for the embedded preview: an unedited RAW (or one the library has not listed). */
export function wantsPreview(item: Item | undefined): boolean {
  return !item || (item.isRaw && !item.edited)
}

/**
 * The embedded preview arrived for `key`: it replaces the thumbnail while
 * that photo is still opening and its picture has not landed.
 */
export function lookArrived(
  cur: FirstLook | null,
  key: string,
  url: string,
  opening: string | null,
  pictured: boolean
): FirstLook | null {
  if (pictured || opening !== key || cur?.leaving) return cur
  if (cur && cur.key !== key) return cur
  return { key, url, from: 'preview', leaving: false }
}

/** The develop's picture of `key` landed: the first look fades out over it. */
export function lookOnPicture(cur: FirstLook | null, key: string): FirstLook | null {
  if (!cur || cur.key !== key || cur.leaving) return cur
  return { ...cur, leaving: true }
}

/** The fade ended: the first look goes. */
export function lookFaded(cur: FirstLook | null, key: string): FirstLook | null {
  return cur && cur.key === key && cur.leaving ? null : cur
}
