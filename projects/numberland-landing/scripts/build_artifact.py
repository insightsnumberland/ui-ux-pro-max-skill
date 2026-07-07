#!/usr/bin/env python3
"""Assemble a self-contained Artifact page from the current runnable project.
- Preserves the design 1:1 (no visual changes).
- Inlines fonts-inline.css + tailwind.css + existing <style> blocks.
- Strips <!DOCTYPE>, <html>, <head>, <body> per Artifact skeleton rules.
- Wraps content in <div dir="rtl" lang="fa"> to keep RTL working under the
  Artifact-provided <html> shell.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "artifact.html"

index_html = (ROOT / "index.html").read_text(encoding="utf-8")
tailwind_css = (ROOT / "tailwind.css").read_text(encoding="utf-8")
fonts_css = (ROOT / "fonts-inline.css").read_text(encoding="utf-8")

# 1. Extract everything between <head> and </head> (contains title + first <style>)
head_match = re.search(r"<head>(.*?)</head>", index_html, re.DOTALL)
head_inner = head_match.group(1) if head_match else ""

# 2. Extract everything between <body ...> and </body>
body_match = re.search(r"<body[^>]*>(.*?)</body>", index_html, re.DOTALL)
body_inner = body_match.group(1) if body_match else ""

# 3. From head_inner, drop:
#    - <meta charset>, <meta viewport>, <meta theme-color> (Artifact provides its own)
#    - <link rel="stylesheet" href="tailwind.css">
#    - <link rel="preconnect" ...>
#    - <link href="https://fonts.googleapis.com...">
#    - <title>...</title> (we set title via <title> in body — browser moves it to head)
# Keep: any inline <style> and <script> blocks
head_cleaned = head_inner
# Drop external links
head_cleaned = re.sub(r'\s*<link\s+rel="stylesheet"\s+href="tailwind\.css"[^>]*>', "", head_cleaned)
head_cleaned = re.sub(r'\s*<link\s+rel="preconnect"[^>]*>', "", head_cleaned)
head_cleaned = re.sub(r'\s*<link\s+href="https://fonts\.googleapis\.com[^>]*>', "", head_cleaned)
# Drop metas — they don't belong in body
head_cleaned = re.sub(r'\s*<meta[^>]*>', "", head_cleaned)

# Extract the <title>
title_match = re.search(r"<title>([^<]+)</title>", head_cleaned)
title_text = title_match.group(1) if title_match else "نامبرلند"
head_cleaned = re.sub(r"\s*<title>[^<]*</title>", "", head_cleaned)

# What remains in head_cleaned should be inline <style>/<script>. Trim whitespace.
head_cleaned = head_cleaned.strip()

# 4. Compose the artifact body:
#    <title>...</title> — browser will hoist to head
#    <script> set dir/lang on <html> instantly on parse (before paint of body content)
#    <style> fonts + tailwind (combined)
#    Preserved head content (inline <style>/<script> from the original head)
#    <div dir="rtl" lang="fa"> ... body content ... </div>

# Combine fonts + tailwind + a tiny reset to ensure dark ground before styles compute
combined_css = f"""
/* ==== fonts (inlined data URIs) ==== */
{fonts_css}

/* ==== tailwind compiled ==== */
{tailwind_css}

/* ==== instant dark ground (avoid white flash on first paint) ==== */
html, body {{ background: #05060B; margin: 0; padding: 0; }}
"""

dir_setup = """<script>
  // Set RTL + lang on <html> before body paints (Artifact wraps our content
  // in its own <html>, so we can't set attributes there declaratively).
  (function(){
    var h = document.documentElement;
    h.setAttribute('dir', 'rtl');
    h.setAttribute('lang', 'fa');
  })();
</script>"""

artifact = f"""<title>{title_text}</title>
{dir_setup}
<style>{combined_css}</style>
{head_cleaned}
<div dir="rtl" lang="fa" class="numberland-app">
{body_inner.strip()}
</div>
"""

OUT.write_text(artifact, encoding="utf-8")
size_kb = OUT.stat().st_size / 1024
print(f"Wrote {OUT.name}: {size_kb:.1f} KB")
