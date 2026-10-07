#!/usr/bin/env python3
"""Print a readable digest of the captured Canvas data so the tracker can be designed around it."""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Course and assignment titles contain emoji/punctuation; the Windows console
# defaults to cp1252 and would abort on them.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def load(name: str):
    path = RAW / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def head(title: str) -> None:
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


identity = load("verify_identity.json") or load("identity__users_self.json")
head("IDENTITY")
if identity:
    for key in ("id", "name", "sortable_name", "short_name", "time_zone", "locale"):
        print(f"  {key:<14}: {identity.get(key)}")

courses = load("courses__courses.json") or []
head(f"COURSES ({len(courses)})")
for c in courses:
    term = (c.get("term") or {}).get("name")
    print(f"  {c.get('id'):>7}  {str(c.get('name'))[:46]:<46} {c.get('workflow_state'):<10} {term or ''}")

prints = load("courses__courses.json"), load("courses__courses.json")
todos = load("todo__users_self_todo.json") or []
head(f"TODO ({len(todos)})")
for t in todos:
    kind = t.get("type")
    payload = t.get("assignment") or t.get("quiz") or {}
    ctx = t.get("context_name") or payload.get("course_id")
    print(f"  {kind:<14} {str(payload.get('name'))[:52]:<52} ctx={ctx}")

missing = load("missing__users_self_missing_submissions.json") or []
head(f"MISSING SUBMISSIONS ({len(missing)})")
for m in missing:
    print(f"  course {m.get('course_id'):>7}  {str(m.get('name'))[:60]}")

planner = load("planner__planner_items.json") or []
head(f"PLANNER ITEMS ({len(planner)})")
kinds: dict[str, int] = {}
for p in planner:
    kinds[p.get("plannable_type", "?")] = kinds.get(p.get("plannable_type", "?"), 0) + 1
print(f"  by type: {kinds}")
for p in planner[:8]:
    print(
        f"  {str(p.get('plannable_type'))[:18]:<18} due={str(p.get('plannable_date'))[:19]}  "
        f"{str((p.get('plannable') or {}).get('name') or (p.get('plannable') or {}).get('title'))[:44]}"
    )

upcoming = load("upcoming__users_self_upcoming_events.json") or []
head(f"UPCOMING EVENTS ({len(upcoming)})")
for u in upcoming[:10]:
    print(f"  {str(u.get('type'))[:16]:<16} {str(u.get('title'))[:50]:<50} {str(u.get('start_at'))[:19]}")

groups = load("groups__users_self_groups.json") or []
head(f"GROUPS ({len(groups)})")
for g in groups:
    print(f"  {g.get('id'):>7}  {str(g.get('name'))[:60]}")

summary = load("_summary.json") or {}
rows = summary.get("results", [])
ok = sum(1 for r in rows if r.get("status") == 200)
denied = [r for r in rows if r.get("status") == 403]
head(f"ENDPOINT REACH: {ok} ok / {len(rows)} probed, {len(denied)} forbidden")
for r in denied:
    print(f"  403  {r.get('label')}")

# Per-course assignment shape: show one real assignment in full so field names are known.
course_dir = RAW / "courses"
if course_dir.exists():
    subject = None
    for candidate in sorted(course_dir.iterdir(), key=lambda p: p.name):
        f = candidate / "assignments.json"
        if f.exists():
            data = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                subject = (candidate.name, data)
                break
    if subject:
        cid, data = subject
        head(f"ASSIGNMENT SHAPE (course {cid}, {len(data)} assignments)")
        first = data[0]
        print(f"  keys: {sorted(first.keys())}")
        print()
        for a in data:
            print(
                f"  id={a.get('id'):>8}  due={str(a.get('due_at'))[:19]:<19} "
                f"pts={a.get('points_possible')}  sub_types={a.get('submission_types')}  {str(a.get('name'))[:40]}"
            )

    sub_subject = None
    for candidate in sorted(course_dir.iterdir(), key=lambda p: p.name):
        f = candidate / "submissions_self.json"
        if f.exists():
            data = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                sub_subject = (candidate.name, data)
                break
    if sub_subject:
        cid, data = sub_subject
        head(f"SUBMISSION SHAPE (course {cid}, {len(data)} submissions)")
        first = data[0]
        print(f"  keys: {sorted(first.keys())}")
        print()
        for s in data:
            print(
                f"  asg={s.get('assignment_id'):>8}  state={str(s.get('workflow_state')):<12} "
                f"score={s.get('score')}/{s.get('points_possible')}  submitted={str(s.get('submitted_at'))[:19]}  "
                f"late={s.get('late')} missing={s.get('missing')}"
            )

files = load("files__users_self_files.json") or []
head(f"MY FILES ({len(files)})")
for f in files[:6]:
    print(f"  {f.get('id'):>9}  {str(f.get('display_name'))[:52]:<52} {f.get('size')} bytes  {f.get('content-type') or f.get('content_type')}")

eport = load("eportfolios__users_self_eportfolios.json")
head("EPORTFOLIOS (Canvas-native)")
print(f"  response: {eport!r}  -> Canvas-native ePortfolio is not used on this account.")
