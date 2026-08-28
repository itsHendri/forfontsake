# Getting it onto forfontsake.xyz

The plan for moving off the artifact and onto the real domain, and the work that has to
happen first. Nothing here is done yet.

---

## The good news: there is no backend

The app is **entirely client-side**. The engine runs in the browser, the export runs in a
Web Worker, and the only things it loads are static files. So this is a static site —
build, upload a folder, point DNS. No server, no database, no API keys, nothing to secure,
nothing with a running cost that scales with visitors.

That also means **"storage for the fonts" is not a problem to solve.** The seven source
fonts are 800 KB of static files in `public/fonts/`. Any static host serves them, and the
browser fetches only the one you actually export. The 2.4 MB artifact is 2.4 MB *because* an
artifact has no server to fetch from, so everything had to be inlined. On a real host that
inlining goes away and the initial load drops to roughly the JS bundle plus 500 KB of glyph
outlines.

`npm run build` already produces a deployable `dist/`. It works as-is.

---

## Do this before launch

Ordered by whether it blocks going public.

### 1. Split the export worker out of the main bundle — *blocks a good launch*

`src/lib/exportFont.ts` imports the worker with `?worker&inline`, which base64s the font
writer into the main bundle so the single-file artifact works. Result: **877 KB of JS
(266 KB gzipped)** delivered to everyone, including the majority who will never press
Download.

The fix is to make inlining a property of the *artifact* build rather than of the source:
build the worker as a normal separate chunk for the web, and have `scripts/inline-build.ts`
fold that chunk into the HTML for the artifact, as it already does for the script and
stylesheet. Expect the initial bundle to land somewhere near 250 KB.

Do this before launch, not after — it is the difference between the page feeling instant and
feeling heavy, and it gets harder once the build has other consumers.

### 2. An OG share image — *blocks sharing well*

`index.html` already references `https://forfontsake.xyz/share.png`; **that file does not
exist.** A link posted anywhere will render with a blank preview until it does. It should
be a specimen — treated type on the paper ground, 1200×630. `scripts/figma-export.ts` and
the specimen sheet scripts can generate the artwork.

### 3. Decide what the front door is — *blocks nothing, changes everything*

Right now the workbench *is* the site: you land straight in the tool. That is a defensible
choice and it is what the artifact does. The alternative is a short landing page that says
what this is and why the download works, with the tool one click in.

Worth deciding deliberately rather than by default, because it drives the OG image, the
copy, and whether the tool needs its own route.

### 4. Persist saved styles — *nice to have*

They are in-memory and lost on reload. `localStorage` is the obvious fix, needs no backend,
and makes the shelf worth using. The whole workbench state already encodes into the URL, so
the pieces are there.

---

## Where to host it

A static site with no backend can go almost anywhere, so the decision is about constraints
rather than capability.

**Decided: GitHub Pages.** The repo is already public there, it is free for public repos
including the custom domain and automatic TLS, and it needs no new account. Cloudflare Pages
would work equally well; its advantage is bandwidth headroom this will not reach.

### Serve it from the domain root, from the very first deploy

**This is the one setup detail that bites.** The app assumes it is served from `/` — the
`@font-face` rules in `src/index.css` point at `/fonts/preview/*.woff2` absolutely, and
`index.html` at `/favicon.svg`. Vite's `base` is unset, i.e. `/`.

- `forfontsake.xyz` at the apex → served from `/` → correct with no changes.
- `itshendri.github.io/forfontsake/` → served from a subpath → those URLs 404.

The subpath failure is **silent and misleading**. Those preview fonts are the metrics-only
subsets the specimen field depends on; without them the field falls back to system metrics
and the caret drifts away from the letters it is supposed to sit between, with nothing
logged. Anyone debugging that without knowing would go looking in `Plate.tsx`, which is the
wrong place entirely.

So attach the custom domain as part of the first deploy rather than testing on the github.io
URL first. If a subpath deploy is ever genuinely wanted, set Vite's `base` **and** convert
those absolute CSS URLs — changing one without the other reproduces exactly this bug.

### Roughly what it takes

1. Build: `npm run build` → `dist/`. (Note: `npm run build:workbench` is the *artifact*
   build — do not use it for the site.)
2. A GitHub Actions workflow that builds and publishes `dist/` to Pages on push to `main`.
   The Python venv is not needed in CI — it is only for `verify:font` and for recutting the
   preview subsets, and both outputs are committed.
3. Add `forfontsake.xyz` in the repo's Pages settings, commit a `CNAME` file, and point DNS
   at GitHub (four `A` records at the apex, or `ALIAS`/`ANAME` if the registrar supports it;
   `www` as a `CNAME`). Enable *Enforce HTTPS* once the certificate is issued.
4. Then click Download on the deployed site. It is the one thing worth checking before
   telling anyone the site exists.

---

## Licence obligations, since it will be public

Both are satisfied in the repo; keep them satisfied on the site.

- **GPL-3.0.** `font-flux-js` is GPL and ships to every visitor, so this app is GPL too.
  `LICENSE` is in the repo and the source is public on GitHub — which is what the licence
  requires. Link the source from the site.
- **OFL.** Each bundled font carries its `OFL.txt` in `public/fonts/<font>/` and those get
  served. The exporter already enforces Reserved Font Names in the name field, and stamps
  the OFL and a derivation notice into every font it writes.

---

## What this does *not* need

Worth saying, because it is easy to over-build a static site: no accounts, no auth, no
database, no server-side font processing, no CDN beyond what the host gives you, no
analytics to launch. If usage ever justifies them, they can be added without changing the
architecture — the app would keep working exactly as it does now with the network off.
