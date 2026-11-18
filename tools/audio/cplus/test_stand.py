#!/usr/bin/env python3
"""Reproducibility test for the comparison stand.

    python tools/audio/cplus/test_stand.py --package <pkg> --audition <v3pkg> --repo <repo>

The stand has to work from a clean checkout, not from an untracked local
artefact. This test therefore:

  1. builds the stand into an **empty** directory and asserts that the HTML
     entry point, the data manifest and the assets are all produced;
  2. starts `serve_stand.py` against that directory and asserts the page and
     the manifest are actually served over HTTP — the stand decodes audio with
     WebAudio, which needs a real origin, so a `file://` open would not work.
"""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

_HERE = Path(__file__).resolve().parent

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if condition:
        print(f"PASS {message}")
    else:
        failures.append(message)
        print(f"FAIL {message}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True)
    ap.add_argument("--audition", required=True)
    ap.add_argument("--repo", required=True)
    args = ap.parse_args()

    package = Path(args.package).resolve()
    audition = Path(args.audition).resolve()
    repo = Path(args.repo).resolve()

    import tempfile

    with tempfile.TemporaryDirectory() as td:
        clean = Path(td) / "clean-package"
        clean.mkdir()
        result = subprocess.run(
            [sys.executable, str(_HERE / "build_stand.py"),
             "--package", str(clean), "--audition", str(audition), "--repo", str(repo)],
            capture_output=True, text=True,
        )
        check(result.returncode == 0, f"the stand builds into an empty directory (exit {result.returncode})")
        if result.returncode != 0:
            print(result.stdout + result.stderr)
            return

        index = clean / "stand" / "index.html"
        check(index.exists(), "the clean build produced stand/index.html")
        check(index.stat().st_size > 1000 if index.exists() else False,
              "the produced stand/index.html is not empty")
        manifest = clean / "stand" / "data" / "manifest.json"
        check(manifest.exists(), "the clean build produced stand/data/manifest.json")
        if manifest.exists():
            data = json.loads(manifest.read_text(encoding="utf-8"))
            check(len(data.get("groups", [])) >= 4, "the stand manifest lists the comparison groups")
            check(len(data.get("metrics", [])) >= 6, "the stand manifest lists the measured tracks")
        assets = clean / "stand" / "assets"
        check(assets.is_dir() and any(assets.rglob("*.ogg")), "the clean build produced the audio assets")

        # the server has to serve the stand over a real origin
        port = free_port()
        server = subprocess.Popen(
            [sys.executable, str(_HERE / "serve_stand.py"), "--package", str(clean), "--port", str(port)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        try:
            base = f"http://127.0.0.1:{port}"
            page = None
            for _ in range(40):
                try:
                    with urllib.request.urlopen(base + "/", timeout=2) as resp:
                        page = resp.read().decode("utf-8", "replace")
                    break
                except (urllib.error.URLError, ConnectionError, OSError):
                    time.sleep(0.25)
            check(page is not None, "the stand server answers over HTTP")
            check(page is not None and "OFELIYA Audio v4" in page,
                  "the served page is the comparison stand")
            try:
                with urllib.request.urlopen(base + "/data/manifest.json", timeout=5) as resp:
                    body = resp.read().decode("utf-8", "replace")
                check(body.startswith("{"), "the stand manifest is served over HTTP")
            except (urllib.error.URLError, OSError) as exc:
                check(False, f"the stand manifest is served over HTTP ({exc})")
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()

    print()
    if failures:
        print(f"{len(failures)} of {checks} stand check(s) FAILED")
        for message in failures:
            print(f"  - {message}")
        sys.exit(1)
    print(f"stand reproducibility: {checks}/{checks} checks passed")


if __name__ == "__main__":
    main()
