"""Submit all sitemap URLs to IndexNow-enabled search engines.

IndexNow lets you instantly notify Bing, Yandex, Seznam and Naver when
your content changes — no waiting for crawlers. You only submit to ONE
engine; they share the data via the IndexNow protocol.

Prerequisites (already in place):
  - Key file at site root: 0082185b12e396510dd37b9b37071d0f.txt
  - sitemap.xml with all public URLs

Usage:
    python tools/indexnow.py              # submit all sitemap URLs
    python tools/indexnow.py --check      # dry-run: show what would be submitted
    python tools/indexnow.py --urls /backtest /docs  # submit specific paths only

Exit codes:
    0  success (200 or 202 from IndexNow)
    1  API error or network failure
"""
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent.parent
SITEMAP = ROOT / "sitemap.xml"
SITE = "https://aqmath.xyz"

# One of the two existing key files at the repo root.
INDEXNOW_KEY = "0082185b12e396510dd37b9b37071d0f"
INDEXNOW_KEY_URL = f"{SITE}/{INDEXNOW_KEY}.txt"

# Submitting to any one of these propagates to all IndexNow partners.
# Bing is the most widely used; fallback endpoints listed for resilience.
INDEXNOW_ENDPOINTS = [
    "https://www.bing.com/indexnow",
    "https://yandex.com/indexnow",
    "https://www.searchindexnow.com/indexnow",
]

_LOC_RE = re.compile(r"<loc>\s*(https?://[^<]+)\s*</loc>")


def read_sitemap_urls() -> list[str]:
    """Extract all <loc> URLs from sitemap.xml via regex (no XML parser needed)."""
    if not SITEMAP.exists():
        raise SystemExit(f"sitemap.xml not found: {SITEMAP}")
    return _LOC_RE.findall(SITEMAP.read_text(encoding="utf-8"))


def submit(urls: list[str], endpoint: str, dry_run: bool = False) -> int:
    """POST URL list to IndexNow endpoint. Returns HTTP status code."""
    payload = {
        "host": SITE,
        "key": INDEXNOW_KEY,
        "key_location": INDEXNOW_KEY_URL,
        "urlList": urls,
    }
    if dry_run:
        print(f"  [DRY-RUN] Would submit {len(urls)} URLs to {endpoint}")
        for u in urls:
            print(f"    {u}")
        return 200

    body = json.dumps(payload).encode("utf-8")
    req = Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            status = resp.status
            print(f"  {endpoint} -> HTTP {status}")
            return status
    except HTTPError as e:
        print(f"  {endpoint} -> HTTP {e.code}: {e.reason}")
        return e.code
    except URLError as e:
        print(f"  {endpoint} -> ERROR: {e.reason}")
        return 0


def main() -> int:
    dry_run = "--check" in sys.argv

    # Parse --urls flag for selective submission
    custom_paths = []
    if "--urls" in sys.argv:
        idx = sys.argv.index("--urls")
        custom_paths = sys.argv[idx + 1:]

    if custom_paths:
        urls = [SITE + p if not p.startswith("http") else p for p in custom_paths]
    else:
        urls = read_sitemap_urls()

    if not urls:
        print("No URLs to submit.")
        return 1

    print(f"IndexNow: {len(urls)} URLs | key={INDEXNOW_KEY[:8]}... | dry_run={dry_run}")

    # Try endpoints in order; first success wins.
    for endpoint in INDEXNOW_ENDPOINTS:
        status = submit(urls, endpoint, dry_run=dry_run)
        if status in (200, 202):
            print(f"OK — {len(urls)} URLs submitted to IndexNow via {endpoint}")
            return 0
        if status == 400:
            print(f"FAIL — bad request (check key file exists at {INDEXNOW_KEY_URL})")
            return 1
        if status == 403:
            print(f"FAIL — key verification failed (key file not accessible)")
            return 1
        if status == 429:
            print(f"RATE LIMITED — too many submissions, try again later")
            return 1
        # Try next endpoint
        print(f"  Trying next endpoint...")

    print("FAIL — all endpoints failed")
    return 1


if __name__ == "__main__":
    sys.exit(main())
