/**
 * The rule editor's edits: a rule given another operator keeps what it can
 * of its value, in the shape the new operator reads (a pair for `between`,
 * a count and unit for `inLast`, a day for `before`/`after`).
 */
import {
  defaultRule,
  isGroup,
  SMART_FIELDS,
  type SmartGroup,
  type SmartOp,
  type SmartRule
} from '../../../shared/smart'

/** A local calendar day as `YYYY-MM-DD`. */
export function isoDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function withOp(rule: SmartRule, op: SmartOp, now = new Date()): SmartRule {
  if (op === rule.op) return rule
  const type = SMART_FIELDS[rule.field].type
  const v = rule.value
  if (type === 'date') {
    const today = isoDay(now)
    const monthAgo = new Date(now)
    monthAgo.setMonth(monthAgo.getMonth() - 1)
    const single = typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : today
    switch (op) {
      case 'inLast':
        return { field: rule.field, op, value: 30, unit: 'days' }
      case 'between':
        return {
          field: rule.field,
          op,
          value: typeof v === 'string' ? [v, v] : [isoDay(monthAgo), today]
        }
      case 'before':
      case 'after':
        return { field: rule.field, op, value: /^\d{4}-\d{2}-\d{2}$/.test(single) ? single : today }
      default:
        return { field: rule.field, op, value: null }
    }
  }
  if (op === 'between') {
    const n = Array.isArray(v) ? v : [Number(v) || 0, Number(v) || 0]
    return { field: rule.field, op, value: [Number(n[0]), Number(n[1])] }
  }
  if (Array.isArray(v)) return { field: rule.field, op, value: v[0] }
  return { ...rule, op }
}

/** A fresh rule for the editor's "Add rule". */
export const newRule = (): SmartRule => defaultRule('rating')

/** How many rules, at any depth. */
export function ruleCount(g: SmartGroup): number {
  return g.rules.reduce((n, r) => n + (isGroup(r) ? ruleCount(r) : 1), 0)
}
