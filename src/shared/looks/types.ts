/**
 * Looks: the presets PIXL ships, gathered into collections, searchable, and
 * written so they can one day travel (the marketplace's payload, see
 * `LookFile` later). A look is a preset whose `fields` say which sliders it
 * sets; `meta` says where it sits, what it is like and what inspired it.
 *
 * Names are our own. A camera maker, a film stock or a film appears only as
 * `inspiredBy`, a reference for search and the browser's detail line.
 */
import type { Preset } from '../ipc'

/** The shape a look file is in; a reader refuses a newer one. */
export const LOOK_SCHEMA = 1

/** Where a look comes from. Community looks are the marketplace's (later). */
export type LookAuthor =
  { kind: 'pixl' } | { kind: 'user' } | { kind: 'community'; id: string; name: string }

/** What a look stands in for with the sliders we have, until the engine can do it. */
export type LookApproximation = 'halation' | 'bloom' | 'chromaGrain' | 'selectiveColour' | 'hueSwap'

export interface LookMeta {
  /** A `COLLECTIONS` id (`collections.ts`). */
  collection: string
  /** Lower-case search words, the `inspiredBy` source's among them. */
  tags: string[]
  description?: string
  /** What the look is modelled on, as plain text ("Fujifilm Classic Chrome"). */
  inspiredBy?: string
  author: LookAuthor
  /** Bumped whenever the look is retuned. */
  version: number
  approximates?: LookApproximation[]
}

/** A look PIXL ships: built in, partial (its `fields`), and described. */
export type Look = Preset & { builtin: true; fields: string[][]; meta: LookMeta }
