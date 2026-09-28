/**
 * What the library can show — a folder, a collection, a keyword, the
 * duplicates — named for the identity bar and arranged for the sidebar.
 * Pure, so the tests can hold it to its word.
 */
import type { Collection, LibrarySource } from '../../../shared/ipc'
import { keywordLabel } from '../../../shared/keywords'

/** What a thumbnail carries when dragged: the keys of the photos it stands for. */
export const KEYS_MIME = 'application/x-playroom-keys'

/** The last part of a path: a folder's own name. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function sameSource(a: LibrarySource | null, b: LibrarySource | null): boolean {
  if (!a || !b) return a === b
  switch (a.kind) {
    case 'folder':
      return b.kind === 'folder' && a.path === b.path
    case 'collection':
      return b.kind === 'collection' && a.id === b.id
    case 'keyword':
      return b.kind === 'keyword' && a.path === b.path
    case 'duplicates':
      return b.kind === 'duplicates' && a.folder === b.folder && a.threshold === b.threshold
  }
}

/** The source as a trail of names: its kind, the sets it sits in, its own name. */
export function sourceTrail(src: LibrarySource, collections: Collection[]): string[] {
  switch (src.kind) {
    case 'folder':
      return [folderName(src.path)]
    case 'keyword':
      return ['Keywords', ...keywordLabel(src.path).split(' › ')]
    case 'duplicates':
      return ['Duplicates', src.folder ? folderName(src.folder) : 'Whole library']
    case 'collection': {
      const byId = new Map(collections.map((c) => [c.id, c]))
      const trail: string[] = []
      const seen = new Set<string>()
      for (let c = byId.get(src.id); c && !seen.has(c.id); c = byId.get(c.parent ?? '')) {
        seen.add(c.id)
        trail.unshift(c.name)
      }
      return ['Collections', ...(trail.length ? trail : ['(removed)'])]
    }
  }
}

export interface CollectionNode {
  collection: Collection
  children: CollectionNode[]
}

const bySortThenName = (a: Collection, b: Collection): number =>
  a.sort - b.sort || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * Collections as the sidebar shows them: sets hold their children, each
 * level sets first then by `sort` and name. A collection whose parent is
 * gone (or is not a set) sits at the top.
 */
export function collectionTree(list: Collection[]): CollectionNode[] {
  const sets = new Set(list.filter((c) => c.kind === 'set').map((c) => c.id))
  const kids = new Map<string | null, Collection[]>()
  for (const c of list) {
    const parent = c.parent && sets.has(c.parent) && c.parent !== c.id ? c.parent : null
    const at = kids.get(parent)
    if (at) at.push(c)
    else kids.set(parent, [c])
  }
  const seen = new Set<string>()
  const build = (parent: string | null): CollectionNode[] =>
    (kids.get(parent) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => Number(b.kind === 'set') - Number(a.kind === 'set') || bySortThenName(a, b))
      .map((c) => {
        seen.add(c.id)
        return { collection: c, children: c.kind === 'set' ? build(c.id) : [] }
      })
  return build(null)
}

/** The sets a collection may be put in: every set except itself and those inside it. */
export function setsFor(list: Collection[], id: string | undefined): Collection[] {
  const inside = new Set<string>()
  if (id) {
    inside.add(id)
    let grew = true
    while (grew) {
      grew = false
      for (const c of list)
        if (c.parent && inside.has(c.parent) && !inside.has(c.id)) {
          inside.add(c.id)
          grew = true
        }
    }
  }
  return list.filter((c) => c.kind === 'set' && !inside.has(c.id)).sort(bySortThenName)
}
