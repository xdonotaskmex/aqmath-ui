"""Audit every published page for the SEO and compliance regressions we have
actually shipped before.

Why this exists
---------------
Each check below corresponds to a real defect found on the live site, not to a
generic best-practice checklist:

  * duplicate bodies    - all five entry pages once shipped byte-identical
                          311 KB bodies, so Google indexed one and dropped the
                          rest. build_pages.py guards the five generated pages;
                          this guards *every* page, hand-written ones included.
  * missing <h1>        - a page with no heading, or with five of them, tells a
                          crawler nothing about which route it is looking at.
  * duplicate title/description - same failure mode as duplicate bodies, one
                          level up.
  * wrong canonical     - a canonical pointing at another route asks the crawler
                          to drop this page. Derived from the file path here, so
                          a copy-pasted <head> cannot silently keep the source
                          page's URL.
  * external font/CDN origins - LG Muenchen I, 20.01.2022, Az. 3 O 17493/20:
                          embedding Google Fonts leaks the visitor IP to a third
                          country without consent. The fonts were self-hosted;
                          this makes a re-introduction fail the build.
  * mixed asset stamps  - a visitor with a half-warm cache would otherwise run
                          new HTML against stale JS.
  * broken internal links - every one is a crawl dead end and a lost visitor.
  * sitemap drift       - a sitemap listing a 404, or omitting an indexable
                          page, is worse than no sitemap.
  * missing simulated-results notice - /results, /backtest and the research
                          write-ups present performance figures. A performance
                          claim has to carry its qualifier where the claim is
                          read, not in a footer three screens down.
  * stale Forward Log snapshot - the baked fallback in _src/index.html was
                          produced from a local telemetry file that had stopped
                          advancing, and drifted six days behind the live
                          service without anything complaining. Checked offline
                          against the snapshot's own date, so it fails even when
                          the service is unreachable; refresh with
                          tools/refresh_forward_log.py.

Usage:  python tools/audit_pages.py
        exits 1 if anything fails, so it can gate a deploy.
"""
import hashlib
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://aqmath.xyz"

# Not part of the published surface.
SKIP_DIRS = {"_src", "_research", "node_modules", "tools", ".git", ".qoder"}

# 404.html is served by the host on an error, has no canonical route of its own
# and must never be indexed or listed.
NO_ROUTE = {"404.html"}

# Pages that present performance figures and therefore must carry the
# "simulated results" notice in the content.
NEEDS_SIM_NOTICE = {
    "results.html",
    "backtest.html",
    "research/oos-v14-new-tokens.html",
    "research/oos-v14-new-tokens-zh.html",
}

FORBIDDEN_ORIGINS = [
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "ajax.googleapis.com",
]

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
LINK_RE = re.compile(r'<a\b[^>]*?href="([^"]+)"', re.I)
STAMP_RE = re.compile(r"\?v=([\w]+)")

# The Forward Log fallback carries its own generation date. The live section is
# refreshed daily by the service, so the committed copy is allowed to trail a
# little, but not indefinitely - past this it is presented as current data while
# being visibly wrong.
FORWARD_DATE_RE = re.compile(r"Telemetry generated (\d{4}-\d{2}-\d{2})")
FORWARD_MAX_AGE_DAYS = 10


def rel(path):
    return path.relative_to(ROOT).as_posix()


def pages():
    """Every HTML file the host will actually serve."""
    out = []
    for path in sorted(ROOT.rglob("*.html")):
        parts = set(path.relative_to(ROOT).parts)
        if parts & SKIP_DIRS:
            continue
        out.append(path)
    return out


def route_of(name):
    """The URL path the host serves a given file at.

    GitHub Pages resolves /foo to foo.html and /foo/ to foo/index.html, so the
    mapping is derivable and does not need a hand-maintained table that can
    drift away from the files on disk.
    """
    if name == "index.html":
        return "/"
    if name.endswith("/index.html"):
        # Pages serves a subdirectory index only at the trailing-slash URL;
        # "/research" answers 301, so the canonical route keeps the slash.
        return "/" + name[: -len("index.html")]
    return "/" + name[: -len(".html")]


def resolve(href, existing):
    """Does an internal href land on a file we ship? Returns True/False."""
    target = href.split("#")[0].split("?")[0]
    if not target or target == "/":
        return "index.html" in existing
    target = target.lstrip("/")
    for candidate in (target, target + ".html", target.rstrip("/") + "/index.html"):
        if candidate in existing:
            return True
    # Non-HTML assets (svg, png, woff2, json, css, js, txt, xml).
    return (ROOT / target).exists()


def one(pattern, html, flags=0):
    found = re.findall(pattern, html, flags)
    return found[0] if len(found) == 1 else None


def current_stamp():
    body = (ROOT / "terms.html").read_text(encoding="utf-8")
    m = re.search(r'href="/styles\.min\.css\?v=([\w]+)"', body)
    if not m:
        raise SystemExit("cannot read the current asset stamp from terms.html")
    return m.group(1)


def sitemap_locs():
    body = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    return re.findall(r"<loc>([^<]+)</loc>", body)


