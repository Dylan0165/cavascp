#!/usr/bin/env python3
"""Build a dossier of every portfolio-related assignment across all courses.

Research output only: reads Canvas, writes a Markdown briefing to docs/.
Answers "what does Fontys actually expect in my portfolio, and when".
"""

from __future__ import annotations

import json
import re
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
RAW = ROOT / "data" / "raw"
DOCS = ROOT / "docs"

# An assignment counts as portfolio work if its name or description mentions one of these.
KEYS = ("portfolio", "portflow", "review", "eindbeoordeling", "reflectie")

# Canvas descriptions are HTML; convert to readable plain text.
TAG_RE = re.compile(r"<[^>]+>")
BLOCK_RE = re.compile(r"</(p|div|li|h[1-6]|tr)>", re.IGNORECASE)
BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
LI_RE = re.compile(r"<li[^>]*>", re.IGNORECASE)


def html_to_text(html: str) -> str:
    if not html:
        return ""
    text = BR_RE.sub("\n", html)
    text = LI_RE.sub("\n- ", text)
    text = BLOCK_RE.sub("\n", text)
    text = TAG_RE.sub("", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    lines = [ln.strip() for ln in text.splitlines()]
    out: list[str] = []
    for ln in lines:
        if ln:
            out.append(ln)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()


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
    req.add_header("User-Agent", "cavascp-dossier/0.1")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def main() -> int:
    env = load_env(ROOT / ".env")
    base = env["CANVAS_BASE_URL"].rstrip("/")
    token = env["CANVAS_TOKEN"]

    status, courses = get(base, token, "/api/v1/courses", {"per_page": "100"})
    if status != 200 or not isinstance(courses, list):
        sys.exit(f"could not list courses: [{status}]")

    found: list[dict] = []
    for course in courses:
        cid = course.get("id")
        status, subs = get(
            base,
            token,
            f"/api/v1/courses/{cid}/students/submissions",
            {"student_ids[]": "self", "per_page": "100"},
        )
        subs_by_asg = {s["assignment_id"]: s for s in subs} if isinstance(subs, list) else {}

        status, asgs = get(
            base,
            token,
            f"/api/v1/courses/{cid}/assignments",
            {"per_page": "200", "include[]": ["rubric"]},
        )
        if status != 200 or not isinstance(asgs, list):
            continue

        for a in asgs:
            name = a.get("name") or ""
            desc = html_to_text(a.get("description") or "")
            haystack = f"{name}\n{desc}".lower()
            if not any(k in haystack for k in KEYS):
                continue
            sub = subs_by_asg.get(a["id"], {})
            rubric = a.get("rubric") or []
            criteria = []
            for c in rubric:
                if isinstance(c, dict):
                    criteria.append(
                        {
                            "description": c.get("description"),
                            "long_description": html_to_text(c.get("long_description") or ""),
                            "points": c.get("points"),
                            "ratings": [
                                {
                                    "description": r.get("description"),
                                    "long_description": html_to_text(r.get("long_description") or ""),
                                    "points": r.get("points"),
                                }
                                for r in (c.get("ratings") or [])
                                if isinstance(r, dict)
                            ],
                        }
                    )
            found.append(
                {
                    "course_id": cid,
                    "course_name": course.get("name"),
                    "assignment_id": a.get("id"),
                    "name": name,
                    "due_at": a.get("due_at"),
                    "unlock_at": a.get("unlock_at"),
                    "lock_at": a.get("lock_at"),
                    "points_possible": a.get("points_possible"),
                    "submission_types": a.get("submission_types"),
                    "html_url": a.get("html_url"),
                    "description": desc,
                    "rubric": criteria,
                    "state": sub.get("workflow_state", "unsubmitted"),
                    "submitted_at": sub.get("submitted_at"),
                    "grade": sub.get("grade"),
                    "score": sub.get("score"),
                    "late": sub.get("late"),
                    "missing": sub.get("missing"),
                    "attempts": sub.get("attempt"),
                    "attachments": [
                        {"display_name": x.get("display_name"), "size": x.get("size"), "url": x.get("url")}
                        for x in (sub.get("attachments") or [])
                    ],
                }
            )

    found.sort(key=lambda r: (r["due_at"] is None, r["due_at"] or ""))

    DATA = ROOT / "data"
    DATA.mkdir(exist_ok=True)
    (DATA / "portfolio_assignments.json").write_text(
        json.dumps(found, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    DOCS.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc)

    # Het gebruikers-id niet hardcoderen: dat is persoonsgebonden. We halen het
    # op bij Canvas, net als de rest.
    status, me = get(base, token, "/api/v1/users/self")
    who = f"{me.get('name')} (id {me.get('id')})" if status == 200 and isinstance(me, dict) else "onbekend"

    lines: list[str] = []
    lines.append("# Portfolio-dossier — Fontys ICT (Canvas)")
    lines.append("")
    lines.append(f"Gegenereerd: {now.strftime('%Y-%m-%d %H:%M UTC')}  ")
    lines.append(f"Canvas-gebruiker: {who} · {len(courses)} cursussen · {len(found)} portfolio-gerelateerde opdrachten")
    lines.append("")
    lines.append("> Automatisch opgehaald via de Canvas REST API met een persoonlijk toegangstoken.")
    lines.append("> Alleen-lezen: er is niets ingeleverd, gewijzigd of verwijderd.")
    lines.append("")

    open_items = [r for r in found if r["state"] == "unsubmitted"]
    done_items = [r for r in found if r["state"] != "unsubmitted"]
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    def is_open_and_dated(r: dict) -> bool:
        return r["state"] == "unsubmitted" and bool(r["due_at"])

    overdue = [r for r in open_items if is_open_and_dated(r) and r["due_at"] < now_iso]
    upcoming = [r for r in open_items if is_open_and_dated(r) and r["due_at"] >= now_iso]
    undated = [r for r in open_items if not r["due_at"]]

    lines.append("## Samenvatting")
    lines.append("")
    lines.append(f"- **Open**: {len(open_items)} opdrachten "
                 f"({len(upcoming)} met een toekomstige deadline, {len(overdue)} verlopen, {len(undated)} zonder deadline)")
    lines.append(f"- **Ingediend/beoordeeld**: {len(done_items)} opdrachten")
    if upcoming:
        nxt = upcoming[0]
        lines.append(f"- **Eerstvolgende deadline**: {str(nxt['due_at'])[:10]} — {nxt['name']} ({nxt['course_name']})")
    if overdue:
        lines.append("")
        lines.append(f"### Verlopen maar nog open ({len(overdue)})")
        lines.append("")
        for r in overdue:
            lines.append(f"- {str(r['due_at'])[:10]} — {r['name']} ({r['course_name']})")
    if upcoming:
        lines.append("")
        lines.append(f"### Komende deadlines ({len(upcoming)})")
        lines.append("")
        for r in upcoming:
            lines.append(f"- {str(r['due_at'])[:10]} — {r['name']} ({r['course_name']})")
    lines.append("")

    lines.append("## Alle portfolio-deadlines op een rij")
    lines.append("")
    lines.append("| Deadline | Opdracht | Cursus | Status | Rubric |")
    lines.append("|---|---|---|---|---|")
    for r in found:
        due = str(r["due_at"])[:10] if r["due_at"] else "—"
        state = {"unsubmitted": "**open**", "submitted": "ingediend", "graded": "beoordeeld"}.get(
            r["state"], r["state"]
        )
        rub = f"{len(r['rubric'])} criteria" if r["rubric"] else "—"
        name = str(r["name"]).replace("|", "/")
        lines.append(f"| {due} | {name} | {r['course_name']} | {state} | {rub} |")
    lines.append("")

    lines.append("## Details per opdracht")
    lines.append("")
    for r in found:
        lines.append(f"### {r['name']}")
        lines.append("")
        lines.append(f"- **Cursus**: {r['course_name']} (`{r['course_id']}`)")
        lines.append(f"- **Deadline**: {str(r['due_at'])[:19] if r['due_at'] else 'geen'}")
        lines.append(f"- **Status**: {r['state']}" + (f" · ingeleverd {str(r['submitted_at'])[:19]}" if r["submitted_at"] else ""))
        if r["grade"] is not None:
            lines.append(f"- **Beoordeling**: {r['grade']} ({r['score']} punten)")
        if r["late"]:
            lines.append("- ⚠️ Te laat ingeleverd")
        if r["missing"]:
            lines.append("- ⚠️ Staat als *missing* geregistreerd")
        lines.append(f"- **Inlevervorm**: {', '.join(r['submission_types'] or []) or '—'}")
        if r["html_url"]:
            lines.append(f"- **Canvas-link**: {r['html_url']}")
        if r["attachments"]:
            lines.append("- **Ingediende bestanden**:")
            for att in r["attachments"]:
                lines.append(f"  - {att['display_name']} ({att['size']} bytes)")
        lines.append("")
        if r["description"]:
            lines.append("**Opdrachtomschrijving**")
            lines.append("")
            for ln in r["description"].splitlines():
                lines.append(f"> {ln}" if ln else ">")
            lines.append("")
        if r["rubric"]:
            lines.append("**Beoordelingscriteria (rubric)**")
            lines.append("")
            for c in r["rubric"]:
                lines.append(f"- **{c['description']}** ({c['points']} pt)")
                if c["long_description"]:
                    for ln in c["long_description"].splitlines():
                        lines.append(f"  - {ln}")
                for rating in c["ratings"]:
                    if rating["description"]:
                        lines.append(f"  - {rating['points']} pt — {rating['description']}")
            lines.append("")

    out = DOCS / "portfolio-dossier.md"
    out.write_text("\n".join(lines), encoding="utf-8")

    print(f"portfolio-related assignments: {len(found)} (open: {len(open_items)})")
    print()
    for r in found:
        due = str(r["due_at"])[:10] if r["due_at"] else "     —    "
        mark = "OPEN" if r["state"] == "unsubmitted" else r["state"].upper()
        print(f"  {due}  {mark:<10} {str(r['name'])[:44]:<44} {str(r['course_name'])[:18]}")
    print()
    print(f"data : {(DATA / 'portfolio_assignments.json').relative_to(ROOT)}")
    print(f"docs : {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
