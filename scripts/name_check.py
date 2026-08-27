#!/usr/bin/env python3
"""Report the naming fields of a font plus any Reserved Font Name violations.

OFL 1.1 forbids a Reserved Font Name in the *name* of a derivative, not in the
copyright notice — which must in fact be retained verbatim, RFN declaration and
all. So this checks the naming IDs and the CFF-internal names only.
"""
import json
import sys

from fontTools.ttLib import TTFont

# nameIDs that carry the font's identity, i.e. where an RFN may not appear
NAME_IDS = {
    1: "family",
    2: "subfamily",
    3: "uniqueID",
    4: "fullName",
    6: "postScriptName",
    16: "typographicFamily",
    17: "typographicSubfamily",
    18: "compatibleFull",
    21: "wwsFamily",
    22: "wwsSubfamily",
}

path = sys.argv[1]
reserved = [r for r in sys.argv[2:] if r]

font = TTFont(path, lazy=True)
naming = {}
for rec in font["name"].names:
    if rec.nameID in NAME_IDS:
        naming.setdefault(NAME_IDS[rec.nameID], set()).add(str(rec))

cff_names = []
if "CFF " in font:
    cff = font["CFF "].cff
    cff_names = list(cff.fontNames)
    top = cff[cff.fontNames[0]]
    for attr in ("FullName", "FamilyName", "Weight"):
        value = getattr(top, attr, None)
        if value:
            cff_names.append(str(value))

violations = []
haystack = [(k, v) for k, values in naming.items() for v in values]
haystack += [("cff", v) for v in cff_names]
for field, value in haystack:
    for rfn in reserved:
        if rfn.lower() in value.lower():
            violations.append({"field": field, "value": value, "reserved": rfn})

out = {
    "naming": {k: sorted(v) for k, v in naming.items()},
    "cffNames": cff_names,
    "glyphCount": font["maxp"].numGlyphs,
    "unitsPerEm": font["head"].unitsPerEm,
    "cmapCount": len(font.getBestCmap()),
    "hasCFF": "CFF " in font,
    "hasGlyf": "glyf" in font,
    "violations": violations,
}
print(json.dumps(out, indent=1))
sys.exit(1 if violations else 0)
