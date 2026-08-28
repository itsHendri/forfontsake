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
let fontsInlined = 0

html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (whole, src: string) => {
  const path = join(DIST, src.replace(/^\//, ''))
  if (!existsSync(path)) return whole
  inlined++
  // a literal `</script>` inside the bundle would close this tag early
  const code = readFileSync(path, 'utf8').replace(/<\/script>/g, '<\\/script>')
  return `<script type="module">${code}</script>`
})

/**
 * The preview font subsets carry the metrics the specimen field types on, so a
 * published page without them puts the caret in the wrong place. They are a few
 * KB each, which is worth spending to keep the page self-contained.
 */
function inlineFonts(css: string): string {
  return css.replace(/url\(\s*["']?(\/fonts\/[^"')]+\.woff2)["']?\s*\)/g, (whole, ref: string) => {
    const path = join('public', ref.replace(/^\//, ''))
    if (!existsSync(path)) {
      console.warn(`  missing ${ref} — the published caret will drift on that font`)
      return whole
    }
    fontsInlined++
    return `url(data:font/woff2;base64,${readFileSync(path).toString('base64')})`
  })
}

html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  (whole, href: string) => {
    if (/^https?:/.test(href)) return whole // Google Fonts stays a link
    const path = join(DIST, href.replace(/^\//, ''))
    if (!existsSync(path)) return whole
    inlined++
    return `<style>${inlineFonts(readFileSync(path, 'utf8'))}</style>`
  },
)

/**
 * The exporter rewrites the original font, so the published page needs the
 * original bytes. Fetching them is impossible with no server, and a download
 * button that cannot download is the exact failure this project exists to
 * avoid — so they ride along, keyed by the path the app would have fetched.
 */
const sources: Record<string, string> = {}
let sourceBytes = 0
for (const font of Object.values(JSON.parse(glyphData) as Record<string, { src?: string }>)) {
  if (!font.src) continue
  const path = join('public', font.src.replace(/^\//, ''))
  if (!existsSync(path)) {
    console.warn(`  missing ${font.src} — the published page cannot export that font`)
    continue
  }
  const bytes = readFileSync(path)
  sourceBytes += bytes.length
  sources[font.src] = `data:font/ttf;base64,${bytes.toString('base64')}`
}

// the app reads these when present and falls back to fetching otherwise
html = html.replace(
  '</head>',
  `<script>window.__GLYPH_DATA__=${glyphData};window.__FONT_SOURCES__=${JSON.stringify(sources)}</script></head>`,
)

mkdirSync('out', { recursive: true })
writeFileSync(OUT, html)
console.log(
  `wrote ${OUT} — ${(html.length / 1024).toFixed(0)} KB, ${inlined} assets inlined, ` +
    `${fontsInlined} preview fonts, ${(glyphData.length / 1024).toFixed(0)} KB of outlines, ` +
    `${Object.keys(sources).length} source fonts (${(sourceBytes / 1024).toFixed(0)} KB)`,
)
