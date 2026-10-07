#!/usr/bin/env python3
"""Probe the evidence layer: submission comments, rubric assessments, file attachments.

These are the endpoints that decide whether the tracker can show *why* something was
graded, not just the number.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def get(base: str, token: str, path: str, query: dict[str, str] | None = None) -> tuple[int, object]:
    url = base + path
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "cavascp-evidence/0.1")
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(body)
        except json.JSONDecodeError:
            return exc.code, body[:200]
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def main() -> int:
    env = load_env(ROOT / ".env")
    base = env["CANVAS_BASE_URL"].rstrip("/")
    token = env["CANVAS_TOKEN"]

    # The assignment that is due today, plus its course, from the earlier capture.
    interesting = [
        (15973, "V-OL-MAIFS"),
        (15833, "INTERN5-T-CMK"),
        (16071, "MA-ISP"),
    ]

    print("=== submission detail with comments + rubric (include[]) ===")
    for cid, name in interesting:
        status, subs = get(
            base,
            token,
            f"/api/v1/courses/{cid}/students/submissions",
            {
                "student_ids[]": "self",
                "per_page": "100",
                "include[]": ["submission_comments", "rubric_assessment", "assignment", "user"],
            },
        )
        if status != 200 or not isinstance(subs, list):
            print(f"  [{status}] course {cid} ({name}) -> {str(subs)[:120]}")
            continue
        print(f"\n  course {cid} ({name}): {len(subs)} submissions")
        for s in subs:
            comments = s.get("submission_comments") or []
            rubric = s.get("rubric_assessment")
            asg = (s.get("assignment") or {}).get("name")
            print(
                f"    asg={s.get('assignment_id')} state={s.get('workflow_state'):<12} "
                f"score={s.get('score')} comments={len(comments)} rubric={'yes' if rubric else 'no'}"
            )
            if asg:
                print(f"        name: {asg[:70]}")
            for c in comments[:2]:
                author = (c.get("author_name") or (c.get("author") or {}).get("display_name") or "?")
                text = " ".join(str(c.get("comment", "")).split())
                print(f"        [{author}] {text[:110]}")
            if rubric:
                print(f"        rubric: {json.dumps(rubric)[:160]}")

    print()
    print("=== assignment detail: description + rubric definition ===")
    for cid, name in interesting:
        status, asgs = get(
            base,
            token,
            f"/api/v1/courses/{cid}/assignments",
            {"per_page": "100", "include[]": ["submission", "rubric", "all_dates"]},
        )
        if status != 200 or not isinstance(asgs, list):
            print(f"  [{status}] course {cid} -> {str(asgs)[:120]}")
            continue
        print(f"\n  course {cid} ({name}): {len(asgs)} assignments")
        for a in asgs:
            desc = " ".join(str(a.get("description") or "").split())
            rubric = a.get("rubric")
            sub = a.get("submission") or {}
            flags = []
            if rubric:
                flags.append(f"rubric({len(rubric)})")
            if desc:
                flags.append(f"desc({len(desc)}c)")
            if a.get("submission_types"):
                flags.append(",".join(a["submission_types"]))
            print(f"    id={a.get('id'):>8} due={str(a.get('due_at'))[:19]:<19} {str(a.get('name'))[:44]:<44} {' '.join(flags)}")
            if sub:
                print(f"        submission: state={sub.get('workflow_state')} submitted={str(sub.get('submitted_at'))[:19]}")

    print()
    print("=== individual submission (richest single object: comments, rubric, attachments) ===")
    # Pick a graded submission from the earlier capture to inspect in full.
    candidate: tuple[int, int] | None = None
    for course_dir in sorted((RAW / "courses").iterdir()):
        f = course_dir / "submissions_self.json"
        if not f.exists():
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for s in data:
            if s.get("workflow_state") == "graded" and s.get("submitted_at"):
                candidate = (int(course_dir.name), s["assignment_id"])
                break
        if candidate:
            break

    if candidate:
        cid, aid = candidate
        status, detail = get(
            base,
            token,
            f"/api/v1/courses/{cid}/assignments/{aid}/submissions/self",
            {"include[]": ["submission_comments", "rubric_assessment", "assignment", "user", "visibility"]},
        )
        print(f"  course {cid} assignment {aid} -> [{status}]")
        if status == 200 and isinstance(detail, dict):
            print(f"  keys: {sorted(detail.keys())}")
            out = RAW / "sample_submission_detail.json"
            out.write_text(json.dumps(detail, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  saved: {out.relative_to(ROOT)}")
            print(f"  attempt={detail.get('attempt')} grade={detail.get('grade')} score={detail.get('score')}")
            print(f"  body: {' '.join(str(detail.get('body') or '').split())[:200]}")
            for c in (detail.get("submission_comments") or [])[:3]:
                print(f"    comment: {json.dumps(c, ensure_ascii=False)[:200]}")
            if detail.get("rubric_assessment"):
                print(f"    rubric: {json.dumps(detail['rubric_assessment'], ensure_ascii=False)[:300]}")
            if detail.get("attachments"):
                for att in detail["attachments"]:
                    print(f"    attachment: {att.get('display_name')} ({att.get('size')} bytes) url={att.get('url')}")
    else:
        print("  no graded submission found to inspect")

    print()
    print("=== submission-level endpoints (permission check) ===")
    if candidate:
        cid, aid = candidate
        for label, path in [
            ("comments", f"/api/v1/courses/{cid}/assignments/{aid}/submissions/self/comments"),
            ("rubric_assessment", f"/api/v1/courses/{cid}/assignments/{aid}/submissions/self/rubric_assessment"),
            ("assignment_rubric", f"/api/v1/courses/{cid}/assignments/{aid}/rubric"),
        ]:
            status, body = get(base, token, path)
            print(f"  [{status:>3}] {label:<20} {str(body)[:110]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
