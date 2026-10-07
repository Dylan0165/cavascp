#!/usr/bin/env python3
"""Determine which Canvas host accepts the configured token, and why it fails elsewhere.

Read-only: GET /api/v1/users/self plus a couple of innocuous endpoints per host.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

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


HOSTS = [
    "fhict.instructure.com",
    "fontysict.instructure.com",
    "fontys.instructure.com",
    "fhict.beta.instructure.com",
    "fhict.test.instructure.com",
    "fontysict.beta.instructure.com",
    "canvas.fontys.nl",
]


def get(url: str, token: str, use_query: bool = False) -> tuple[int, str, dict]:
    if use_query:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}access_token={urllib.parse.quote(token)}"
    req = urllib.request.Request(url, method="GET")
    if not use_query:
        req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "cavascp-hostprobe/0.1")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace"), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace"), dict(exc.headers or {})
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}", {}


def main() -> int:
    env = load_env(ROOT / ".env")
    token = env.get("CANVAS_TOKEN", "")
    if not token:
        sys.exit("CANVAS_TOKEN missing")

    print(f"token fingerprint: {token[:5]}...{token[-4:]} (len={len(token)})")
    print()
    winners: list[str] = []
    for host in HOSTS:
        url = f"https://{host}/api/v1/users/self"
        status, body, headers = get(url, token)
        snippet = " ".join(body.split())[:160]
        print(f"[{status:>3}] {host:<34} {snippet}")
        if status == 200:
            winners.append(host)
            out = ROOT / "data" / "raw" / f"identity_{host}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(body, encoding="utf-8")

    print()
    if winners:
        print(f"ACCEPTED BY: {', '.join(winners)}")
        # Confirm the query-parameter form also works, since some tools use it.
        host = winners[0]
        status, _, _ = get(f"https://{host}/api/v1/users/self", token, use_query=True)
        print(f"query-parameter form on {host}: [{status}]")
    else:
        print("NO HOST ACCEPTED THE TOKEN.")
        print("Checking whether the host itself is reachable and what it says unauthenticated:")
        status, body, headers = get("https://fhict.instructure.com/api/v1/users/self", "invalid")
        print(f"  unauthenticated probe -> [{status}] {' '.join(body.split())[:200]}")
        print(f"  WWW-Authenticate: {headers.get('WWW-Authenticate', '(none)')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
