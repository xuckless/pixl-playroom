/**
 * Smart collections: a rule tree over what the library knows of each item.
 * Evaluated in memory, by the index host for a smart collection and by the
 * renderer's filter bar, so both agree on what a rule means.
 */

export type SmartField =
  | 'rating'
  | 'flag'
  | 'label'
  | 'edited'
  | 'kind'
  | 'ext'
  | 'name'
  | 'folder'
  | 'title'
  | 'caption'
  | 'keyword'
  | 'text'
  | 'camera'
  | 'lens'
  | 'iso'
  | 'focal'
  | 'aperture'
  | 'shutter'
  | 'captured'
  | 'collection'

export type SmartOp =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'gte'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'inLast'
  | 'isEmpty'
  | 'isNotEmpty'

export interface SmartRule {
  field: SmartField
  op: SmartOp
  value?: string | number | boolean | null | [number, number]
  /** For `inLast`. */
  unit?: 'days' | 'weeks' | 'months' | 'years'
}

export interface SmartGroup {
  match: 'all' | 'any' | 'none'
  rules: (SmartRule | SmartGroup)[]
}

export const isGroup = (r: SmartRule | SmartGroup): r is SmartGroup =>
  (r as SmartGroup).rules !== undefined
