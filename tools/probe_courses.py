#!/usr/bin/env python3
"""Wat weet Canvas over een cursus? Alles wat het dashboard nodig heeft.

Proeft per cursus de bronnen die samen "wat is deze cursus" bepalen:
  - cursusdetail (naam, code, periode, syllabus)
  - modules en module-items (de leerroute)
  - announcements (mededelingen)
  - pages (informatiepagina's)
  - tabs (welke onderdelen de cursus heeft)
  - outcomes (leeruitkomsten, als de rechten dat toelaten)

Alleen-lezen. Ruwe antwoorden gaan naar data/raw/courses/<id>/.
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
RAW = ROOT / "data" / "raw" / "courses"


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
    req.add_header("User-Agent", "cavascp-course-probe/0.1")
    try:
        with urllib.request.urlopen(req, timeout=50) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, None
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def main() -> int:
    env = load_env(ROOT / ".env")
    base = env["CANVAS_BASE_URL"].rstrip("/")
    token = env["CANVAS_TOKEN"]

    status, courses = get(base, token, "/api/v1/courses", {"per_page": 100, "include[]": ["term", "syllabus_body", "teachers"]})
    if status != 200 or not isinstance(courses, list):
        sys.exit(f"cursussen ophalen mislukt: {status}")

    # Alleen cursussen met een enrollment (de rest is archief zonder inhoud).
    active = [c for c in courses if c.get("id")]
    print(f"cursussen: {len(active)}")
    print()

    summary = []

    for course in active:
        cid = course["id"]
        folder = RAW / str(cid)
        folder.mkdir(parents=True, exist_ok=True)

        row = {
            "id": cid,
            "name": course.get("name"),
            "code": course.get("course_code"),
            "term": (course.get("term") or {}).get("name"),
            "syllabus_chars": len(course.get("syllabus_body") or ""),
        }

        # Detail met syllabus (het overzicht gebruikt een eigen include-set).
        st, detail = get(base, token, f"/api/v1/courses/{cid}", {"include[]": ["syllabus_body", "term", "teachers", "course_image"]})
        if st == 200 and isinstance(detail, dict):
            (folder / "detail.json").write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
            row["syllabus_chars"] = len(detail.get("syllabus_body") or "")
            row["teachers"] = len(detail.get("teachers") or [])
            row["image"] = bool(detail.get("image_download_url"))

        probes = {
            "modules": ("/api/v1/courses/{cid}/modules", {"per_page": 100, "include[]": ["items"]}),
            "announcements": ("/api/v1/courses/{cid}/discussion_topics", {"per_page": 30, "only_announcements": "true"}),
            "pages": ("/api/v1/courses/{cid}/pages", {"per_page": 50}),
            "tabs": ("/api/v1/courses/{cid}/tabs", {}),
            "front_page": ("/api/v1/courses/{cid}/front_page", {}),
            "outcomes": ("/api/v1/courses/{cid}/outcome_groups", {"per_page": 50}),
            "assignments": ("/api/v1/courses/{cid}/assignments", {"per_page": 100, "include[]": ["submission"]}),
            "files": ("/api/v1/courses/{cid}/files", {"per_page": 20}),
        }

        for label, (tmpl, query) in probes.items():
            st, data = get(base, token, tmpl.format(cid=cid), query)
            if st == 200 and data is not None:
                (folder / f"{label}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                if isinstance(data, list):
                    n = len(data)
                elif isinstance(data, dict):
                    n = len(data.get("items", [])) if "items" in data else 1
                else:
                    n = 0
                row[label] = n
                if label == "modules" and isinstance(data, list):
                    row["module_item_total"] = sum(len(m.get("items") or []) for m in data)
            else:
                row[label] = f"[{st}]"

        summary.append(row)

        mods = row.get("modules")
        ann = row.get("announcements")
        items = row.get("module_item_total", 0)
        print(f"{cid:>7}  {str(row['name'])[:34]:<34} mod={mods!s:<4} items={items!s:<4} ann={ann!s:<4} tabs={row.get('tabs')!s:<4} pages={row.get('pages')!s:<4} outcomes={row.get('outcomes')!s:<5} syll={row['syllabus_chars']}")

    out = ROOT / "data" / "course-intel.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print()
    print(f"samenvatting: {out.relative_to(ROOT)}")
    print(f"ruwe data   : {RAW.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
