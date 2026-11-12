# For Font's Sake website

The browser type foundry at forfontsake.xyz. Vite, React and TypeScript, all client-side: no backend, no accounts, nothing leaves the visitor's machine.

- Read `docs/STATE.md` first (what works today and the mechanisms that are easy to break), then `docs/DECISIONS.md` before changing how something is built. Keep both current when something ships.
- The words for things (engine, treatment, stack, plate, sheet, override) are in the README's vocabulary table. Use them.
- `src/engine/` is pure geometry: no DOM, and nothing random outside the seeded rng. Every caller runs treatments through `applyChain` in `treatments/registry.ts`, so the preview, the sheet and the downloaded font always match.
- Treatment ids live in shared links and saved fonts. Never rename one; retire it through `retired.ts`.
- Finishes are pixels on the sheet only. They never touch the path from a chain to a font file.
- Before saying something works: `npm run typecheck`, `npm test` and `npm run lint`. After touching the export: `npm run build:font` and `npm run verify:font`.
- A push to `main` deploys: Cloudflare Workers Builds runs the checks and the build, then `wrangler deploy` (see `wrangler.jsonc` and `docs/DEPLOY.md`). So ask before pushing.
- The licence is GPL-3.0-only and every shipped font is OFL. Check the licence of anything new before adding it.
- The repo is public: no private paths, hostnames or client names in code, comments or commits.
