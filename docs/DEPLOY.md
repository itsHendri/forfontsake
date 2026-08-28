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

| Option | Fit | Notes |
| --- | --- | --- |
| **Cloudflare Pages** | Very good | Free tier, custom domain + TLS included, generous bandwidth, good for a 500 KB payload. |
| **GitHub Pages** | Good | The repo is already public on GitHub; custom domains and TLS work. Simplest possible path. |
| **Netlify / Vercel** | Good technically | See the caveat below before choosing either. |

**A caveat that is yours to weigh, not mine.** SwissBorg's engineering policy says not to
use third-party services where SwissBorg has no company account — naming Netlify and Vercel
specifically — to build, host or deploy apps. The stated reason is keeping user and company
data out of tools the company cannot control. This project is personal, on a personal
domain, and contains no SwissBorg data of any kind, so the *reason* does not apply; the
*rule as written* still names those two services. There is also a Vercel connector attached
to this working environment, which may be a company account. Given that, Cloudflare Pages or
GitHub Pages avoid the question entirely and cost nothing. If you want Vercel or Netlify,
that is a reasonable call on a personal project — just make it knowingly and with a personal
account.

### Roughly what it takes

1. Build: `npm run build` → `dist/`.
2. Point the host at the repo, build command `npm run build`, output directory `dist`.
   (Note: `npm run build:workbench` is the *artifact* build — do not use it for the site.)
3. Add `forfontsake.xyz` as a custom domain and follow the host's DNS instructions
   (usually a CNAME, or A/AAAA records at the apex). TLS is automatic on all three.
4. Check the deployed page actually exports a font — that is the one thing worth clicking
   before announcing anything.

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
