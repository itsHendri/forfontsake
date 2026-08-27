# FOR FONT'S SAKE

An interactive type foundry at [forfontsake.xyz](https://forfontsake.xyz). Pick a font,
apply a treatment, tweak it live, and export a real, installable, correctly-licensed font.

Everything runs in the browser. No upload, no account, nothing leaves your machine.

## Why

Every tool in this category ships a broken download. One fulfils exports by email;
another's export hands back the unmodified source file; a third's has been reported dead
since March 2025. So the first promise here is dull and load-bearing: **the download
works**, and the app proves it by re-rendering the specimen with the actual exported file.

The second is licensing. Deriving a font from an open-licensed one has real rules —
Reserved Font Names, mandatory notices, naming restrictions — and no competitor surfaces
them. Here they're enforced in the export path, not buried in a footer.

## Treatments

Each treatment is a pure function from glyph outlines to glyph outlines, applied
consistently across the whole character set and driven by a seeded PRNG so any font is
reproducible from its parameters.

- **Grit** — erosion in three layers: coherent-noise displacement of the outline, bites
  along the edge, and interior speckle biased toward the boundary so stroke cores stay
  intact and the face survives being set small.
- **Mosaic** — each stroke cut across its width into tiles, grout between them.

## Development

```bash
npm install
npm run dev
```

Font verification needs a Python environment:

```bash
python3 -m venv .venv && ./.venv/bin/pip install opentype-sanitizer fonttools
```

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Types. Use this, not bare `tsc --noEmit` — the root tsconfig has `files: []` and silently passes. |
| `npm run test` | Engine unit tests. |
| `npm run build:font -- --treatment=grit --p.amount=60` | Headless build of a treated font. |
| `npm run verify:font -- out/Font.ttf Pirata` | Gates a font on ots-sanitize, fontTools, CoreText, naming/RFN rules. Set `VERIFY_AGAINST=<source>` to also check metric parity. |

## Licence

GPL-3.0-only. The font engine builds on
[font-flux-js](https://github.com/mattlag/Font-Flux-JS), which is GPL-3.0; since this app
ships its code to every visitor, the app carries the same licence. That was a deliberate
choice — this is meant to be a free, open tool.

Fonts you generate are yours, subject to the licence of whatever font you started from.
