#!/usr/bin/env python3
"""Laat de vorm zien van de cursusdata: modules, announcements, outcome-groepen.

Bepaalt hoe het dashboard "wat is deze cursus" moet modelleren.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "courses"


def load(cid: int, name: str):
    p = RAW / str(cid) / f"{name}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


# Een cursus die alles heeft: A-MA-CSE heeft 9 modules en 78 items.
CID = 15720

print("=" * 78)
print("MODULES")
print("=" * 78)
mods = load(CID, "modules") or []
print(f"aantal: {len(mods)}")
for m in mods[:4]:
    print(f"\n  module {m.get('id')}  pos={m.get('position')}  state={m.get('workflow_state')}")
    print(f"    naam: {m.get('name')}")
    print(f"    items: {len(m.get('items') or [])}")
    for it in (m.get("items") or [])[:4]:
        print(f"      - type={it.get('type'):<16} title={str(it.get('title'))[:44]:<44} url={bool(it.get('html_url'))}")

print()
print("=" * 78)
print("MODULE-ITEM VELDEN")
print("=" * 78)
if mods and mods[0].get("items"):
    print(json.dumps(mods[0]["items"][0], ensure_ascii=False, indent=2)[:800])

print()
print("=" * 78)
print("ANNOUNCEMENTS")
print("=" * 78)
ann = load(CID, "announcements") or []
print(f"aantal: {len(ann)}")
if ann:
    print(f"velden: {sorted(ann[0].keys())}")
    for a in ann[:3]:
        print(f"\n  titel    : {a.get('title')}")
        print(f"  geplaatst: {a.get('posted_at')}")
        print(f"  auteur   : {a.get('user_name')}")
        body = (a.get("message") or "").replace("\n", " ")
        print(f"  bericht  : {body[:150]}")

print()
print("=" * 78)
print("OUTCOME-GROEPEN")
print("=" * 78)
og = load(CID, "outcomes") or []
print(f"aantal: {len(og)}")
if og:
    print(json.dumps(og[0], ensure_ascii=False, indent=2)[:600])

print()
print("=" * 78)
print("TABS (welke onderdelen heeft een cursus)")
print("=" * 78)
tabs = load(CID, "tabs") or []
if tabs:
    for t in tabs:
        if t.get("visible"):
            print(f"  {str(t.get('id')):<20} {t.get('label')}")

print()
print("=" * 78)
print("FRONT PAGE")
print("=" * 78)
fp = load(CID, "front_page")
if isinstance(fp, dict):
    print(f"  titel : {fp.get('title')}")
    print(f"  url   : {fp.get('html_url')}")
    print(f"  body  : {len(fp.get('body') or '')} tekens")
else:
    print("  geen front page")

print()
print("=" * 78)
print("PAGINA'S")
print("=" * 78)
pages = load(CID, "pages") or []
print(f"aantal: {len(pages)}")
for p in pages[:8]:
    print(f"  {str(p.get('title'))[:60]:<60} front={p.get('front_page')} published={p.get('published')}")
