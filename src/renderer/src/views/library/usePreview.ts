/**
 * The Library's larger pictures as the views ask for them (main/previews.ts
 * makes and keeps them): a photo's screen preview, its 1:1, and the photos
 * either side made ahead. A photo is named by its key and its thumbnail's
 * address, which changes with every edit. Only an answer on its way is
 * shared here: main keeps the pictures (and may let one go under its cap),
 * so each showing asks it, which costs a look at the folder.
 */
import { useEffect, useState } from 'react'
import type { FocusPicture, LibraryItem, LibraryPreview } from '../../../../shared/ipc'
import { api } from '../../lib/api'

type Answer = LibraryPreview | 'failed'

/** main/previews.ts's word for a preview dropped because the view moved on (not a failure). */
const DROPPED = 'preview dropped'

const previews = new Map<string, Promise<Answer>>()
const focuses = new Map<string, Promise<FocusPicture>>()

/** A photo's picture as it is now: its key and the thumbnail's address (its stamp). */
const idOf = (item: LibraryItem): string => `${item.key}|${item.thumbUrl ?? ''}|${item.edited}`

/** `ask`'s answer, shared by everyone asking for `id` while it is on its way. */
function once<T>(map: Map<string, Promise<T>>, id: string, ask: () => Promise<T>): Promise<T> {
  let p = map.get(id)
  if (!p) {
    p = ask()
    map.set(id, p)
    const forget = (): void => {
      if (map.get(id) === p) map.delete(id)
    }
    p.then(forget, forget)
  }
  return p
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
    once(previews, id, () =>
      api.library.preview(item.key).catch((err: unknown): Answer => {
        // Dropped (the view moved on before it was made): the thumbnail stays, quietly.
        if (String((err as Error)?.message ?? err).includes(DROPPED)) throw err
        return 'failed'
      })
    ).then(
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

/** A photo's 1:1. */
export function focusOf(item: LibraryItem): Promise<FocusPicture> {
  return once(focuses, idOf(item), () => api.library.focus(item.key))
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