def audit():
    files = pages()
    if not files:
        raise SystemExit("no pages found - is the working directory right?")

    names = [rel(p) for p in files]
    existing = set(names)
    stamp = current_stamp()
    fails = []
    rows = []
    titles, descs, bodies = {}, {}, {}

    for path in files:
        name = rel(path)
        raw = path.read_text(encoding="utf-8")
        html = COMMENT_RE.sub("", raw)
        route = None if name in NO_ROUTE else route_of(name)

        def fail(msg):
            fails.append(f"{name}: {msg}")

        # --- headings -------------------------------------------------------
        h1s = re.findall(r"<h1\b", html)
        if name not in NO_ROUTE and len(h1s) != 1:
            fail(f"expected exactly 1 <h1>, found {len(h1s)}")

        # --- title / description / robots / canonical -----------------------
        title = one(r"<title>(.*?)</title>", html, re.S)
        desc = one(r'<meta name="description" content="([^"]*)"', html)
        robots = one(r'<meta name="robots" content="([^"]*)"', html)
        canonical = one(r'<link rel="canonical" href="([^"]*)"', html)
        og_url = one(r'<meta property="og:url" content="([^"]*)"', html)

        if name in NO_ROUTE:
            if robots is None or "noindex" not in robots:
                fail("must be noindex")
        else:
            if not title:
                fail("missing or duplicated <title>")
            elif title in titles:
                fail(f"<title> is identical to {titles[title]}")
            else:
                titles[title] = name

            if not desc:
                fail("missing or duplicated meta description")
            elif desc in descs:
                fail(f"meta description is identical to {descs[desc]}")
            else:
                descs[desc] = name

            want = SITE + route
            if canonical != want:
                fail(f"canonical is {canonical!r}, expected {want!r}")
            if og_url is not None and og_url != want:
                fail(f"og:url is {og_url!r}, expected {want!r}")

        if not re.search(r"<html[^>]*\blang=", html):
            fail("no lang attribute on <html>")

        # --- duplicate bodies ----------------------------------------------
        m = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
        if not m:
            fail("no <body>")
        else:
            digest = hashlib.md5(m.group(1).encode("utf-8")).hexdigest()[:10]
            if digest in bodies:
                fail(f"body is byte-identical to {bodies[digest]}")
            else:
                bodies[digest] = name

        # --- third-party origins -------------------------------------------
        for origin in FORBIDDEN_ORIGINS:
            if origin in raw:
                fail(f"references {origin} - fonts and scripts must be first-party")

        # --- asset stamps ---------------------------------------------------
        # social-preview.png is versioned by hand on purpose: it is consumed by
        # social-media scrapers, not by the running app.
        scanned = re.sub(r"social-preview[\w.-]*\.png\?v=[\w]+", "", raw)
        bad = sorted({s for s in STAMP_RE.findall(scanned) if s != stamp})
        if bad:
            fail(f"stale asset stamp(s) {bad}, current is {stamp}")

        # --- simulated-results notice --------------------------------------
        if name in NEEDS_SIM_NOTICE and "sim-notice" not in html:
            fail("presents performance figures but carries no sim-notice")
        if name not in NEEDS_SIM_NOTICE and 'class="sim-notice"' in html:
            fail("carries a sim-notice but shows no performance figures")

        # --- internal links -------------------------------------------------
        broken = sorted({
            h for h in LINK_RE.findall(html)
            if h.startswith("/") and not resolve(h, existing)
        })
        if broken:
            fail(f"broken internal link(s): {broken}")

        rows.append((name, route or "-", robots or "-", len(h1s)))

    # --- sitemap ------------------------------------------------------------
    locs = sitemap_locs()
    if len(locs) != len(set(locs)):
        fails.append("sitemap.xml: duplicate <loc> entries")

    listed = set()
    for loc in locs:
        if not loc.startswith(SITE):
            fails.append(f"sitemap.xml: foreign host in {loc}")
            continue
        route = loc[len(SITE):] or "/"
        listed.add(route)
        if not resolve(route, existing):
            fails.append(f"sitemap.xml lists {route}, which we do not ship")

    for name in names:
        if name in NO_ROUTE:
            continue
        html = COMMENT_RE.sub("", (ROOT / name).read_text(encoding="utf-8"))
        robots = one(r'<meta name="robots" content="([^"]*)"', html) or ""
        route = route_of(name)
        if "noindex" in robots:
            if route in listed:
                fails.append(f"sitemap.xml lists {route}, but the page is noindex")
        elif route not in listed:
            fails.append(f"{name} is indexable but missing from sitemap.xml")

    # --- Forward Log fallback freshness -------------------------------------
    forward = "n/a"
    results = ROOT / "results.html"
    if results.exists():
        m = FORWARD_DATE_RE.search(results.read_text(encoding="utf-8"))
        if not m:
            fails.append("results.html carries no dated Forward Log snapshot")
        else:
            forward = m.group(1)
            age = (date.today() - datetime.strptime(forward, "%Y-%m-%d").date()).days
            if age > FORWARD_MAX_AGE_DAYS:
                fails.append(
                    f"Forward Log snapshot is {age} days old ({forward}); "
                    "run python tools/refresh_forward_log.py"
                )

    # --- report -------------------------------------------------------------
    print(f"audited {len(rows)} published pages, asset stamp v={stamp}\n")
    print(f"  {'file':38s} {'route':34s} {'robots':16s} h1")
    for name, route, robots, h1 in rows:
        print(f"  {name:38s} {route:34s} {robots:16s} {h1}")
    print(f"\n  sitemap.xml: {len(locs)} url(s)")
    print(f"  Forward Log fallback: {forward}")

    if fails:
        print(f"\nFAILED - {len(fails)} problem(s):")
        for f in fails:
            print("  " + f)
        return 1
    print("\nOK - unique bodies, one h1 each, canonicals match, no third-party "
          "font origins, one asset stamp, no broken internal links, "
          "sitemap in sync, Forward Log fallback fresh.")
    return 0


if __name__ == "__main__":
    sys.exit(audit())
