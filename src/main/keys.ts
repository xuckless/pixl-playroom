/** An item's key: `<photo id>` for the photo itself, `<photo id>:<copy id>` for a virtual copy. */

export function parseKey(key: string): { photoId: number; copyId: string | null } {
  const [id, copy] = key.split(':')
  return { photoId: Number(id), copyId: copy ?? null }
}

export function keyOf(photoId: number, copyId: string | null): string {
  return copyId === null ? String(photoId) : `${photoId}:${copyId}`
}
