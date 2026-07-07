#!/usr/bin/env python3
"""Fetch Google Fonts CSS + WOFF2 files and produce a self-contained CSS
with all font data inlined as data: URIs. Keeps only Latin (all families)
and Arabic (Vazirmatn) subsets to keep size manageable."""
import base64
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fonts-inline.css"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
CSS_URL = ("https://fonts.googleapis.com/css2?"
           "family=Vazirmatn:wght@400;500;600;700;800&"
           "family=Orbitron:wght@500;600;700;800&"
           "family=JetBrains+Mono:wght@400;500;700&display=swap")

def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read() if binary else r.read().decode("utf-8")

def main():
    css = fetch(CSS_URL)
    # Parse into ("/* subset */\n@font-face { ... }") blocks
    blocks = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*@font-face\s*{([^}]+)}", css)
    keep = []
    total_font_bytes = 0
    for subset, body in blocks:
        family_match = re.search(r"font-family:\s*'([^']+)'", body)
        if not family_match:
            continue
        family = family_match.group(1)
        # Keep only latin for everyone; keep arabic for Vazirmatn
        allowed_subsets = {"latin"}
        if family == "Vazirmatn":
            allowed_subsets.add("arabic")
        if subset not in allowed_subsets:
            continue
        # Extract URL, download, base64 encode
        url_m = re.search(r"src:\s*url\(([^)]+)\)", body)
        if not url_m:
            continue
        font_url = url_m.group(1).strip('"').strip("'")
        try:
            font_bytes = fetch(font_url, binary=True)
        except Exception as e:
            print(f"WARN: could not fetch {font_url}: {e}", file=sys.stderr)
            continue
        total_font_bytes += len(font_bytes)
        b64 = base64.b64encode(font_bytes).decode("ascii")
        data_uri = f"data:font/woff2;base64,{b64}"
        # Replace the url() with data uri, keep the block
        new_body = body.replace(font_url, data_uri)
        keep.append(f"/* {subset} — {family} */\n@font-face {{{new_body}}}\n")

    out_css = "\n".join(keep)
    OUT.write_text(out_css, encoding="utf-8")
    print(f"Wrote fonts-inline.css: {len(keep)} @font-face rules, "
          f"{total_font_bytes/1024:.1f} KB of font data "
          f"→ {len(out_css)/1024:.1f} KB of CSS")

if __name__ == "__main__":
    main()
