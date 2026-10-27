#!/usr/bin/env python3
"""Welke opdracht is veilig om de inlever-knop op te testen?

We willen de upload- en inleverflow testen zonder echt werk te overschrijven.
Canvas geeft per opdracht `allowed_attempts` (-1 = onbeperkt) en er is een
opdracht die letterlijk zegt dat je hem niet moet gebruiken.
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
raw = ROOT / "data" / "raw" / "courses"

print("=" * 96)
print("OPDRACHTEN DIE ZICH LENEN VOOR EEN TEST-INLEVERING")
print("=" * 96)
print(f"{'course':>7} {'asg':>8} {'pogingen':>9} {'state':<12} naam")
print("-" * 96)

kandidaten = []
for course_dir in sorted(raw.iterdir()):
    f = course_dir / "assignments.json"
    if not f.exists():
        continue
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        continue
    if not isinstance(data, list):
        continue
    for a in data:
        try:
            attempts = a.get("allowed_attempts")
        except AttributeError:
            continue
        sub = a.get("submission") or {}
        state = sub.get("workflow_state", "?")
        name = str(a.get("name") or "")
        # Interessant: opdrachten met online_upload die onbeperkt mogen.
        if "online_upload" not in (a.get("submission_types") or []):
            continue
        unlimited = attempts in (-1, 0, None)
        if unlimited or "niet gebruiken" in name.lower() or "test" in name.lower():
            kandidaten.append((course_dir.name, a.get("id"), attempts, state, name))
            print(f"{course_dir.name:>7} {a.get('id'):>8} {str(attempts):>9} {state:<12} {name[:52]}")

print()
print("=" * 96)
print("CONCLUSIE")
print("=" * 96)
veilig = [k for k in kandidaten if "niet gebruiken" in k[4].lower()]
if veilig:
    print("  Letterlijk veilig om te gebruiken (de opdracht zegt het zelf):")
    for k in veilig:
        print(f"    cursus {k[0]}, opdracht {k[1]}: {k[4]}")
print(f"  Opdrachten met onbeperkte pogingen: {len([k for k in kandidaten if k[2] in (-1, 0, None)])}")
print()
print("  Oppassen: bij een opdracht met allowed_attempts = 1 overschrijft een")
print("  inlevering je enige kans. Bij -1 (onbeperkt) kun je gerust opnieuw doen.")
