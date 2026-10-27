#!/usr/bin/env python3
"""De eisen van de stage, uit de pagina's zelf.

De opdrachttitels zeggen weinig; de eisen staan in de pagina's. Dit haalt de
belangrijkste op en print de tekst, zodat je kunt lezen wat er gevraagd wordt.

    python tools/stage_eisen.py
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
HOST = "https://fhict.instructure.com"


def lees_token() -> str:
    for regel in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if regel.startswith("CANVAS_TOKEN="):
            return regel.split("=", 1)[1].strip()
    raise SystemExit("CANVAS_TOKEN niet gevonden")


TOKEN = lees_token()


def haal(pad: str, **params):
    url = f"{HOST}/api/v1{pad}"
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


class TekstUit(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.delen: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "br", "li", "tr", "h1", "h2", "h3", "h4", "div", "td"):
            self.delen.append("\n")

    def handle_data(self, data):
        self.delen.append(data)

    def tekst(self) -> str:
        ruw = "".join(self.delen)
        regels = [re.sub(r"[ \t]+", " ", r).strip() for r in ruw.split("\n")]
        uit: list[str] = []
        for r in regels:
            if r and (not uit or uit[-1] != r):
                uit.append(r)
        return "\n".join(uit)


def plat(html) -> str:
    if not html:
        return ""
    p = TekstUit()
    p.feed(html)
    return p.tekst()


# ── 1. De inleverstatus ────────────────────────────────────────────────
print("=" * 78)
print("INLEVERSTATUS")
print("=" * 78)
for cursus_id, naam in [(15833, "INTERN5-T-CMK"), (16071, "MA-ISP")]:
    print(f"\n{naam} (cursus {cursus_id})")
    try:
        opdrachten = haal(f"/courses/{cursus_id}/assignments", per_page=100, **{"include[]": ["submission"]})
        for a in sorted(opdrachten, key=lambda x: str(x.get("due_at") or "9999")):
            sub = a.get("submission") or {}
            status = sub.get("workflow_state", "?")
            poging = sub.get("attempt")
            ingeleverd = str(sub.get("submitted_at") or "")[:16].replace("T", " ")
            due = str(a.get("due_at"))[:16].replace("T", " ") if a.get("due_at") else "geen deadline"
            vlag = ""
            if a.get("due_at") and status == "unsubmitted":
                vlag = "  <<< NOG NIET INGELEVERD"
            print(f"   {due}  [{status:11}] {str(a.get('name'))[:44]:<44}{vlag}")
            if ingeleverd:
                print(f"                     ingeleverd: {ingeleverd}, poging {poging}")
    except Exception as e:
        print(f"   mislukt: {e}")

# ── 2. De eisen uit de pagina's ────────────────────────────────────────
PAGINAS = {
    15833: [
        "criteria-voor-de-opdracht-bedrijf-en-bedrijfsbegeleider",
        "cursus-opzet",
        "planning",
        "stagevoorwaarden",
        "looking-for-an-internship-position",
        "week-3-5-eerste-bedrijfsbezoek-eerste-portfolio-review",
        "portflow-bij-fontys-ict",
    ],
    16071: [
        "preparation-timeline-and-actions",
        "internship-proposal",
        "criteria-for-an-internship",
        "looking-for-an-internship-position",
        "faq",
    ],
}

for cursus_id, urls in PAGINAS.items():
    naam = "INTERN5-T-CMK" if cursus_id == 15833 else "MA-ISP"
    print()
    print("=" * 78)
    print(f"EISEN — {naam}")
    print("=" * 78)
    for url in urls:
        try:
            p = haal(f"/courses/{cursus_id}/pages/{url}")
            tekst = plat(p.get("body"))
            print()
            print(f"┌─ {p.get('title')}  ({len(tekst)} tekens)")
            print("│")
            for regel in tekst.split("\n"):
                print(f"│ {regel}")
            print("└" + "─" * 70)
        except Exception as e:
            print()
            print(f"┌─ {url}: niet gevonden ({e})")
