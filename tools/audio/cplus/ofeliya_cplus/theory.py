"""Musical helpers for the OFELIYA C+ v4 compositions.

The whole package is built around one tonal centre: **F minor**. Every bed
shares the same pitch collection so the act-I and act-II beds, the boss beds
and the stingers can be cross-faded without a harmonic clash.

Every chord is voiced between 87 Hz (F2) and 220 Hz (A3): that is the band a
built-in phone speaker can reproduce, and it is the band the mastering chain
weights with the +1.5 dB peaking filter at 155 Hz. No chord tone is placed
below 87 Hz, because the 78 Hz mastering high-pass would remove it anyway.
"""

from __future__ import annotations

A4 = 440.0
"""Concert pitch reference."""

_NOTES = {
    "C": -9, "C#": -8, "Db": -8, "D": -7, "D#": -6, "Eb": -6,
    "E": -5, "F": -4, "F#": -3, "Gb": -3, "G": -2, "G#": -1, "Ab": -1,
    "A": 0, "A#": 1, "Bb": 1, "B": 2,
}


def freq(name: str) -> float:
    """Frequency of a note name such as ``F2`` or ``Bb3``."""
    key = name[:-1]
    octave = int(name[-1])
    if key not in _NOTES:
        raise KeyError(f"unknown note: {name}")
    semis = _NOTES[key] + (octave - 4) * 12
    return A4 * (2.0 ** (semis / 12.0))


def midi(name: str) -> int:
    """MIDI note number of a note name such as ``F2``."""
    key = name[:-1]
    octave = int(name[-1])
    return _NOTES[key] + (octave + 1) * 12


# --------------------------------------------------------------------------
# F minor material
# --------------------------------------------------------------------------
FM_ROOT = "F2"
FM_ROOT_HZ = freq(FM_ROOT)  # 87.31 Hz

#: Pitch classes of F natural minor, expressed as note names.
FM_SCALE = ["F", "G", "Ab", "Bb", "C", "Db", "Eb"]

#: Chord table used across the package: (bass root, chord tones).
CHORDS: dict[str, tuple[str, list[str]]] = {
    "fm": ("F2", ["F2", "Ab2", "C3"]),
    "fmaj": ("F2", ["F2", "A2", "C3"]),
    "dm": ("D3", ["D3", "F3", "A3"]),
    "bb": ("Bb2", ["Bb2", "D3", "F3"]),
    "cmaj": ("C3", ["C3", "E3", "G3"]),
    "gm": ("G2", ["G2", "Bb2", "D3"]),
    "am": ("A2", ["A2", "C3", "E3"]),
    # Eb major (VI in F minor) and Ab major (bVI) give the darker colour
    "ebm": ("Eb3", ["Eb3", "G3", "Bb2"]),
    "abm": ("Ab2", ["Ab2", "C3", "Eb3"]),
    # Db major is the Neapolitan (bII): the boss chord of Immune Prime
    "dbm": ("Db3", ["Db3", "F3", "Ab3"]),
}


def chord_hz(name: str) -> list[float]:
    return [freq(n) for n in CHORDS[name][1]]


def chord_bass_hz(name: str) -> float:
    return freq(CHORDS[name][0])


def degree_hz(scale_degree: int, octave: int = 2) -> float:
    """Frequency of a 0-based degree of F natural minor."""
    name = FM_SCALE[scale_degree % len(FM_SCALE)]
    oct_shift = scale_degree // len(FM_SCALE)
    return freq(f"{name}{octave + oct_shift}")
