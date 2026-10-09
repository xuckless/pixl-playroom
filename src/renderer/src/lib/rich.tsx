/**
 * A translated sentence with elements in it: `rich('Press {{key}} to
 * develop', { key: <kbd>D</kbd> })`. The sentence is translated whole (a
 * translator moves `{{key}}` where their language puts it); the elements go
 * where its placeholders land.
 */
import { Fragment, type ReactNode } from 'react'
import { t, type Values } from '../../../shared/i18n'

const MARK = '\u0001'

export function rich(text: string, nodes: Record<string, ReactNode>, values?: Values): ReactNode {
  const marks: Values = { ...values }
  for (const name of Object.keys(nodes)) marks[name] = `${MARK}${name}${MARK}`
  const parts = t(text, marks).split(MARK)
  // Odd parts are placeholder names.
  return parts.map((p, i) => <Fragment key={i}>{i % 2 ? nodes[p] : p}</Fragment>)
}
