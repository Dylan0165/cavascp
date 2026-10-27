#!/usr/bin/env python3
"""Wat moet er voor de stage gebeuren?

Haalt de twee stagevakken vers op en laat zien wat erin staat: modules met hun
items, announcements, opdrachten met deadlines, en de tekst van de pagina's.
De eisen staan meestal in de pagina's, niet in de opdrachttitels.

    python tools/probe_stage.py            # overzicht
    python tools/probe_stage.py --tekst    # ook de volledige paginatekst
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
MET_TEKST = "--tekst" in sys.argv

STAGEVAKKEN = {
    15833: "INTERN5-T-CMK",
    16071: "MA-ISP",
}


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
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
        link = r.headers.get("Link", "")
    # Volg de volgende pagina als Canvas die aangeeft.
    volgende = None
    for deel in link.split(","):
        m = re.search(r'<([^>]+)>\s*;\s*rel="next"', deel)
        if m:
            volgende = m.group(1)
    if volgende:
        req2 = urllib.request.Request(
            volgende, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}
        )
        with urllib.request.urlopen(req2, timeout=60) as r2:
            meer = json.loads(r2.read().decode("utf-8"))
        if isinstance(data, list) and isinstance(meer, list):
            return data + meer
    return data


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


for cursus_id, naam in STAGEVAKKEN.items():
    print("=" * 78)
    print(f"{naam}  (cursus {cursus_id})")
    print("=" * 78)

    try:
        detail = haal(f"/courses/{cursus_id}", **{"include[]": ["term", "teachers"]})
        print(f"  naam     : {detail.get('name')}")
        print(f"  code     : {detail.get('course_code')}")
        print(f"  periode  : {(detail.get('term') or {}).get('name')}")
        docenten = [t.get("display_name") for t in (detail.get("teachers") or []) if t.get("display_name")]
        print(f"  docenten : {', '.join(docenten[:6]) or '—'}")
    except Exception as e:
        print(f"  cursusinfo mislukt: {e}")

    # ── Announcements ───────────────────────────────────────────────────
    print()
    print("  ANNOUNCEMENTS (nieuwste eerst)")
    try:
        ann = haal(f"/courses/{cursus_id}/discussion_topics", per_page=30, only_announcements="true")
        for a in ann[:12]:
            datum = str(a.get("posted_at") or a.get("created_at") or "")[:10]
            print(f"    {datum}  {str(a.get('title'))[:64]}")
            tekst = plat(a.get("message"))[:400].replace("\n", " ")
            if tekst:
                print(f"              {tekst}")
                print()
    except Exception as e:
        print(f"    mislukt: {e}")

    # ── Opdrachten met deadlines ────────────────────────────────────────
    print()
    print("  OPDRACHTEN")
    try:
        opdrachten = haal(f"/courses/{cursus_id}/assignments", per_page=100)
        for a in sorted(opdrachten, key=lambda x: str(x.get("due_at") or "9999")):
            due = str(a.get("due_at"))[:16].replace("T", " ") if a.get("due_at") else "geen deadline"
            sub = (a.get("submission") or {}).get("workflow_state", "?")
            print(f"    {due}  [{sub:11}] {str(a.get('name'))[:54]}")
            if a.get("points_possible") is not None:
                print(f"                  {a.get('points_possible')} punten · {', '.join(a.get('submission_types') or [])}")
    except Exception as e:
        print(f"    mislukt: {e}")

    # ── Modules met items ───────────────────────────────────────────────
    print()
    print("  MODULES")
    paginas: list[tuple[str, str]] = []
    try:
        modules = haal(f"/courses/{cursus_id}/modules", per_page=100, **{"include[]": ["items"]})
        for m in modules:
            items = m.get("items") or []
            print(f"    [{m.get('position')}] {str(m.get('name'))[:60]}  ({len(items)} items)")
            for it in items:
                titel = re.sub(r"^\s*\[[^\]]{1,24}\]\s*", "", str(it.get("title") or ""))
                print(f"          {str(it.get('type')):14} {titel[:58]}")
                if it.get("type") == "Page" and it.get("page_url"):
                    paginas.append((it.get("page_url"), titel))
    except Exception as e:
        print(f"    mislukt: {e}")

    # ── Pagina's ────────────────────────────────────────────────────────
    if MET_TEKST and paginas:
        print()
        print("  PAGINA'S (volledige tekst)")
        for url, titel in paginas:
            try:
                p = haal(f"/courses/{cursus_id}/pages/{url}")
                tekst = plat(p.get("body"))
                print()
                print(f"    ── {p.get('title')} — {len(tekst)} tekens " + "─" * 20)
                print(tekst[:3000])
                if len(tekst) > 3000:
                    print(f"    … en nog {len(tekst) - 3000} tekens")
            except Exception as e:
                print(f"    {titel}: mislukt ({e})")

    print()
