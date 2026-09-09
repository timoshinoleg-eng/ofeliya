# OFELIYA: STRAIN ZERO — Third-Party Asset Notices

This file records the provenance that is verifiable from the repository and upstream license pages.
It is intentionally conservative: no upstream URL is invented when the original import did not
record the exact item URL.

## Kenney sound effects

Files: `public/audio/sfx/*.ogg` (11 files).

- Source family: Kenney audio assets.
- License: Creative Commons Zero (CC0 / public domain dedication).
- Repository provenance: imported in commit `e43d5dc9e473dfb40ca8f819bcb82829315d093c`
  (`audio: Kenney CC0 SFX + music, lazy WebAudio load with procedural fallback`).
- Kenney states that assets on its asset pages are CC0 and attribution is not required.
- Upstream license/support reference: `https://kenney.nl/support`.

The original import commit did not record the exact Kenney pack/file URLs. The repository commit,
file blobs and CC0 source family are retained as the reproducible local provenance record.

## OpenGameArt music

Files:

- `public/audio/music/loop0.ogg`
- `public/audio/music/loop1.ogg`
- `public/audio/music/loop2.ogg`
- `public/audio/music/loop3.mp3`
- `public/audio/music/loop4.mp3`
- `public/audio/music/loop5.mp3`
- `public/audio/music/loop6.mp3`

- Source family recorded at import: OpenGameArt **CC0 Music** collection.
- License recorded at import: CC0 1.0.
- Repository provenance: imported/replaced in commit
  `fd1185425c572c4ba27951ea00658574611d07ab`
  (`audio: replace 8-bit music loop with modern CC0 tracks (OpenGameArt)`).
- Collection reference: `https://opengameart.org/content/cc0-music-0`.

The historical import did **not** preserve a per-file mapping from `loop0..loop6` to individual
OpenGameArt item URLs/authors. Because CC0 does not require attribution, this does not alter the
runtime license grant recorded by the import; however, the per-file upstream mapping should be
recovered from the original download/source notes before final marketplace moderation if available.
Do not invent individual track authors or titles without that evidence.

## Chakra Petch font

Files:

- `public/fonts/chakra-petch-1.woff2`
- `public/fonts/chakra-petch-2.woff2`

- Font: Chakra Petch.
- License recorded by the project: SIL Open Font License (OFL) 1.1.
- Git blob IDs in this repository: `f7a66022dde0ab1d862d202807f5988453a9bdf4` and
  `de88f23d8b503ad1be8b07813c822145cde69308`.

Before redistribution outside this application repository, preserve the OFL license/notice required
by the upstream font package. The application itself does not modify or rename the font.

## Generated game art

Virus, immune cells, host cells, bloodstream background, mutation icons and gameplay VFX are generated
by project code at runtime/build time and do not depend on copied external raster/sprite artwork.

## Release rule

Any new third-party binary asset must add, in the same change:

1. exact upstream URL or package identity;
2. license identifier;
3. author/attribution text when required;
4. local file mapping.

This avoids repeating the incomplete per-file provenance of the early audio import.
