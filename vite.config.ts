import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Inline the export worker, but only for the artifact.
 *
 * The font writer is the biggest thing in the bundle and most visitors never
 * press Download, so on the web it should be its own chunk, fetched on demand.
 * An artifact has no server to fetch from, so there it has to be inlined or the
 * download button cannot download — which is the one failure this project
 * exists not to have.
 *
 * Those two needs disagree, and the source can only say one thing, so the
 * decision moves here: `src/lib/exportFont.ts` imports plain `?worker`, and
 * building with `--mode artifact` rewrites that specifier to `?worker&inline`
 * on its way through. Vite's own worker plugin does the rest.
 *
 * `enforce: 'pre'` matters — this has to rewrite the id before Vite's worker
 * plugin resolves it, or the query is already committed by the time we see it.
 */
function inlineWorkerForArtifact(mode: string): Plugin {
  return {
    name: 'ffs:inline-worker-for-artifact',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (mode !== 'artifact') return null
      if (!source.includes('.worker?worker')) return null
      if (source.includes('inline')) return null
      const resolved = await this.resolve(`${source}&inline`, importer, {
        ...options,
        skipSelf: true,
      })
      return resolved ?? null
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), inlineWorkerForArtifact(mode)],
}))
