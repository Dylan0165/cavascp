#!/usr/bin/env python3
"""Zet een map in de workspace-lijst van DeepSeek Harness.

DSH bewaart zijn workspaces in ~/.dsh/storages/workspace.json. Er is geen
commandoregel voor, dus dit past het bestand aan. Het script:

1. maakt een reservekopie
2. kijkt of het pad er al in staat (dan gebeurt er niets)
3. voegt een workspace toe met een nieuw id
4. controleert dat het resultaat nog geldige JSON is

Daarna moet de dsh-web-service herstart worden, anders schrijft die zijn eigen
versie uit het geheugen terug.

    python3 tools/dsh-workspace.py /home/ubuntu/cavascp
"""

from __future__ import annotations

import json
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

STORAGE = Path.home() / ".dsh" / "storages" / "workspace.json"


def main() -> int:
    if len(sys.argv) < 2:
        print("gebruik: dsh-workspace.py <pad> [titel]")
        return 2

    pad = str(Path(sys.argv[1]).expanduser().resolve())
    titel = sys.argv[2] if len(sys.argv) > 2 else Path(pad).name

    if not Path(pad).is_dir():
        print(f"  map bestaat niet: {pad}")
        return 1

    if not STORAGE.exists():
        print(f"  geen workspace-bestand op {STORAGE}")
        return 1

    ruw = STORAGE.read_text(encoding="utf-8")
    data = json.loads(ruw)

    workspaces = data.setdefault("tables", {}).setdefault("workspaces", {})
    ids = data.setdefault("global", {}).setdefault("workspaceIds", [])

    # Staat het pad er al in? Dan niets doen.
    for wid, entry in workspaces.items():
        if str(entry.get("path", "")).strip() == pad:
            print(f"  staat er al: {entry.get('title')} ({wid})")
            return 0

    nieuw_id = str(uuid.uuid4())
    nu = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    workspaces[nieuw_id] = {
        "path": pad,
        "title": titel,
        "sessionIds": [],
        "createdAt": nu,
        "updatedAt": nu,
    }
    ids.append(nieuw_id)

    # Reservekopie voordat we schrijven.
    reserve = STORAGE.with_suffix(".json.bak")
    shutil.copy2(STORAGE, reserve)

    STORAGE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Controle: is het nog leesbaar, en staat het erin?
    check = json.loads(STORAGE.read_text(encoding="utf-8"))
    erin = check["tables"]["workspaces"].get(nieuw_id)
    if not erin:
        print("  er ging iets mis: het item staat er niet in")
        return 1

    print(f"  toegevoegd: {titel}")
    print(f"     pad    : {pad}")
    print(f"     id     : {nieuw_id}")
    print(f"     totaal : {len(check['global']['workspaceIds'])} workspaces")
    print(f"     backup : {reserve}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
