"""Minify styles.css -> styles.min.css (string-safe, no rule purging).

Usage:  python tools/minify_css.py
Re-run after every edit to styles.css.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "styles.css"
DST = ROOT / "styles.min.css"


def tokenize(css):
    """Yield (is_string, chunk) pairs so string literals stay untouched."""
    i, n = 0, len(css)
    buf = []
    while i < n:
        c = css[i]
        if c in "\"'":
            yield False, "".join(buf)
            buf = []
            j = i + 1
            while j < n:
                if css[j] == "\\":
                    j += 2
                    continue
                if css[j] == c:
                    break
                j += 1
            yield True, css[i : j + 1]
            i = j + 1
        elif css.startswith("/*", i):
            yield False, "".join(buf)
            buf = []
            end = css.find("*/", i + 2)
            i = n if end == -1 else end + 2  # drop comment
        else:
            buf.append(c)
            i += 1
    yield False, "".join(buf)


def minify(css):
    out = []
    for is_str, chunk in tokenize(css):
        if is_str:
            out.append(chunk)
            continue
        chunk = re.sub(r"\s+", " ", chunk)
        chunk = re.sub(r"\s*([{};:,>])\s*", r"\1", chunk)
        out.append(chunk)
    result = "".join(out)
    result = result.replace(";}", "}")
    return result.strip()


if __name__ == "__main__":
    minified = minify(SRC.read_text(encoding="utf-8"))
    header = "/* generated from styles.css - run tools/minify_css.py after editing */"
    DST.write_text(header + "\n" + minified + "\n", encoding="utf-8")
    src_kb = SRC.stat().st_size / 1024
    dst_kb = DST.stat().st_size / 1024
    print(f"styles.css {src_kb:.1f} KB -> styles.min.css {dst_kb:.1f} KB")
