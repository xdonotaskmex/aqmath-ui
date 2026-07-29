"""Local preview server that mimics GitHub Pages behaviour.

Serves files from the repo root; any unknown path is answered with
404.html (like GitHub Pages does), which exercises the SPA redirect.

Usage:  python tools/preview_server.py [port]
"""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class GhPagesHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_head(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path):
            # GitHub Pages extensionless resolution: /docs -> docs.html
            if os.path.exists(path + ".html"):
                self.path = self.path.rstrip("/") + ".html"
                return super().send_head()
            # GitHub Pages serves 404.html with status 404
            self.path = "/404.html"
            return super().send_head()
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), GhPagesHandler) as srv:
        print(f"Preview on http://127.0.0.1:{PORT}/ (root: {ROOT})")
        srv.serve_forever()
