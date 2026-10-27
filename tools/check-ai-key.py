#!/usr/bin/env python3
"""Kijkt of er een AI-sleutel beschikbaar is, zonder hem te tonen.

We printen alleen namen en lengtes, nooit de waarde. Zo weet je of de stagebot
iets kan, zonder dat de sleutel in een logregel of in de chat belandt.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HOME = Path.home()

print("=== omgevingsvariabelen ===")
gevonden = False
for naam in os.environ:
    boven = naam.upper()
    if any(w in boven for w in ("DEEPSEEK", "OPENAI", "ANTHROPIC", "API_KEY", "APIKEY")):
        waarde = os.environ[naam]
        print(f"  {naam}: {len(waarde)} tekens, begint met {waarde[:4]}…")
        gevonden = True
if not gevonden:
    print("  geen AI-sleutel in de omgeving")

print()
print("=== DSH-credentials ===")
cred = HOME / ".dsh" / ".credentials.yaml"
if cred.exists():
    # Geen yaml-parser aannemen; gewoon de regels bekijken.
    for regel in cred.read_text(encoding="utf-8", errors="replace").splitlines():
        schoon = regel.rstrip()
        if not schoon or schoon.lstrip().startswith("#"):
            continue
        # Waarden afkappen: alles na de dubbele punt.
        if ":" in schoon:
            sleutel, _, waarde = schoon.partition(":")
            waarde = waarde.strip()
            if len(waarde) > 8 and not waarde.startswith(("{", "[")):
                print(f"  {sleutel}: <{len(waarde)} tekens>")
            else:
                print(f"  {sleutel}: {waarde}")
        else:
            print(f"  {schoon}")
else:
    print("  geen .credentials.yaml")

print()
print("=== Krava-config (die gebruikt ook een taalmodel) ===")
for naam in (".env", "config.json", "instellingen.json", "settings.json"):
    pad = HOME / "KravaDoc" / naam
    if pad.exists():
        tekst = pad.read_text(encoding="utf-8", errors="replace")
        for regel in tekst.splitlines():
            if any(w in regel.lower() for w in ("api_key", "apikey", "deepseek", "model")):
                sleutel, _, waarde = regel.partition("=")
                if not waarde:
                    sleutel, _, waarde = regel.partition(":")
                waarde = waarde.strip().strip('",')
                if len(waarde) > 8:
                    print(f"  {pad.name} · {sleutel.strip()}: <{len(waarde)} tekens>")
                else:
                    print(f"  {pad.name} · {sleutel.strip()}: {waarde}")
