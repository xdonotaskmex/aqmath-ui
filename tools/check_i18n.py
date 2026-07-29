"""Consistency check: locale key parity + every data-i18n key in index.html exists in both locales."""
import io
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = prefix + "." + k if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out


def main():
    en = flatten(json.load(io.open(os.path.join(BASE, "locales", "en.json"), encoding="utf-8")))
    zh = flatten(json.load(io.open(os.path.join(BASE, "locales", "zh-CN.json"), encoding="utf-8")))

    only_en = sorted(set(en) - set(zh))
    only_zh = sorted(set(zh) - set(en))
    if only_en:
        print("Keys only in en.json (%d):" % len(only_en))
        for k in only_en:
            print("  ", k)
    if only_zh:
        print("Keys only in zh-CN.json (%d):" % len(only_zh))
        for k in only_zh:
            print("  ", k)

    html = io.open(os.path.join(BASE, "index.html"), encoding="utf-8").read()
    used = set(re.findall(r'data-i18n(?:-html|-placeholder)?="([^"]+)"', html))
    missing_en = sorted(k for k in used if k not in en)
    missing_zh = sorted(k for k in used if k not in zh)
    if missing_en:
        print("data-i18n keys missing from en.json (%d):" % len(missing_en))
        for k in missing_en:
            print("  ", k)
    if missing_zh:
        print("data-i18n keys missing from zh-CN.json (%d):" % len(missing_zh))
        for k in missing_zh:
            print("  ", k)

    if not (only_en or only_zh or missing_en or missing_zh):
        print("i18n OK: %d keys in parity, %d keys used in index.html all resolve" % (len(en), len(used)))


if __name__ == "__main__":
    main()
