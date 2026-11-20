#!/usr/bin/env python3
"""Serve the comparison stand over HTTP.

    python tools/audio/cplus/serve_stand.py --package <pkg> [--port 8099]

The stand decodes the audio with WebAudio, which needs `fetch()` and
therefore a real origin — opening `stand/index.html` straight from the disk
(`file://`) blocks the audio fetch in Chrome. This helper serves the stand
folder on localhost and prints the URL.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--port", type=int, default=8099)
    args = ap.parse_args()

    root = (Path(args.package).resolve() / "stand").resolve()
    if not (root / "index.html").exists():
        raise SystemExit(f"stand not found: {root}")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"stand: http://127.0.0.1:{args.port}/  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstand server stopped")


if __name__ == "__main__":
    main()
