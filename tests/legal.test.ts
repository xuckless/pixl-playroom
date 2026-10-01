import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error a plain .mjs script, without types
import { legalText } from '../scripts/legal-copy.mjs'

const md = `---
title: Beta terms
summary: x
updated: 2026-10-01
version: 2026-10
---

These terms cover the **Beta**. See our [Licence agreement](/legal/eula/) and write to [hello@pixlfoundation.com](mailto:hello@pixlfoundation.com).

## 1. Who may join

- one person, one account;
- **18 or older**.
`

test('the legal pages become plain text: a dated header, upper-case headings, links spelled out', () => {
  const text = (legalText as (s: string) => string)(md)
  assert.match(text, /^PIXL PLAYROOM BETA TERMS\nVersion 2026-10, updated 2026-10-01\n/)
  assert.match(text, /cover the Beta\./)
  assert.match(
    text,
    /Licence agreement\s\(https:\/\/playroom\.pixlfoundation\.com\/legal\/eula\/\)/
  )
  assert.match(text, /write to\shello@pixlfoundation\.com\./)
  assert.match(text, /\n1\. WHO MAY JOIN\n\n {2}- one person, one account;\n {2}- 18 or older\./)
  for (const line of text.split('\n')) assert.ok([...line].length <= 78, line)
})
