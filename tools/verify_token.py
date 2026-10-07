#!/usr/bin/env python3
"""Verify the Canvas token in .env and report what it can reach.

Usage:
    python tools/verify_token.py            # uses .env
    python tools/verify_token.py <token>    # tests a token without editing .env

Read-only: GET requests only.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def get(url: str, token: str) -> tuple[int, str]:
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "cavascp-verify/0.1")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def main() -> int:
    env = load_env(ENV_FILE)
    base = env.get("CANVAS_BASE_URL", "https://fhict.instructure.com").rstrip("/")
    token = sys.argv[1].strip() if len(sys.argv) > 1 else env.get("CANVAS_TOKEN", "")
    if not token:
        sys.exit("no token: pass one as an argument or set CANVAS_TOKEN in .env")

    print(f"host : {base}")
    print(f"token: {token[:5]}...{token[-4:]} (len={len(token)})")
    print()

    status, body = get(f"{base}/api/v1/users/self", token)
    if status != 200:
        snippet = " ".join(body.split())[:200]
        print(f"[{status}] REJECTED — {snippet}")
        if status == 401:
            print()
            print("This token is not accepted. Regenerate it on the Access Token Details")
            print("page and use the copy button, then paste it here.")
        return 1

    user = json.loads(body)
    print(f"[200] TOKEN WORKS")
    print(f"      user   : {user.get('name')}")
    print(f"      id     : {user.get('id')}")
    print(f"      login  : {user.get('login_id')}")
    print()

    status, body = get(f"{base}/api/v1/courses?per_page=50&enrollment_state=active", token)
    if status != 200:
        print(f"[{status}] courses endpoint unavailable: {' '.join(body.split())[:150]}")
        return 1

    courses = json.loads(body)
    print(f"[200] {len(courses)} active course(s):")
    for course in courses:
        print(f"      {course.get('id'):>7}  {course.get('name')}")

    (ROOT / "data" / "raw").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "raw" / "verify_identity.json").write_text(json.dumps(user, indent=2), encoding="utf-8")
    (ROOT / "data" / "raw" / "verify_courses.json").write_text(json.dumps(courses, indent=2), encoding="utf-8")
    print()
    print("saved: data/raw/verify_identity.json, data/raw/verify_courses.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
