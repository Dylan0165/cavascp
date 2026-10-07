#!/usr/bin/env python3
"""Is this token valid on ANY Canvas instance? Distinguishes a bad token from a bad host."""

from __future__ import annotations

import sys
import urllib.error
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


# Canonical Instructure hosts, to see whether the token simply belongs elsewhere.
HOSTS = [
    "canvas.instructure.com",
    "www.instructure.com",
    "fhict.instructure.com",
]


def probe(host: str, token: str) -> tuple[int, str]:
    url = f"https://{host}/api/v1/users/self"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "cavascp-anywhere/0.1")
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")[:200]
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")[:200]
    except Exception as exc:
        return 0, f"{type(exc).__name__}: {exc}"


def main() -> int:
    env = load_env(ROOT / ".env")
    token = env.get("CANVAS_TOKEN", "")
    if not token:
        sys.exit("CANVAS_TOKEN missing")

    parts = token.split("~", 1)
    print(f"segments: {len(parts)}  prefix={parts[0]!r}  body_len={len(parts[1]) if len(parts) > 1 else 0}")
    body = parts[1] if len(parts) > 1 else ""
    print(f"body charset ok (A-Za-z0-9_-): {all(c.isalnum() or c in '-_' for c in body)}")
    print()

    for host in HOSTS:
        status, snippet = probe(host, token)
        print(f"[{status:>3}] {host:<28} {' '.join(snippet.split())[:110]}")

    print()
    print("Interpretation:")
    print("  200 on ANY host -> token is real but belongs to that instance; Fontys token needed.")
    print("  Invalid access token. everywhere -> this string was never a valid token")
    print("     (e.g. mis-copied by hand rather than via the copy button).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
