#!/bin/sh
# Fetch the two brand typefaces (SIL Open Font License) as TTF into
# marketing/build/fonts/. Only needed to re-outline the lettering
# (glyphs.py) or re-render the flyer; the outlines are committed.
set -e
cd "$(dirname "$0")"
mkdir -p fonts
for spec in "Bricolage+Grotesque:wght@800" "Bricolage+Grotesque:wght@700" "Inter:wght@600" "Inter:wght@800"; do
  url=$(curl -sS -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=$spec" | grep -o "https://[^)]*\.ttf" | head -1)
  out="fonts/$(echo "$spec" | tr ':@+' '___').ttf"
  curl -sS -o "$out" "$url"
  echo "$out"
done
