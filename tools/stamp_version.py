"""Stamp one single build id onto every first-party asset URL.

Why this exists
---------------
The cache-busters used to be hand-edited per file, so they drifted apart
(styles.min.css?v=20260808, app.js?v=20260807, app-boot.js?v=20260806,
app-widgets.js?v=20260801, locales/*.json?v=20260730). A returning visitor
whose browser had some of those files cached would then run a *mixed* build:
new HTML against stale JS, or new markup against stale locale strings. That is
exactly the class of bug where "works for me" and "broken for them" both hold.

One id for the whole asset set makes the version atomic: a visitor either has
the complete new build or the complete old one, never a blend.

The id is a content hash, not a date, so it is:
  * automatic   - no human has to remember to bump it,
  * idempotent  - re-running without touching an asset is a no-op (no needless
                  cache bust for users),
  * honest      - it changes if and only if shipped bytes changed.

The existing `?v=` values are stripped before hashing, otherwise stamping a
file would change its own hash and the id would never settle.

Usage
-----
    python tools/stamp_version.py            # rewrite stamps in place
    python tools/stamp_version.py --check    # verify only, exit 1 if stale

Run this *before* tools/build_pages.py, so the generated per-route pages
inherit the fresh stamp. The stamp is written into _src/index.html (the SPA
source), never into the generated root pages - those are overwritten anyway.

The build id is also mirrored to version.txt in the site root: app-boot.js
fetches it at runtime and compares it against its own ?v= stamp, so a visitor
on a stale cached build gets the update banner (see app-boot.js section 5).
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Files whose bytes define "the app version" the visitor runs.
ASSETS = [
    "styles.min.css",
    "app.js",
    "app-widgets.js",
    "app-backtest.js",
    "app-boot.js",
    "locales/en.json",
    "locales/zh-CN.json",
]

# Every place a stamp has to be written. Each regex must have exactly one
# capture group wrapping the version value itself.
#
# social-preview.png keeps its own hand-set stamp on purpose: it is consumed by
# social-media scrapers, not by the running app, and has a separate lifecycle.
TARGETS = [
    ("_src/index.html", r'(?<=href="/styles\.min\.css\?v=)([\w]+)(?=")'),
    ("_src/index.html", r'(?<=src="/app\.js\?v=)([\w]+)(?=")'),
    ("_src/index.html", r'(?<=src="/app-widgets\.js\?v=)([\w]+)(?=")'),
    ("_src/index.html", r'(?<=src="/app-backtest\.js\?v=)([\w]+)(?=")'),
    ("_src/index.html", r'(?<=src="/app-boot\.js\?v=)([\w]+)(?=")'),
    ("about.html", r'(?<=href="/styles\.min\.css\?v=)([\w]+)(?=")'),
    ("impressum.html", r'(?<=href="/styles\.min\.css\?v=)([\w]+)(?=")'),
    ("privacy.html", r'(?<=href="/styles\.min\.css\?v=)([\w]+)(?=")'),
    ("terms.html", r'(?<=href="/styles\.min\.css\?v=)([\w]+)(?=")'),
    ("widerruf.html", r'(?<=href="/styles\.min\.css\?v=)([\w]+)(?=")'),
    # app-boot.js fetches the locale bundles at runtime.
    ("app-boot.js", r"(?<=\.json\?v=)([\w]+)(?=')"),
]

VER_RE = re.compile(r"\?v=[\w]+")


def build_id():
    """Short content hash over the whole asset set, stamps excluded."""
    h = hashlib.sha256()
    for rel in sorted(ASSETS):
        path = ROOT / rel
        if not path.exists():
            raise SystemExit(f"asset missing, cannot version: {rel}")
        body = path.read_text(encoding="utf-8")
        h.update(rel.encode("utf-8"))
        h.update(VER_RE.sub("?v=", body).encode("utf-8"))
    return h.hexdigest()[:10]


def run(check_only=False):
    want = build_id()
    stale = []
    edits = {}

    for rel, pattern in TARGETS:
        path = ROOT / rel
        if not path.exists():
            raise SystemExit(f"stamp target missing: {rel}")
        body = edits.get(rel, path.read_text(encoding="utf-8"))
        found = re.findall(pattern, body)
        if not found:
            raise SystemExit(f"stamp pattern never matched in {rel}: {pattern}")
        for old in found:
            if old != want:
                stale.append(f"{rel}: {old} -> {want}")
        edits[rel] = re.sub(pattern, want, body)

    # Published build id for the runtime freshness check in app-boot.js.
    vtxt = ROOT / "version.txt"
    have = vtxt.read_text(encoding="utf-8").strip() if vtxt.exists() else ""
    if have != want:
        stale.append(f"version.txt: {have or '(missing)'} -> {want}")

    if check_only:
        if stale:
            print(f"version stamps STALE (expected {want}):")
            for s in stale:
                print("  " + s)
            return 1
        print(f"version stamps OK - whole app pinned to v={want}")
        return 0

    if not stale:
        print(f"version stamps already current - v={want}")
        return 0

    for rel, body in edits.items():
        (ROOT / rel).write_text(body, encoding="utf-8")
    vtxt.write_text(want + "\n", encoding="utf-8")
    print(f"stamped v={want}")
    for s in stale:
        print("  " + s)
    print("now re-run: python tools/build_pages.py")
    return 0


if __name__ == "__main__":
    sys.exit(run(check_only="--check" in sys.argv))
