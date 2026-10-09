"""OFELIYA audio mastering pipeline.

Normalizes the licensed music beds to a uniform loudness target and verifies the
SFX set, then writes `public/audio/audio-manifest.json` with measured loudness,
true-peak and sha256 for every shipped audio asset.

Target contract (see docs/AUDIO_MASTERING.md):
  music: -14 LUFS integrated, true peak <= -1 dBTP, stereo, original container format
  sfx:   source files kept as licensed; only measured and manifested

Run from the repo root:
  python tools/audio/master_audio.py            # analyze + write manifest
  python tools/audio/master_audio.py --apply    # also rewrite normalized music files

Requires: soundfile>=1.2 (mp3/ogg write), pyloudnorm, numpy.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

try:
    import pyloudnorm as pyln
except ImportError:  # pragma: no cover
    sys.exit("pyloudnorm is required: pip install pyloudnorm")

from scipy.signal import resample_poly


def true_peak_db(data: np.ndarray, sr: int) -> float:
    """BS.1770-style true peak: peak after 4x polyphase oversampling."""
    oversampled = resample_poly(data, 4, 1, axis=0)
    peak = float(np.abs(oversampled).max()) if oversampled.size else 0.0
    return 20.0 * np.log10(max(peak, 1e-9))

ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT / "public" / "audio"

MUSIC_TARGET_LUFS = -14.0
MUSIC_MAX_TRUE_PEAK_DBTP = -1.0
SAMPLE_RATE = 44100

# Keep the original container per file: ogg beds stay ogg (gapless loop-safe),
# mp3 beds stay mp3 (Safari / iOS WebView decodeAudioData has no ogg-vorbis).
MUSIC_FILES = [
    "music/loop0.ogg",
    "music/loop1.ogg",
    "music/loop2.ogg",
    "music/loop3.mp3",
    "music/loop4.mp3",
    "music/loop5.mp3",
    "music/loop6.mp3",
]

SFX_FILES = [
    "sfx/shoot.ogg", "sfx/hit.ogg", "sfx/pickup.ogg", "sfx/pickup2.mp3", "sfx/pickup3.mp3",
    "sfx/levelup.ogg", "sfx/hurt.ogg", "sfx/click.ogg", "sfx/nova.ogg", "sfx/elite.ogg",
    "sfx/boss.ogg", "sfx/bossphase.mp3", "sfx/gameover.ogg", "sfx/victory.ogg",
    "sfx/infect.mp3", "sfx/lysis.mp3",
]

VORBIS_QUALITY = 0.5  # ~160 kbps stereo, transparent enough for a music bed


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def measure(path: Path):
    data, sr = sf.read(str(path), always_2d=True)
    meter = pyln.Meter(sr)
    try:
        lufs = meter.integrated_loudness(data)
    except ValueError:
        lufs = None  # shorter than the BS.1770 block: SFX rely on peak/RMS only
    tp_db = true_peak_db(data, sr)
    peak = float(np.abs(data).max()) if data.size else 0.0
    clipped = float(np.mean(np.abs(data) > 0.999)) if data.size else 0.0
    return {
        "durationSec": round(len(data) / sr, 3),
        "sampleRate": sr,
        "channels": data.shape[1],
        "lufs": (None if (lufs is None or lufs == -np.inf) else round(float(lufs), 2)),
        "truePeakDbTp": round(tp_db, 2),
        "peak": round(peak, 4),
        "clippedFraction": round(clipped, 5),
        "rms": round(float(np.sqrt((data ** 2).mean())), 4),
    }


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "imageio-ffmpeg is required for encoding: pip install imageio-ffmpeg"
        ) from exc


def encode_with_ffmpeg(wav: Path, out: Path, sr: int, limit: bool) -> None:
    """Lossy encode through the bundled ffmpeg.

    The Windows libsndfile build crashes writing long Vorbis streams (verified
    on files > ~60 s), so encoding goes through ffmpeg: libvorbis q5 for ogg
    beds, libmp3lame 128k for mp3 beds (Safari WebView has no ogg-vorbis).
    `limit` adds a lookahead true-peak limiter (−1 dBTP) for beds whose gain
    boost would otherwise exceed the ceiling — a limiter preserves the LUFS
    target far better than scaling the whole bed down.
    """
    filters = []
    if limit:
        # Sample-peak ceiling −1.6 dBFS: inter-sample overshoot after lossy
        # encoding still lands inside the −1 dBTP contract.
        filters.append("alimiter=limit=0.831764:attack=5:release=50:level=false")
    if out.suffix == ".ogg":
        args = ["-c:a", "libvorbis", "-q:a", "5"]
    else:
        args = ["-c:a", "libmp3lame", "-b:a", "128k"]
    cmd = [ffmpeg_exe(), "-y", "-v", "error", "-i", str(wav)]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += [*args, str(out)]
    subprocess.run(cmd, check=True)


def normalize_music(path: Path) -> None:
    data, sr = sf.read(str(path), always_2d=True)
    if sr != SAMPLE_RATE:
        raise SystemExit(f"{path}: unexpected sample rate {sr}")
    # Uniform channel layout: mono beds are duplicated to stereo.
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)

    meter = pyln.Meter(sr)
    loudness = meter.integrated_loudness(data)
    if loudness == -np.inf:
        raise SystemExit(f"{path}: silent bed, refusing to normalize")
    data = pyln.normalize.loudness(data, loudness, MUSIC_TARGET_LUFS)
    needs_limiter = true_peak_db(data, sr) > MUSIC_MAX_TRUE_PEAK_DBTP

    data = np.ascontiguousarray(data, dtype=np.float32)
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "mastered.wav"
        sf.write(str(wav), data, sr, format="WAV", subtype="FLOAT")
        tmp = path.with_suffix(path.suffix + ".tmp" + path.suffix)
        encode_with_ffmpeg(wav, tmp, sr, limit=needs_limiter)
        tmp.replace(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="rewrite music files in place")
    args = ap.parse_args()

    manifest = {"version": 1, "musicTargetLUFS": MUSIC_TARGET_LUFS,
                "musicMaxTruePeakDbTp": MUSIC_MAX_TRUE_PEAK_DBTP, "assets": {}}
    ok = True

    for rel in MUSIC_FILES:
        p = AUDIO / rel
        if not p.exists():
            print(f"MISSING {rel}")
            ok = False
            continue
        m = measure(p)
        in_contract = (
            m["lufs"] is not None
            and abs(m["lufs"] - MUSIC_TARGET_LUFS) <= 0.5
            and m["truePeakDbTp"] <= MUSIC_MAX_TRUE_PEAK_DBTP
            and m["channels"] == 2
        )
        if args.apply and not in_contract:
            normalize_music(p)
            m = measure(p)
        m["kind"] = "music"
        manifest["assets"][rel] = m
        status = []
        if m["lufs"] is None or abs(m["lufs"] - MUSIC_TARGET_LUFS) > 0.5:
            status.append(f"LUFS {m['lufs']} != {MUSIC_TARGET_LUFS}")
        if m["truePeakDbTp"] > MUSIC_MAX_TRUE_PEAK_DBTP:
            status.append(f"TP {m['truePeakDbTp']} > {MUSIC_MAX_TRUE_PEAK_DBTP}")
        if m["channels"] != 2:
            status.append("not stereo")
        tag = "OK " if not status else "BAD"
        if status:
            ok = False
        print(f"{tag} music/{Path(rel).name:12s} {m['durationSec']:7.1f}s "
              f"{m['lufs']:6.1f} LUFS  TP {m['truePeakDbTp']:5.1f}  "
              f"ch{m['channels']}  clipped {m['clippedFraction'] * 100:4.1f}%  {'; '.join(status)}")

    for rel in SFX_FILES:
        p = AUDIO / rel
        if not p.exists():
            print(f"MISSING {rel}")
            ok = False
            continue
        m = measure(p)
        m["kind"] = "sfx"
        manifest["assets"][rel] = m
        lufs_txt = "  n/a " if m["lufs"] is None else f"{m['lufs']:6.1f}"
        print(f"OK  sfx/{Path(rel).name:12s} {m['durationSec']:7.1f}s "
              f"{lufs_txt} LUFS  TP {m['truePeakDbTp']:5.1f}  ch{m['channels']}")

    for rel, m in manifest["assets"].items():
        m["sha256"] = sha256_of(AUDIO / rel)
        m["bytes"] = (AUDIO / rel).stat().st_size

    out = AUDIO / "audio-manifest.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {out.relative_to(ROOT)} ({len(manifest['assets'])} assets)")
    if not ok and not args.apply:
        sys.exit(1)
    if not ok:
        sys.exit("music still out of contract after --apply")


if __name__ == "__main__":
    main()
