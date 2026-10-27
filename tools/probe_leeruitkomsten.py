#!/usr/bin/env python3
"""Wat zeggen de leeruitkomsten zelf?

Voor een automatische check moet de app weten wat elke leeruitkomst betekent.
Er zijn drie bronnen, en ze vullen elkaar aan:

  1. de Canvas-rubric bij de portfolio-opdracht — de niveaubeschrijvingen
     (Advanced / Proficient / Beginning / Orienting / Undefined)
  2. de Canvas-pagina's onder "Lesmateriaal (per leeruitkomst)" — de uitleg
  3. de opdrachtbeschrijving zelf

Dit script haalt ze op en schrijft ze naar data/leeruitkomsten.json, zodat de
check ze kan gebruiken zonder elke keer Canvas te bevragen.

    python tools/probe_leeruitkomsten.py
"""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

HOST = "https://fhict.instructure.com"


def lees_token() -> str:
    env = ROOT / ".env"
    for regel in env.read_text(encoding="utf-8").splitlines():
        if regel.startswith("CANVAS_TOKEN="):
            return regel.split("=", 1)[1].strip()
    raise SystemExit("CANVAS_TOKEN niet gevonden in .env")


TOKEN = lees_token()


def haal(pad: str, **params):
    import urllib.parse
    import urllib.request

    url = f"{HOST}/api/v1{pad}"
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


class TekstUit(HTMLParser):
    """HTML naar platte tekst, met alinea's op aparte regels."""

    def __init__(self) -> None:
        super().__init__()
        self.delen: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "br", "li", "tr", "h1", "h2", "h3", "h4", "div"):
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


def plat(html: str | None) -> str:
    if not html:
        return ""
    p = TekstUit()
    p.feed(html)
    return p.tekst()


CURSUS = 15973  # V-OL-MAIFS
OPDRACHT = 278562  # Portfolio voor eerste review

uit: dict = {"cursus": CURSUS, "opdracht": OPDRACHT, "bron": HOST}

print("=" * 78)
print("LEERUITKOMSTEN VERZAMELEN")
print("=" * 78)

# ── 1. De rubric ────────────────────────────────────────────────────────
print("\n1) Rubric bij de portfolio-opdracht")
try:
    opdracht = haal(f"/courses/{CURSUS}/assignments/{OPDRACHT}", **{"include[]": ["rubric_assessment"]})
    uit["opdracht_titel"] = opdracht.get("name")
    uit["opdracht_beschrijving"] = plat(opdracht.get("description"))
    print(f"   opdracht: {opdracht.get('name')}")

    rubric = opdracht.get("rubric") or []
    criteria = []
    for c in rubric:
        crit = {
            "id": c.get("id"),
            "beschrijving": c.get("description"),
            "langere_beschrijving": c.get("long_description"),
            "punten": c.get("points"),
            "niveaus": [],
        }
        for r in c.get("ratings") or []:
            crit["niveaus"].append(
                {
                    "punten": r.get("points"),
                    "naam": r.get("description"),
                    "uitleg": plat(r.get("long_description")),
                }
            )
        criteria.append(crit)
    uit["rubric"] = criteria
    print(f"   {len(criteria)} criteria")
    for c in criteria:
        print(f"      {str(c['beschrijving'])[:44]:<46} {len(c['niveaus'])} niveaus")
except Exception as e:
    print(f"   mislukt: {e}")

# ── 2. De lesmateriaal-pagina's ─────────────────────────────────────────
print("\n2) Pagina's onder 'Lesmateriaal (per leeruitkomst)'")
try:
    modules = haal(f"/courses/{CURSUS}/modules", per_page=100, **{"include[]": ["items"]})
    lesmodule = None
    for m in modules:
        if "lesmateriaal" in str(m.get("name", "")).lower():
            lesmodule = m
            break
    if lesmodule:
        print(f"   module: {lesmodule['name']} ({len(lesmodule.get('items') or [])} items)")
        paginas = []
        for item in (lesmodule.get("items") or []):
            if item.get("type") != "Page":
                continue
            url = item.get("page_url")
            if not url:
                continue
            try:
                pagina = haal(f"/courses/{CURSUS}/pages/{url}")
                tekst = plat(pagina.get("body"))
                paginas.append({"titel": pagina.get("title"), "url": url, "tekst": tekst, "lengte": len(tekst)})
                print(f"      {str(pagina.get('title'))[:46]:<48} {len(tekst):>6} tekens")
            except Exception as e:
                print(f"      {url}: mislukt ({e})")
        uit["lesmateriaal"] = paginas
    else:
        print("   geen module 'Lesmateriaal' gevonden")
except Exception as e:
    print(f"   mislukt: {e}")

# ── 3. De officiële uitkomsten ──────────────────────────────────────────
print("\n3) Officiële leeruitkomsten uit Canvas")
try:
    groepen = haal(f"/courses/{CURSUS}/outcome_groups", per_page=50)
    uitkomsten = []
    for g in groepen:
        lijst = haal(f"/courses/{CURSUS}/outcome_groups/{g['id']}/outcomes", per_page=100)
        for link in lijst:
            o = link.get("outcome") or {}
            if not o.get("title"):
                continue
            uitkomsten.append(
                {
                    "id": o.get("id"),
                    "titel": o.get("title"),
                    "beschrijving": plat(o.get("description")),
                    "groep": g.get("title"),
                }
            )
    uit["canvas_uitkomsten"] = uitkomsten
    for o in uitkomsten:
        print(f"   {str(o['titel'])[:52]:<54} {len(o['beschrijving']):>5} tekens")
except Exception as e:
    print(f"   mislukt: {e}")

doel = ROOT / "data" / "leeruitkomsten.json"
doel.write_text(json.dumps(uit, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nbewaard: {doel}")

# Laat zien wat we aan tekst hebben om mee te werken.
rubric_tekst = sum(len(str(c.get("langere_beschrijving") or "")) + sum(len(n["uitleg"]) for n in c["niveaus"]) for c in uit.get("rubric", []))
pagina_tekst = sum(p["lengte"] for p in uit.get("lesmateriaal", []))
print(f"\nsamen: {rubric_tekst} tekens rubric, {pagina_tekst} tekens lesmateriaal")
