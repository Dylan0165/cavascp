#!/usr/bin/env python3
"""Controleert of het Canvas-token nog werkt, en of het dashboard hetzelfde ziet.

Nuttig als iets 401 geeft: dan zie je meteen of het aan het token ligt of aan
de code die het gebruikt.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"

waarden: dict[str, str] = {}
for regel in ENV.read_text(encoding="utf-8").splitlines():
    if "=" in regel and not regel.strip().startswith("#"):
        k, _, v = regel.partition("=")
        waarden[k.strip()] = v.strip()

token = waarden.get("CANVAS_TOKEN", "")
basis = waarden.get("CANVAS_BASE_URL", "https://fhict.instructure.com")

print(f".env        : {ENV}")
print(f"basis       : {basis}")
print(f"token lengte: {len(token)}")
print(f"token begin : {token[:6]}…")
print(f"token eind  : …{token[-4:] if token else ''}")
print(f"bevat ~     : {'ja' if '~' in token else 'NEE'}")
if "~" in token:
    links, _, rechts = token.partition("~")
    print(f"  devkey    : {len(links)} tekens")
    print(f"  geheim    : {len(rechts)} tekens")
print()

# 1. Rechtstreeks tegen Canvas.
print("=== rechtstreeks ===")
req = urllib.request.Request(
    f"{basis}/api/v1/users/self",
    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    print(f"  status 200 — ingelogd als {data.get('name')} (id {data.get('id')})")
    direct_ok = True
except urllib.error.HTTPError as e:
    print(f"  status {e.code} — {e.reason}")
    lichaam = e.read().decode("utf-8", errors="replace")[:300]
    print(f"  antwoord: {lichaam}")
    direct_ok = False
except Exception as e:
    print(f"  mislukt: {e}")
    direct_ok = False

# 2. Via het dashboard, als dat draait.
print()
print("=== via het dashboard ===")
try:
    import http.cookiejar
    import urllib.request as u

    jar = http.cookiejar.CookieJar()
    opener = u.build_opener(u.HTTPCookieProcessor(jar))
    opener.open("http://127.0.0.1:8787/", timeout=15).read()
    vraag = u.Request(
        "http://127.0.0.1:8787/api/data", headers={"Origin": "http://127.0.0.1:8787"}
    )
    with opener.open(vraag, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    if data.get("error"):
        print(f"  dashboard zegt: {data['error']}")
    else:
        print(f"  dashboard werkt — periode {data.get('currentTerm')}, "
              f"{len(data.get('courses') or [])} cursussen")
except Exception as e:
    print(f"  dashboard niet bereikbaar of gaf een fout: {e}")

print()
if not direct_ok:
    print("Het token werkt niet meer. Maak een nieuwe aan:")
    print("  Canvas → Account → Instellingen → Nieuwe toegangssleutel")
    print("  en zet hem in .env als CANVAS_TOKEN=...")
