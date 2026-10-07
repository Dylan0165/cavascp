#!/usr/bin/env python3
"""Probe which Canvas API endpoints this token can reach.

Read-only reconnaissance: issues GET requests only, never writes.
Raw responses are stored under data/raw/ so the real data shapes can be inspected.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
RAW_DIR = ROOT / "data" / "raw"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        sys.exit(f"missing {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


# (label, path, query) — every entry is a read-only GET.
PROBES: list[tuple[str, str, dict[str, str]]] = [
    ("identity:/users/self", "/api/v1/users/self", {}),
    ("profile:/users/self/profile", "/api/v1/users/self/profile", {}),
    ("courses:/courses", "/api/v1/courses", {"per_page": "50", "include[]": "term"}),
    ("enrollments:/users/self/enrollments", "/api/v1/users/self/enrollments", {"per_page": "50"}),
    ("todo:/users/self/todo", "/api/v1/users/self/todo", {"per_page": "50"}),
    ("todo_count:/users/self/todo_item_count", "/api/v1/users/self/todo_item_count", {}),
    ("upcoming:/users/self/upcoming_events", "/api/v1/users/self/upcoming_events", {}),
    ("planner:/planner/items", "/api/v1/planner/items", {"per_page": "50"}),
    ("missing:/users/self/missing_submissions", "/api/v1/users/self/missing_submissions", {}),
    ("groups:/users/self/groups", "/api/v1/users/self/groups", {}),
    ("activity:/users/self/activity_stream", "/api/v1/users/self/activity_stream", {"per_page": "20"}),
    ("conversations:/conversations", "/api/v1/conversations", {"per_page": "20"}),
    ("eportfolios:/users/self/eportfolios", "/api/v1/users/self/eportfolios", {}),
    ("outcomes:/outcomes", "/api/v1/outcomes", {}),
    ("rubrics:/users/self/rubrics", "/api/v1/users/self/rubrics", {}),
    ("files:/users/self/files", "/api/v1/users/self/files", {"per_page": "10"}),
    ("activity_stream_summary", "/api/v1/users/self/activity_stream/summary", {}),
    ("dashboard_cards", "/api/v1/dashboard/dashboard_cards", {}),
    ("course_nicknames", "/api/v1/users/self/course_nicknames", {}),
    ("calendar_events", "/api/v1/calendar_events", {"per_page": "10"}),
]

PER_COURSE = [
    ("assignments", "/api/v1/courses/{cid}/assignments", {"per_page": "100"}),
    ("submissions_self", "/api/v1/courses/{cid}/students/submissions", {"student_ids[]": "self", "per_page": "100"}),
    ("enrollments", "/api/v1/courses/{cid}/enrollments", {"per_page": "20"}),
    ("modules", "/api/v1/courses/{cid}/modules", {"per_page": "50"}),
    ("pages", "/api/v1/courses/{cid}/pages", {"per_page": "20"}),
    ("outcome_results", "/api/v1/courses/{cid}/outcome_results", {"per_page": "50"}),
    ("rubrics", "/api/v1/courses/{cid}/rubrics", {"per_page": "50"}),
    ("assignment_groups", "/api/v1/courses/{cid}/assignment_groups", {"per_page": "50"}),
    ("users_self", "/api/v1/courses/{cid}/users/self", {}),
    ("tabs", "/api/v1/courses/{cid}/tabs", {}),
]


def fetch(base: str, token: str, path: str, query: dict[str, str]) -> dict:
    url = base.rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "cavascp-probe/0.1")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            status = resp.status
            link = resp.headers.get("Link", "")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        status = exc.code
        link = exc.headers.get("Link", "") if exc.headers else ""
    except Exception as exc:  # network-level failure
        return {"status": 0, "error": f"{type(exc).__name__}: {exc}", "data": None, "count": None}

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None

    count = len(data) if isinstance(data, list) else (1 if isinstance(data, dict) and status == 200 else None)
    return {"status": status, "data": data, "raw": body, "count": count, "link": link}


def main() -> int:
    env = load_env(ENV_FILE)
    base = env.get("CANVAS_BASE_URL", "").rstrip("/")
    token = env.get("CANVAS_TOKEN", "")
    if not base or not token:
        sys.exit("CANVAS_BASE_URL / CANVAS_TOKEN missing in .env")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []

    print(f"host: {base}")
    print(f"token: {token[:5]}...{token[-4:]}  (len={len(token)})")
    print(f"time: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    print()

    for label, path, query in PROBES:
        res = fetch(base, token, path, query)
        safe = label.replace(":", "_").replace("/", "_")
        if res.get("raw") is not None:
            (RAW_DIR / f"{safe}.json").write_text(res["raw"], encoding="utf-8")
        results.append({"label": label, "path": path, "status": res["status"], "count": res.get("count")})
        note = res.get("error", "")
        print(f"[{res['status']:>3}] {label:<38} n={res.get('count')}  {note}")

    # First pass already told us which courses exist; only recurse when we got a course list.
    courses_res = next((r for r in results if r["label"] == "courses:/courses"), None)
    courses_data = None
    if courses_res and RAW_DIR.joinpath("courses__courses.json").exists():
        try:
            courses_data = json.loads(RAW_DIR.joinpath("courses__courses.json").read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            courses_data = None

    if isinstance(courses_data, list) and courses_data:
        print(f"\n--- per-course probes ({len(courses_data)} courses) ---")
        for course in courses_data[:20]:
            cid = course.get("id")
            name = course.get("name") or course.get("course_code")
            print(f"\n* {cid} — {name}")
            for label, tmpl, query in PER_COURSE:
                res = fetch(base, token, tmpl.format(cid=cid), query)
                folder = RAW_DIR / "courses" / str(cid)
                folder.mkdir(parents=True, exist_ok=True)
                if res.get("raw") is not None:
                    (folder / f"{label}.json").write_text(res["raw"], encoding="utf-8")
                results.append(
                    {"label": f"course:{cid}:{label}", "status": res["status"], "count": res.get("count")}
                )
                print(f"    [{res['status']:>3}] {label:<20} n={res.get('count')}")

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "host": base,
        "results": results,
    }
    (RAW_DIR / "_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nwrote {RAW_DIR / '_summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
