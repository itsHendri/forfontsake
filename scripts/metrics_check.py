#!/usr/bin/env python3
"""Compare a derivative's metrics against the source it was treated from.

Parity here is not "the same glyphs". Building with --alts=N adds N-1 extra cuts
per treated glyph, so a derivative legitimately carries several times the source's
glyph count. What must not change is the coordinate system, the characters the
font can render, and the width of every glyph the two fonts share — a treatment
that reflows the text it is applied to has failed, however good it looks.

So: unitsPerEm, cmap coverage, and the advance width of every glyph present in
both fonts. Alternates are counted and reported, and each one is held to its own
base glyph's width, since a drifted alternate would make the rotation jitter.
"""
import json
import re
import sys

from fontTools.ttLib import TTFont

ALT = re.compile(r"^(.+)\.alt\d+$")


def load(path):
    font = TTFont(path, lazy=True)
    hmtx = font["hmtx"]
    return {
        "order": font.getGlyphOrder(),
        "advance": {g: hmtx[g][0] for g in font.getGlyphOrder()},
        "cmap": font.getBestCmap(),
        "unitsPerEm": font["head"].unitsPerEm,
        # post format 3.0 keeps no glyph names, so fontTools synthesises
        # "glyph00042" and matching by name would compare two made-up lists
        "hasNames": getattr(font["post"], "formatType", 0) != 3.0 if "post" in font else False,
    }


derivative = load(sys.argv[1])
source = load(sys.argv[2])

byName = derivative["hasNames"] and source["hasNames"]

# Alternates are the extra cuts: "a.alt1" alongside an "a" that is really there.
alternates = sorted(
    g for g in derivative["order"] if (m := ALT.match(g)) and m.group(1) in derivative["advance"]
)

# Pair up. cmap pairing works on any font; names additionally reach the glyphs no
# codepoint points at (ligatures, components, alternates of the source itself).
pairs = {}
for cp, name in source["cmap"].items():
    other = derivative["cmap"].get(cp)
    if other is not None:
        pairs[name] = other
if byName:
    for name in source["order"]:
        if name not in pairs and name in derivative["advance"]:
            pairs[name] = name

lostCodepoints = sorted(set(source["cmap"]) - set(derivative["cmap"]))
addedCodepoints = sorted(set(derivative["cmap"]) - set(source["cmap"]))
retargeted = [
    {"codepoint": f"U+{cp:04X}", "source": source["cmap"][cp], "derivative": derivative["cmap"][cp]}
    for cp in sorted(set(source["cmap"]) & set(derivative["cmap"]))
    if byName and source["cmap"][cp] != derivative["cmap"][cp]
]

missing = sorted(g for g in source["order"] if g not in pairs) if byName else []

advanceDiffs = [
    {"glyph": name, "source": source["advance"][name], "derivative": derivative["advance"][other]}
    for name, other in sorted(pairs.items())
    if source["advance"][name] != derivative["advance"][other]
]

# How the widths moved, not just whether they did. A treatment that declares
# growth() widens every glyph it touches by one constant, so a healthy build has
# at most one non-zero delta; several means the widths moved per glyph, which is
# the drift worth failing on.
deltas = {}
for name, other in pairs.items():
    d = derivative["advance"][other] - source["advance"][name]
    deltas[d] = deltas.get(d, 0) + 1

# An alternate carries no source counterpart of its own, so it is checked against
# the cut it stands in for.
altDiffs = [
    {"glyph": g, "base": ALT.match(g).group(1), "baseAdvance": derivative["advance"][ALT.match(g).group(1)], "derivative": derivative["advance"][g]}
    for g in alternates
    if derivative["advance"][g] != derivative["advance"][ALT.match(g).group(1)]
]

unaccounted = sorted(
    set(derivative["order"]) - set(pairs.values()) - set(alternates)
) if byName else []

print(
    json.dumps(
        {
            "unitsPerEm": {"source": source["unitsPerEm"], "derivative": derivative["unitsPerEm"]},
            "glyphCount": {"source": len(source["order"]), "derivative": len(derivative["order"])},
            "matchedGlyphs": len(pairs),
            "alternatesAdded": len(alternates),
            "cmapCount": {"source": len(source["cmap"]), "derivative": len(derivative["cmap"])},
            "matchedByName": byName,
            "lostCodepoints": [f"U+{cp:04X}" for cp in lostCodepoints],
            "addedCodepoints": [f"U+{cp:04X}" for cp in addedCodepoints],
            "retargetedCodepoints": retargeted,
            "missingGlyphs": missing,
            "unaccountedGlyphs": unaccounted,
            "advanceDeltas": [
                {"delta": d, "glyphs": n} for d, n in sorted(deltas.items(), key=lambda kv: -kv[1])
            ],
            "advanceDiffs": advanceDiffs,
            "alternateAdvanceDiffs": altDiffs,
        },
        indent=1,
    )
)
