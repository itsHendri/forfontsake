/**
 * Placeholder shell.
 *
 * The working interface is the workbench, which is currently generated as a
 * static page by `scripts/make-live-artifact.ts`. Folding it into this app is
 * the next piece of work; until then this exists so the dev server has
 * something honest to serve rather than a stale harness that predates the
 * treatment registry.
 */
export default function App() {
  return (
    <main className="shell">
      <p className="eyebrow">For Font's Sake</p>
      <h1>The workbench lives outside this app, for now</h1>
      <p>
        Run <code>npm run build:workbench</code> and open{' '}
        <code>out/grit-workbench.html</code>. It runs the same engine this app imports.
      </p>
      <p className="muted">
        Moving that page in here is the next task — see <code>docs/DECISIONS.md</code>.
      </p>
    </main>
  )
}
