"""Refresh the baked Forward Log snapshot from the live service.

Why this exists instead of backtesting-/make_forward_section.py
--------------------------------------------------------------
The Forward Log reaches visitors two ways:

  1. Live - app-boot.js fetches /forward-log on every page load and swaps it
     into #forwardLogLive. This is what users normally see.
  2. Baked - the copy committed between the FORWARD_LOG markers in
     _src/index.html, shown when that fetch fails (service cold, offline) and
     to crawlers that do not run the fetch.

Only (2) needs maintaining, and it used to be produced by
backtesting-/make_forward_section.py from that repo's local state/telemetry.json.
That file is a leftover: the daily job now runs inside the Railway service on
APScheduler (01:30 UTC) and keeps its state in Postgres, so the local JSON stops
advancing the moment you stop running the loop by hand. It was six days behind
the service when this script was written, and the old path had no way to notice.

So the snapshot is now taken from the live endpoint - the same renderer
(backtesting-/forward_section.py) that serves users. One renderer, one source of
truth, and no second copy of the charting code to drift.

Usage:  python tools/refresh_forward_log.py [--check]
        --check compares the baked snapshot against the live one and exits 1 if
        it is behind, without writing anything. Safe for CI.

Writes _src/index.html, then runs tools/build_pages.py to publish into
results.html. Commit both.

You normally do not need to run this: .github/workflows/forward-log-snapshot.yml
does it on GitHub's runners twice a week, commits the result and asks Pages to
rebuild. Run it by hand only to publish a snapshot ahead of the next cron, or
when debugging the renderer.
"""
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "_src" / "index.html"

ENDPOINT = "https://backtesting-production-be57.up.railway.app/forward-log"
TIMEOUT = 60

START = "<!-- FORWARD_LOG_START -->"
END = "<!-- FORWARD_LOG_END -->"
# app-boot.js swaps this div's innerHTML for the live fragment, so the wrapper
# has to be here and the fragment must go inside it.
LIVE_BOX_ID = "forwardLogLive"

DATE_RE = re.compile(r"Telemetry generated (\d{4}-\d{2}-\d{2})")
MIN_BYTES = 10_000


def fetch_fragment():
    req = urllib.request.Request(ENDPOINT, headers={"User-Agent": "aqmath-ui-refresh"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        if r.status != 200:
            raise SystemExit(f"{ENDPOINT} returned HTTP {r.status}")
        return r.read().decode("utf-8")


def validate(fragment):
    """Refuse anything that would not be a usable - or safe - static snapshot.

    This response gets baked into a committed page, where unlike the runtime
    innerHTML path any <script> would actually execute. The page's CSP would
    block inline script, but a snapshot that needs the CSP to save it is not a
    snapshot worth committing.
    """
    if len(fragment) < MIN_BYTES:
        raise SystemExit(f"fragment is only {len(fragment)} bytes - service likely errored")
    if 'id="forward-log"' not in fragment:
        raise SystemExit('fragment has no id="forward-log" heading - unexpected shape')
    for bad in ("<script", "javascript:", "<iframe", "<object"):
        if bad.lower() in fragment.lower():
            raise SystemExit(f"fragment contains {bad!r} - refusing to bake it into a page")
    m = DATE_RE.search(fragment)
    if not m:
        raise SystemExit("fragment has no 'Telemetry generated <date>' line - cannot date it")
    return m.group(1)


def baked_date(html):
    block = html.split(START)[1].split(END)[0]
    m = DATE_RE.search(block)
    return m.group(1) if m else None


def main(check_only=False):
    if not SRC.exists():
        raise SystemExit(f"source missing: {SRC.relative_to(ROOT)}")
    html = SRC.read_text(encoding="utf-8")
    for marker in (START, END):
        if marker not in html:
            raise SystemExit(f"{marker} not found in {SRC.relative_to(ROOT)}")

    try:
        fragment = fetch_fragment()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        # In --check this must not fail the build: an unreachable service says
        # nothing about whether the committed snapshot is stale.
        msg = f"could not reach {ENDPOINT}: {e}"
        if check_only:
            print(f"SKIP - {msg}")
            return 0
        raise SystemExit(msg)

    live = validate(fragment)
    have = baked_date(html)
    print(f"baked snapshot: {have or 'none'}   live service: {live}")

    if have == live:
        print("snapshot already current")
        return 0

    if check_only:
        print("STALE - re-run without --check to refresh")
        return 1

    pre = html.split(START)[0]
    post = html.split(END)[1]
    block = f'<div id="{LIVE_BOX_ID}">\n{fragment}\n</div>'
    SRC.write_text(pre + START + "\n" + block + "\n" + END + post, encoding="utf-8")
    print(f"injected {len(fragment):,} chars into {SRC.relative_to(ROOT)}")

    r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_pages.py")], cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit("build_pages.py failed - _src is written but artifacts are stale")
    print("done - commit _src/index.html and the regenerated entry pages")
    return 0


if __name__ == "__main__":
    sys.exit(main(check_only="--check" in sys.argv))
