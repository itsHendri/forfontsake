#!/bin/sh
# Check the build carries what the page fetches.
#
# The first deploy went out missing glyph-data.json and the page died on a 404,
# because that file is generated and gitignored and `build` did not make it.
# `build` does now — this is the guard that the next generated thing does not
# repeat the trick. Everything listed here is fetched at runtime, so a missing
# one is a broken site, not a degraded one. Workers Builds runs this before it
# deploys, so a failure here keeps the last good version live.
set -eux
test -f dist/index.html
test -f dist/glyph-data.json
test -f dist/share.png
test "$(ls dist/fonts/preview/*.woff2 | wc -l)" -eq 7
test -f dist/404.html
test -f dist/api/health
test -f dist/_headers
for g in brayer linen crumpled kraft newsprint photocopy concrete washi watercolour; do test -f "dist/grounds/$g.jpg"; test -f "dist/grounds/$g-thumb.jpg"; done
test -f dist/about.html
