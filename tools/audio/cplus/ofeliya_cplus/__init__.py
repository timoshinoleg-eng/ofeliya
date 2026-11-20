"""OFELIYA Audio v4 — C+ Mobile / Adaptive procedural generation package.

Everything in this package is written from scratch: oscillators, filters,
envelopes, reverbs and dynamics are computed with numpy/scipy. No sample
library, no donor track, no model file is involved, which keeps the provenance
of every shipped byte unambiguous.
"""

__all__ = ["compositions", "dsp", "master", "metrics", "theory"]
__version__ = "4.0.0"
