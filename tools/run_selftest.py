#!/usr/bin/env python3
"""Run test/selftest.html (or another self-reporting test page) in headless Chrome.

    python3 tools/run_selftest.py [test/selftest.html]

Serves this folder on 127.0.0.1:8766, opens the page in headless Chrome with a
throwaway profile, and prints what the page reports to /__selftest_result.
Real time (not --virtual-time-budget), because requestAnimationFrame must run.
"""
import http.server
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PORT = 8766
result = {}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/__selftest_result":
            result["text"] = urllib.parse.parse_qs(u.query).get("r", [""])[0]
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def main():
    page = sys.argv[1] if len(sys.argv) > 1 else "test/selftest.html"
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory() as prof:
        proc = subprocess.Popen(
            [CHROME, "--headless=new", f"--user-data-dir={prof}", "--no-first-run",
             "--window-size=1000,800", f"http://127.0.0.1:{PORT}/{page}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 60
        while "text" not in result and time.time() < deadline:
            time.sleep(0.25)
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    srv.shutdown()
    text = result.get("text", "NO RESULT (timed out)")
    print(text)
    sys.exit(0 if text and "FAIL" not in text and "ERROR" not in text and "NO RESULT" not in text else 1)


if __name__ == "__main__":
    main()
