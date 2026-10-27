#!/usr/bin/env python3
"""Welke inlevervormen gebruikt Fontys, en wat betekent dat voor een inleverknop?

Canvas kent per opdracht een submission_types-lijst. De knop "Lever in" moet
per opdracht weten wat hij moet doen:
  online_upload      → bestand uploaden
  online_text_entry  → tekst plakken
  online_url         → link opgeven
  none               → geen inlevering mogelijk (bijv. alleen een rubric)
  external_tool      → loopt via een LTI-tool (Roll Call, Portflow-snapshot)
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "data" / "portfolio_assignments.json").read_text(encoding="utf-8"))

print("=" * 74)
print("INLEVERVORMEN (alle portfolio-opdrachten)")
print("=" * 74)
counts: Counter = Counter()
for row in data:
    for t in row.get("submission_types") or ["(leeg)"]:
        counts[t] += 1
for kind, n in counts.most_common():
    print(f"  {n:>4}  {kind}")

print()
print("=" * 74)
print("OPEN OPDRACHTEN DIE EEN BESTAND VRAGEN (uploadbaar)")
print("=" * 74)
open_upload = [r for r in data if r.get("state") == "unsubmitted" and "online_upload" in (r.get("submission_types") or [])]
print(f"aantal: {len(open_upload)}")
for row in open_upload[:14]:
    due = str(row.get("due_at"))[:10] if row.get("due_at") else "geen"
    print(f"  {due}  {row['course_name'][:18]:<18} {str(row['name'])[:44]:<44} rubric={len(row.get('rubric') or [])}")

print()
print("=" * 74)
print("OPEN OPDRACHTEN MET EEN ANDERE VORM")
print("=" * 74)
others = [r for r in data if r.get("state") == "unsubmitted" and "online_upload" not in (r.get("submission_types") or [])]
print(f"aantal: {len(others)}")
for row in others[:12]:
    due = str(row.get("due_at"))[:10] if row.get("due_at") else "geen"
    types = ",".join(row.get("submission_types") or []) or "(leeg)"
    print(f"  {due}  {row['course_name'][:18]:<18} {str(row['name'])[:36]:<36} {types}")

print()
print("=" * 74)
print("SEMESTERCODES")
print("=" * 74)
terms: Counter = Counter()
for row in data:
    terms[row["course_name"]] = terms[row["course_name"]]
seen = {}
for row in data:
    seen.setdefault(row["course_name"], row["course_id"])
try:
    intel = json.loads((ROOT / "data" / "course-intel.json").read_text(encoding="utf-8"))
    for c in intel:
        print(f"  {str(c.get('term')):<9} {str(c.get('name'))[:44]:<44} {c.get('modules')} modules")
except FileNotFoundError:
    print("  data/course-intel.json ontbreekt — draai eerst tools/probe_courses.py")
