#!/usr/bin/env python3
"""Kunnen we de leeruitkomsten zelf lezen? En de cursusnav?

De outcome-groepen gaven alleen een id en een titel. De echte uitkomsten zitten
in /outcomes en /subgroups. Dit test of die bereikbaar zijn, plus de tabs
(welk cursusonderdeel staat aan) en de syllabus.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def get(base: str, token: str, path: str, query: dict | None = None):
    url = base + path
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "cavascp-outcome-probe/0.1")
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def main() -> int:
    env = load_env(ROOT / ".env")
    base = env["CANVAS_BASE_URL"].rstrip("/")
    token = env["CANVAS_TOKEN"]

    # Cursussen waar we leeruitkomsten verwachten: V-OL-MAIFS (de huidige minor)
    # en INTERN5 (de stage).
    for cid, label in [(15973, "V-OL-MAIFS"), (15833, "INTERN5-T-CMK"), (15720, "A-MA-CSE")]:
        print("=" * 70)
        print(f"{cid}  {label}")
        print("=" * 70)

        st, groups = get(base, token, f"/api/v1/courses/{cid}/outcome_groups", {"per_page": 50})
        print(f"  outcome_groups: [{st}] {len(groups) if isinstance(groups, list) else '?'}")
        if not isinstance(groups, list):
            print()
            continue

        for g in groups[:3]:
            gid = g.get("id")
            print(f"\n  groep {gid}: {g.get('title')}")

            st2, subs = get(base, token, f"/api/v1/courses/{cid}/outcome_groups/{gid}/subgroups", {"per_page": 50})
            print(f"    subgroups: [{st2}] {len(subs) if isinstance(subs, list) else '?'}")
            if isinstance(subs, list):
                for s in subs[:4]:
                    print(f"      - {s.get('title')} (id {s.get('id')})")

            st3, outs = get(base, token, f"/api/v1/courses/{cid}/outcome_groups/{gid}/outcomes", {"per_page": 50})
            print(f"    outcomes : [{st3}] {len(outs) if isinstance(outs, list) else '?'}")
            if isinstance(outs, list):
                for o in outs[:6]:
                    print(f"      - {str(o.get('title'))[:50]:<50} mastery={o.get('mastery_points')}")

        # Tabs: welk cursusonderdeel staat aan.
        st4, tabs = get(base, token, f"/api/v1/courses/{cid}/tabs")
        if isinstance(tabs, list):
            visible = [t.get("label") for t in tabs if t.get("visible")]
            print(f"\n  tabs zichtbaar ({len(visible)}): {', '.join(str(v) for v in visible)}")
        else:
            print(f"\n  tabs: [{st4}]")

        # Syllabus
        st5, detail = get(base, token, f"/api/v1/courses/{cid}", {"include[]": ["syllabus_body"]})
        if isinstance(detail, dict):
            body = detail.get("syllabus_body") or ""
            print(f"  syllabus: {len(body)} tekens")
            if body:
                clean = " ".join(body.replace("<", " <").split())
                print(f"    {clean[:200]}")
        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
