#!/usr/bin/env tsx
/**
 * Fold a Vite build into one self-contained page.
 *
 * The workbench is a normal React app; this exists only to inline its build
 * output — script, stylesheet and glyph data — into a single file that can be
 * published as an artifact, where there is no server to fetch from.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const OUT = 'out/workbench.html'

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('no build found — run `npm run build` first')
  process.exit(1)
}

let html = readFileSync(join(DIST, 'index.html'), 'utf8')
const glyphData = readFileSync('out/glyph-data.json', 'utf8')

// Vite emits hashed asset URLs; each is read off disk and pasted in place, so
// the published file depends on nothing it cannot carry itself.
let inlined = 0

html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (whole, src: string) => {
  const path = join(DIST, src.replace(/^\//, ''))
  if (!existsSync(path)) return whole
  inlined++
  // a literal `</script>` inside the bundle would close this tag early
  const code = readFileSync(path, 'utf8').replace(/<\/script>/g, '<\\/script>')
  return `<script type="module">${code}</script>`
})

html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  (whole, href: string) => {
    if (/^https?:/.test(href)) return whole // Google Fonts stays a link
    const path = join(DIST, href.replace(/^\//, ''))
    if (!existsSync(path)) return whole
    inlined++
    return `<style>${readFileSync(path, 'utf8')}</style>`
  },
)

// the app reads this when present and falls back to fetching otherwise
html = html.replace('</head>', `<script>window.__GLYPH_DATA__=${glyphData}</script></head>`)

mkdirSync('out', { recursive: true })
writeFileSync(OUT, html)
console.log(
  `wrote ${OUT} — ${(html.length / 1024).toFixed(0)} KB, ${inlined} assets inlined, ` +
    `${(glyphData.length / 1024).toFixed(0)} KB of outlines`,
)
