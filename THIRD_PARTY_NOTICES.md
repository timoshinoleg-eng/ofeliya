# OFELIYA: STRAIN ZERO — Third-Party Asset Notices

This file records provenance that is verifiable from the repository and upstream license pages.
It is intentionally conservative: no per-file upstream identity is invented when the historical
import did not record it.

## Kenney sound effects

Files: `public/audio/sfx/*.ogg` (11 files).

- Source family: Kenney audio assets.
- License recorded at import: Creative Commons Zero (CC0 / public domain dedication).
- Repository provenance: imported in commit `e43d5dc9e473dfb40ca8f819bcb82829315d093c`
  (`audio: Kenney CC0 SFX + music, lazy WebAudio load with procedural fallback`).
- Kenney currently states that assets on its asset pages are CC0 and attribution is not required.
- General upstream license/support reference: `https://kenney.nl/support`.

The historical import commit did not record the exact Kenney pack/file URLs. The repository commit,
file blobs and recorded CC0 source family are therefore the local provenance evidence; exact pack
URLs should be added if the original download notes are recovered.

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
- A currently verifiable OpenGameArt collection with the recorded title exists at
  `https://opengameart.org/content/cc0-music-0`; the historical commit does **not** prove that this
  exact collection URL was the download page used for every local track.

The historical import did **not** preserve a per-file mapping from `loop0..loop6` to individual
OpenGameArt item URLs/authors. Do not invent individual track authors or titles. If the original
download/source notes are available, recover and append the exact seven mappings before marketplace
moderation; otherwise preserve the repository import commit and binary hashes as the evidence trail.

## Chakra Petch font

Files:

- `public/fonts/chakra-petch-1.woff2`
- `public/fonts/chakra-petch-2.woff2`

- Font: Chakra Petch.
- License recorded by the project: SIL Open Font License (OFL) 1.1.
- Git blob IDs in this repository: `f7a66022dde0ab1d862d202807f5988453a9bdf4` and
  `de88f23d8b503ad1be8b07813c822145cde69308`.

Before redistribution outside this application repository, preserve the OFL license/notice required
by the upstream font package. The application does not modify or rename the font.

## Adaptive audio foundation — reference-only, no imported code or assets

`src/systems/adaptiveAudioMath.ts` and `src/systems/AdaptiveAudioDirector.ts` implement OFELIYA's own
adaptive audio foundation. Two permissive donors were read as **design references only**:

- `Giftedx/wild-haggis-survivors` (MIT) — `src/systems/music/Conductor.ts` and
  `src/systems/music/musicMath.ts`: the pattern of asymmetric attack/release smoothing and of gated
  moods with separate enter/exit bounds. The donor's Phaser-4 scene architecture and procedural
  music engine were **not** ported.
- `AlexanderHeffernan/TheLastLight` (MIT for source/docs) — `src/systems/AudioSystem.ts` and
  `src/systems/MonsterAudioSystem.ts`: the pattern of a music director that observes wave/boss
  events and of proximity-driven cues.

No donor source file was copied into this repository, so no donor copyright notice is reproduced
here. If any donor code is ever imported verbatim, its MIT notice must be added to this file in the
same change.

**No new audio binaries were added.** OFELIYA's existing CC0 SFX and OpenGameArt beds are reused
unchanged, and TheLastLight's music (`Suno`-generated, explicitly excluded from its MIT grant) is
**not** used anywhere in this project.

## Factory Overload line-hazard adaptation — MIT

Files:

- `src/game/CardiacLineHazard.ts`
- Cardiac hazard integration in `src/scenes/GameScene.ts`

The warning → beam lifecycle and line-hit geometry were adapted from
`ianis66666/factory-overload`, specifically `src/systems/BossHazardSystem.ts`.
OFELIYA rewrites the mechanic around its own stage lifecycle, mobile readability rules and a
separate run-seeded deterministic RNG; no upstream art, audio, names or other assets are imported.

Upstream: `https://github.com/ianis66666/factory-overload`
License: MIT.
Copyright (c) 2026 元耀 張

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Generated game art

Virus, immune cells, host cells, bloodstream background, mutation icons and gameplay VFX are generated
by project code at runtime/build time and do not depend on copied external raster/sprite artwork.

## Release rule

Any new third-party binary asset must add, in the same change:

1. exact upstream URL or package identity;
2. license identifier;
3. author/attribution text when required;
4. local file mapping.

This prevents repeating the incomplete per-file provenance of the early audio import.
