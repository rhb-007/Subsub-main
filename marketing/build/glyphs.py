"""Outline the brand's lettering so the print files carry no live text.

Reads Bricolage Grotesque and Inter (both SIL Open Font License, fetched from
Google Fonts by fetch-fonts.sh into marketing/build/fonts/, which is not
committed) and writes glyphs.json: every character the assets use, as an SVG
path in font units with its advance width. build-assets.mjs lays them out.

Run:  python3 marketing/build/glyphs.py
"""
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = {
    "brico800": "Bricolage_Grotesque_wght_800.ttf",
    "brico700": "Bricolage_Grotesque_wght_700.ttf",
    "inter600": "Inter_wght_600.ttf",
    "inter800": "Inter_wght_800.ttf",
}
CHARS = "".join(chr(c) for c in range(32, 127)) + "·—’•✓"

out = {}
for key, name in FONTS.items():
    path = os.path.join(HERE, "fonts", name)
    if not os.path.exists(path):
        sys.exit(f"missing {path} -- run marketing/build/fetch-fonts.sh first")
    font = TTFont(path)
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font["hmtx"]
    os2 = font["OS/2"]
    glyphs = {}
    for ch in CHARS:
        gname = cmap.get(ord(ch))
        if not gname:
            continue
        pen = SVGPathPen(gs)
        gs[gname].draw(pen)
        glyphs[ch] = {"d": pen.getCommands(), "adv": hmtx[gname][0]}
    out[key] = {"upm": font["head"].unitsPerEm, "cap": getattr(os2, "sCapHeight", 700), "glyphs": glyphs}

with open(os.path.join(HERE, "glyphs.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))
print("wrote glyphs.json:", {k: len(v["glyphs"]) for k, v in out.items()})
