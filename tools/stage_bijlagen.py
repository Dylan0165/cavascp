#!/usr/bin/env python3
"""Bijlagen uit announcements halen, en de iteratiestructuur van de stage lezen.

    python tools/stage_bijlagen.py
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

TOKEN = [l.split("=", 1)[1].strip() for l in Path(".env").read_text(encoding="utf-8").splitlines() if l.startswith("CANVAS_TOKEN=")][0]
HOST = "https://fhict.instructure.com"
DOEL = Path("docs/stage")
DOEL.mkdir(parents=True, exist_ok=True)


def haal(pad: str, **params):
    url = HOST + "/api/v1" + pad
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + TOKEN, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


class Tekst(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.d: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "br", "li", "tr", "h1", "h2", "h3", "h4", "div", "td"):
            self.d.append("\n")

    def handle_data(self, data):
        self.d.append(data)

    def tekst(self) -> str:
        ruw = "".join(self.d)
        uit: list[str] = []
        for regel in (re.sub(r"[ \t]+", " ", r).strip() for r in ruw.split("\n")):
            if regel and (not uit or uit[-1] != regel):
                uit.append(regel)
        return "\n".join(uit)


def plat(html) -> str:
    if not html:
        return ""
    t = Tekst()
    t.feed(html)
    return t.tekst()


# ── 1. Bijlagen in announcements ──────────────────────────────────────────
print("=" * 78)
print("BIJLAGEN IN ANNOUNCEMENTS")
print("=" * 78)
for cursus_id, naam in [(16071, "MA-ISP"), (15833, "INTERN5")]:
    try:
        topics = haal(f"/courses/{cursus_id}/discussion_topics", per_page=30, only_announcements="true")
    except Exception as e:
        print(f"{naam}: mislukt ({e})")
        continue
    for a in topics:
        msg = a.get("message") or ""
        links = re.findall(r'href="([^"]+)"', msg)
        kandidaten = [
            l for l in links
            if "/files/" in l or "instructure-uploads" in l
            or re.search(r"\.(pdf|docx?|pptx?|xlsx?)$", l, re.I)
        ]
        bijlagen = a.get("attachments") or []
        if not kandidaten and not bijlagen:
            continue
        print(f"\n{naam} · {a.get('title')}")
        for b in bijlagen:
            print(f"   bijlage: {b.get('display_name')} ({b.get('size')} bytes)")
        for k in kandidaten[:8]:
            print(f"   link   : {k[:140]}")
            # Een /files/<id> kunnen we via de API ophalen.
            m = re.search(r"/files/(\d+)", k)
            if m:
                try:
                    info = haal(f"/files/{m.group(1)}")
                    dl = info.get("url")
                    naam_bestand = info.get("display_name") or f"bestand-{m.group(1)}"
                    req = urllib.request.Request(dl, headers={"Authorization": "Bearer " + TOKEN})
                    with urllib.request.urlopen(req, timeout=120) as r:
                        data = r.read()
                    (DOEL / naam_bestand).write_bytes(data)
                    print(f"            bewaard: {naam_bestand} ({len(data)} bytes)")
                except Exception as e:
                    print(f"            ophalen mislukt: {e}")

# ── 2. De iteraties van de stage ─────────────────────────────────────────
print()
print("=" * 78)
print("DE STAGE-ITERATIES (MA-ISP)")
print("=" * 78)
try:
    modules = haal("/courses/16071/modules", per_page=100, **{"include[]": ["items"]})
    for m in modules:
        print(f"\n[{m.get('position')}] {m.get('name')}  ({len(m.get('items') or [])} items)")
        for it in m.get("items") or []:
            titel = re.sub(r"^\s*\[[^\]]{1,24}\]\s*", "", str(it.get("title") or ""))
            print(f"     {str(it.get('type')):12} {titel[:60]}")
except Exception as e:
    print(f"mislukt: {e}")

# ── 3. De pagina's over het portfolio tijdens de stage ───────────────────
print()
print("=" * 78)
print("WAT ER TUSSEN DE ITERATIES GEVRAAGD WORDT")
print("=" * 78)
for url in ["showing-your-professional-behaviour", "week-2-3-portfolio-talk-with-fontys-internship-coach", "portflow-at-fontys-ict", "faq"]:
    try:
        p = haal(f"/courses/16071/pages/{url}")
        tekst = plat(p.get("body"))
        print(f"\n┌─ {p.get('title')}  ({len(tekst)} tekens)")
        for regel in tekst.split("\n")[:40]:
            print(f"│ {regel}")
        print("└" + "─" * 70)
    except Exception as e:
        print(f"\n┌─ {url}: niet gevonden ({e})")
