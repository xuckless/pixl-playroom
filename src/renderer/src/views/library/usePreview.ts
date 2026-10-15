/**
 * The Library's larger pictures as the views ask for them (main/previews.ts
 * makes and keeps them): a photo's screen preview, its 1:1, and the photos
 * either side made ahead. Each answer is kept here for the session by the
 * photo and its thumbnail's address, which changes with every edit.
 */
import { useEffect, useState } from 'react'
import type { FocusPicture, LibraryItem, LibraryPreview } from '../../../../shared/ipc'
import { api } from '../../lib/api'

/** How many answers are kept (a few hundred photos looked at). */
const KEPT = 300

type Answer = LibraryPreview | 'failed'

/** main/previews.ts's word for a preview dropped because the view moved on (not a failure). */
const DROPPED = 'preview dropped'

const previews = new Map<string, Promise<Answer>>()
const focuses = new Map<string, Promise<FocusPicture>>()

/** A photo's picture as it is now: its key and the thumbnail's address (its stamp). */
const idOf = (item: LibraryItem): string => `${item.key}|${item.thumbUrl ?? ''}|${item.edited}`

function remember<T>(map: Map<string, T>, id: string, v: T): T {
  if (map.size >= KEPT) map.delete(map.keys().next().value!)
  map.set(id, v)
  return v
}

/** Whether a photo can have a larger picture at all (an offline or unreadable one cannot). */
export const previewable = (item: LibraryItem | undefined): item is LibraryItem =>
  !!item && !item.offline && !item.unreadable

/** A photo's screen preview: null while it comes, 'failed' when it cannot be made. */
export function usePreview(item: LibraryItem | undefined): Answer | null {
  const id = previewable(item) ? idOf(item) : null
  const [got, setGot] = useState<{ id: string; v: Answer } | null>(null)
  useEffect(() => {
    if (!id || !item) return
    let live = true
    let p = previews.get(id)
    if (!p) {
      p = api.library
        .preview(item.key)
        .catch((err: unknown): Answer | null =>
          // Dropped (the view moved on before it was made): the thumbnail stays, quietly.
          String((err as Error)?.message ?? err).includes(DROPPED) ? null : 'failed'
        )
        .then((v) => v ?? Promise.reject(new Error(DROPPED)))
      remember(previews, id, p)
      // A failure (or a drop) is asked again next time the photo is shown.
      void p.then(
        (v) => v === 'failed' && previews.delete(id),
        () => previews.delete(id)
      )
    }
    p.then(
      (v) => live && setGot({ id, v }),
      () => undefined
    )
    return () => {
      live = false
    }
    // The item's other fields (its rating) never change its picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return got && got.id === id ? got.v : null
}

/** A photo's 1:1 (asked for once per photo and edit). */
export function focusOf(item: LibraryItem): Promise<FocusPicture> {
  const id = idOf(item)
  let p = focuses.get(id)
  if (!p) {
    p = api.library.focus(item.key)
    remember(focuses, id, p)
    p.catch(() => focuses.delete(id))
  }
  return p
}

/**
 * The photos either side of `key` (two each way) made ahead; `shown` are on
 * screen. A graded preview still waiting for any other photo is dropped.
 */
export function warmAround(
  order: readonly string[],
  key: string | null,
  shown: readonly string[]
): void {
  const i = key ? order.indexOf(key) : -1
  const near =
    i < 0
      ? []
      : [order[i + 1], order[i - 1], order[i + 2], order[i - 2]].filter((k): k is string => !!k)
  void api.library.warmPreviews(near, [...shown]).catch(() => undefined)
}
