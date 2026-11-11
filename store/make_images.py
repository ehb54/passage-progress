#!/usr/bin/env python3
"""Render the Chrome Web Store images with headless Chrome.

    python3 store/make_images.py

Writes store/screenshot-1.png, store/screenshot-2.png (1280x800) and
store/promo-small.png (440x280). Serves the repo on 127.0.0.1:8767 while running.
"""
import http.server
import os
import subprocess
import tempfile
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PORT = 8767

SHOTS = [
    ("store/frame.html?shot=1", "screenshot-1.png", (1280, 800)),
    ("store/frame.html?shot=2", "screenshot-2.png", (1280, 800)),
    ("store/promo.html", "promo-small.png", (440, 280)),
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        # /__delay?ms=N: answer after N ms (lets a page postpone its load event)
        if self.path.startswith("/__delay"):
            ms = int(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("ms", ["1000"])[0])
            time.sleep(ms / 1000)
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *a):
        pass


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        for page, out, (w, h) in SHOTS:
            with tempfile.TemporaryDirectory() as prof:
                # --timeout (real time) rather than a virtual time budget, so
                # requestAnimationFrame runs and the meter is drawn.
                subprocess.run(
                    [CHROME, "--headless=new", f"--user-data-dir={prof}", "--no-first-run",
                     "--hide-scrollbars", "--force-device-scale-factor=1",
                     f"--window-size={w},{h}", "--timeout=8000",
                     f"--screenshot={os.path.join(HERE, out)}", f"http://127.0.0.1:{PORT}/{page}"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
                )
            print("wrote", f"store/{out}")
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
