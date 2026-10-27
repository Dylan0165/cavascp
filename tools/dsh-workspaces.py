#!/usr/bin/env python3
"""Laat zien welke workspaces DeepSeek Harness kent.

    python3 tools/dsh-workspaces.py
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

STORAGE = Path.home() / ".dsh" / "storages" / "workspace.json"

if not STORAGE.exists():
    print(f"geen workspace-bestand op {STORAGE}")
    raise SystemExit(1)

data = json.loads(STORAGE.read_text(encoding="utf-8"))
workspaces = data.get("tables", {}).get("workspaces", {})
volgorde = data.get("global", {}).get("workspaceIds", [])

print(f"{len(volgorde)} workspaces in {STORAGE}")
print()

for nummer, wid in enumerate(volgorde, 1):
    w = workspaces.get(wid)
    if not w:
        print(f"  {nummer}. [ontbreekt in de tabel] {wid}")
        continue
    titel = str(w.get("title", "?"))
    pad = str(w.get("path", "?"))
    sessies = len(w.get("sessionIds") or [])
    bestaat = "ok" if Path(pad).is_dir() else "MAP BESTAAT NIET"
    print(f"  {nummer}. {titel:<26} {pad}")
    print(f"     {sessies} sessie(s), {bestaat}")
