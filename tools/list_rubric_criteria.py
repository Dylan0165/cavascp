#!/usr/bin/env python3
"""List every distinct rubric criterion across portfolio assignments, grouped by LO code."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "data" / "portfolio_assignments.json").read_text(encoding="utf-8"))

LO_RE = re.compile(r"\bLO\s*[-_.]?\s*(\d{1,2})\b", re.IGNORECASE)
LEER_RE = re.compile(r"\bLeeruitkomst(?:en)?\s*[-_.]?\s*(\d{1,2})\b", re.IGNORECASE)

by_code: dict[str, dict[str, int]] = {}
plain: dict[str, int] = {}

for row in data:
    for crit in row.get("rubric") or []:
        desc = (crit.get("description") or "").strip()
        if not desc:
            continue
        codes = {f"LO{m.group(1)}" for m in LO_RE.finditer(desc)}
        codes |= {f"LO{m.group(1)}" for m in LEER_RE.finditer(desc)}
        if codes:
            for code in codes:
                by_code.setdefault(code, {})
                by_code[code][desc] = by_code[code].get(desc, 0) + 1
        else:
            plain[desc] = plain.get(desc, 0) + 1

print(f"portfolio assignments: {len(data)}")
print()
print("=== criteria WITH a learning-outcome code ===")
for code in sorted(by_code, key=lambda c: int(c[2:])):
    print(f"\n{code}:")
    for desc, count in sorted(by_code[code].items(), key=lambda kv: -kv[1]):
        print(f"   [{count}x] {desc}")

print()
print("=== criteria WITHOUT an LO code (assignment-specific) ===")
for desc, count in sorted(plain.items(), key=lambda kv: -kv[1])[:40]:
    print(f"   [{count}x] {desc}")
