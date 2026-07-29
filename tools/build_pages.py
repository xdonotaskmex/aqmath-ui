"""Generate per-route HTML entry pages from index.html.

GitHub Pages serves docs.html at /docs (extensionless), so the clean
URLs return HTTP 200 for crawlers instead of the 404.html fallback.
Each copy gets its own title / description / canonical / og tags.

Usage:  python tools/build_pages.py
Re-run after every edit to index.html.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"

PAGES = {
    "docs.html": {
        "path": "/docs",
        "title": "System Documentation — AQMath",
        "description": "Full technical documentation of AQMath: Risk Parity engine, Deleverage Shield, DCA safety pipeline and the non-custodial privacy architecture.",
    },
    "backtest.html": {
        "path": "/backtest",
        "title": "Backtest — AQMath Deleverage Shield",
        "description": "Interactive 8.7-year walk-forward backtest of the AQMath Deleverage Shield — compare drawdowns and returns against plain Buy & Hold.",
    },
    "results.html": {
        "path": "/results",
        "title": "New-Token Stress Test — AQMath",
        "description": "Out-of-sample stress test of the AQMath Shield on 182 fresh coin baskets — including tokens never used to build or tune the model.",
    },
    "app.html": {
        "path": "/app",
        "title": "App — AQMath Portfolio Rebalancer",
        "description": "The AQMath app: track your portfolio, distribute DCA and optimize with Risk Parity math — non-custodial, private, no account needed.",
    },
}


def patch(html, pattern, replacement):
    out, n = re.subn(pattern, replacement, html, count=1)
    if n != 1:
        raise SystemExit(f"pattern not found in index.html: {pattern}")
    return out


def build():
    src = SRC.read_text(encoding="utf-8")
    for name, meta in PAGES.items():
        url = "https://aqmath.xyz" + meta["path"]
        html = src
        html = patch(html, r"<title>.*?</title>", f"<title>{meta['title']}</title>")
        html = patch(html, r'(<meta name="description" content=")[^"]*(">)',
                     rf"\g<1>{meta['description']}\g<2>")
        html = patch(html, r'(<link rel="canonical" href=")[^"]*(">)', rf"\g<1>{url}\g<2>")
        html = patch(html, r'(<meta property="og:url" content=")[^"]*(">)', rf"\g<1>{url}\g<2>")
        html = patch(html, r'(<meta property="og:title" content=")[^"]*(">)',
                     rf"\g<1>{meta['title']}\g<2>")
        html = ("<!-- GENERATED from index.html by tools/build_pages.py - do not edit -->\n"
                + html)
        (ROOT / name).write_text(html, encoding="utf-8")
        print(f"built {name} ({meta['path']})")


if __name__ == "__main__":
    build()
