// A LibraryItem with every field filled, for the pure library modules' tests.
import type { LibraryItem } from '../src/shared/ipc'

export function item(over: Partial<LibraryItem> & { key: string }): LibraryItem {
  return {
    photoId: Number(over.key.split(':')[0]) || 1,
    copyId: null,
    copyName: null,
    path: `/photos/${over.name ?? 'IMG_0001.jpg'}`,
    name: 'IMG_0001.jpg',
    ext: 'jpg',
    size: 1000,
    mtime: 0,
    isRaw: false,
    rating: 0,
    flag: null,
    label: null,
    edited: false,
    thumbUrl: null,
    camera: {
      make: null,
      model: null,
      lens: null,
      iso: null,
      exposureTime: null,
      fNumber: null,
      focalLength: null,
      capturedAt: null,
      gps: null
    },
    folder: '/photos',
    title: null,
    caption: null,
    copyright: null,
    keywords: [],
    stack: null,
    ...over
  }
}
