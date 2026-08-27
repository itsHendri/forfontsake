#!/usr/bin/env python3
"""Shape text with HarfBuzz and report what the font's features actually do.

A GSUB table that passes the sanitiser can still substitute nothing. The only
way to know a rotation works is to shape a string with repeated letters and see
whether the repeats come back as different glyphs.
"""
import json
import sys

from fontTools.ttLib import TTFont

try:
    import uharfbuzz as hb
except ImportError:
    print(json.dumps({"available": False, "reason": "uharfbuzz not installed"}))
    sys.exit(0)

path = sys.argv[1]
text = sys.argv[2] if len(sys.argv) > 2 else "aaaa"

order = TTFont(path, lazy=True).getGlyphOrder()
face = hb.Face(hb.Blob.from_file_path(path))
font = hb.Font(face)


def shape(features):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, features)
    return [order[i.codepoint] for i in buf.glyph_infos]


on = shape({"calt": True})
off = shape({"calt": False})

# a rotation is working when identical input characters leave as different
# glyphs, and when turning the feature off collapses them back
repeats_vary = len(set(on)) > len(set(off))

print(
    json.dumps(
        {
            "available": True,
            "text": text,
            "withFeature": on,
            "withoutFeature": off,
            "substitutes": on != off,
            "repeatsVary": repeats_vary,
        }
    )
)
