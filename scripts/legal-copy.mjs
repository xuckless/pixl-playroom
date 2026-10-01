// The beta terms the app ships with (Help → Beta Terms, Settings, the beta
// gate), so the version a tester ran is always on hand, offline too. The
// text lives in pixl-web (src/legal/beta.md, the page at /legal/beta/); this
// turns it into plain text in build/legal/beta-terms.txt, which is committed
// and packaged (electron-builder.yml extraResources).
//
//   node scripts/legal-copy.mjs [path to pixl-web]   (default ../pixl-web)
//   node scripts/legal-copy.mjs --check [path]       fails if the copy is stale
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build', 'legal', 'beta-terms.txt')
const SITE = 'https://playroom.pixlfoundation.com'

/** Markdown (the subset the legal pages use) as plain text, wrapped at 78 columns. */
export function legalText(md) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)
  if (!fm) throw new Error('no front matter')
  const meta = Object.fromEntries(
    fm[1]
      .split('\n')
      .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()])
  )
  const inline = (s) =>
    s
      // Links: the text, then the address (made absolute) unless the text is it.
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
        const url = href.startsWith('/') ? SITE + href : href.replace(/^mailto:/, '')
        return text === url || text === href.replace(/^mailto:/, '') ? text : `${text} (${url})`
      })
      .replace(/\*\*([^*]+)\*\*/g, '$1')
  const wrap = (text, indent = '', first = indent) => {
    const words = text.split(/\s+/).filter(Boolean)
    const lines = []
    let line = first
    let fresh = true
    for (const w of words) {
      if (!fresh && (line + ' ' + w).length > 78) {
        lines.push(line)
        line = indent + w
      } else line = fresh ? line + w : `${line} ${w}`
      fresh = false
    }
    if (!fresh) lines.push(line)
    return lines.join('\n')
  }
  const title = `PIXL PLAYROOM ${meta.title.toUpperCase()}`
  const out = [title, `Version ${meta.version}, updated ${meta.updated}`, `${SITE}/legal/beta/`, '']
  for (const block of md.slice(fm[0].length).split(/\n{2,}/)) {
    const b = block.trim()
    if (!b) continue
    const h = /^(#{1,3}) (.+)$/.exec(b)
    if (h) {
      out.push('', inline(h[2]).toUpperCase(), '')
      continue
    }
    if (/^- /m.test(b)) {
      for (const item of b.split(/\n(?=- )/))
        out.push(wrap(inline(item.replace(/^- /, '').replace(/\n\s*/g, ' ')), '    ', '  - '))
      out.push('')
      continue
    }
    out.push(wrap(inline(b.replace(/\n/g, ' '))), '')
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const web = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, '..', 'pixl-web'))
  const text = legalText(readFileSync(join(web, 'src', 'legal', 'beta.md'), 'utf8'))
  if (check) {
    let current = ''
    try {
      current = readFileSync(OUT, 'utf8')
    } catch {
      // none yet
    }
    if (current !== text) {
      console.error(
        `${OUT} is out of date with ${web}/src/legal/beta.md: run node scripts/legal-copy.mjs`
      )
      process.exit(1)
    }
    console.log('beta terms copy is up to date')
  } else {
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, text)
    console.log(`wrote ${OUT}`)
  }
}
