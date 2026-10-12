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

## Generated sound effects

Files:

- `public/audio/sfx/pickup2.mp3`
- `public/audio/sfx/pickup3.mp3`
- `public/audio/sfx/infect.mp3`
- `public/audio/sfx/lysis.mp3`
- `public/audio/sfx/bossphase.mp3`

- Origin: project-directed original sound effects generated via AI sound-effect generation
  (agent-gw `generate_sound_effects`) from project-written English prompts in October 2026;
  same provenance model as the key art in `public/art/provenance.json`.
- License: project-original generated assets; no third-party license terms attached.
- Fingerprints (sha256, measured loudness/true peak) are recorded in
  `public/audio/audio-manifest.json`.

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

## Onboarding state machine adaptation — MIT

Files:

- `src/systems/onboardingState.ts`
- Onboarding presentation (prompts, skip control) in `src/scenes/UIScene.ts`

The five-step onboarding state machine (hold-threshold movement step, time-accumulated
auto-attack step, event-notified pickup/level-up/pause steps) was adapted from
`ricardo-foundry/canvas-vampire-survivors`, `src/tutorial.js`.

Upstream: `https://github.com/ricardo-foundry/canvas-vampire-survivors`
Pinned revision: `v2.8.0` @ `e616704889e57efc9c1f49098786a95c364008d3`
License: MIT.
Copyright (c) 2024 Survivor Game

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

OFELIYA rewrites the donor module in strict TypeScript as a presentation-free system
(no Phaser import, step copy moved to the UI layer, renamed to the project's onboarding
vocabulary); no upstream UI strings, URLs or other assets are imported.

Files (daily streak line):

- `src/systems/DailyHistory.ts`
- Daily share suffix in `src/scenes/UIScene.ts`
- Daily streak line in `src/ui/SocialHub.ts`

The daily-result history (14-day rolling window pruned by date string, not client
clock), the consecutive-day streak summary (current/best, local-calendar rollover
with `Date.setDate`), the retained all-time best-streak value, and the offline
Wordle-style emoji tile share idea were adapted from
`ricardo-foundry/canvas-vampire-survivors`, `src/daily.js`. The donor's
`dailySeed()`/`dailyChallenge()`/`cyrb53` are deliberately NOT reproduced:
OFELIYA's daily runs are server-authoritative (DailyRunClient + DailyRunIntent).

## Generated game art

Bloodstream backgrounds, mutation icons, gameplay VFX and procedural art fallbacks are generated by
project code at runtime/build time. The 2026-10-07 presentation pass additionally includes original
project-directed artwork generated with OpenAI image generation, rather than copied external sprites.

Files: `public/art/virus-player.webp`, `immune-antibody.webp`, `immune-tcell.webp`,
`immune-macrophage.webp`, `immune-prime.webp`, `cardiac-titan.webp`, `host-cell-shadow.webp`.
These are bounded transparent WebP derivatives of generated source images. Exact source identifiers,
dimensions and derivative SHA-256 hashes are recorded in `public/art/provenance.json`. They are not
claimed to be CC0 third-party stock assets. Existing CC0 audio notices remain applicable.

## Wave event surge adaptation — MIT

Files:

- `src/game/WaveEvents.ts`
- Wave-event scheduling in `src/game/WaveDirector.ts` (`updateWaveEvents` / `fireWaveEvent`)
- Wave-event warning presentation in `src/scenes/GameScene.ts` (`announceWaveEvent`)

The authored-surge pattern — a registry of named, timed events that announce
first and then fire a delayed geometric burst (their `spawnRattataCircle`
spawns a ring around the player after a warning flash) — was adapted from
`giovanneluna/poke-survivors`, specifically `src/systems/EventSystem.ts` and
`src/systems/SpawnSystem.ts`. OFELIYA rewrites the idea around its own stage
lifecycle, run-seeded deterministic RNG stream, threat caps and combat
telegraph language; no donor source file, art, audio, names or other assets
are imported (in particular, no Pokémon IP).

Upstream: `https://github.com/giovanneluna/poke-survivors`
License: MIT.

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

## Mini-boss behaviour adaptation — MIT

Files:

- `src/game/AnomalyPrime.ts` (attack state machine: pursuit / telegraph / strike / recovery)
- Anomaly behaviour branch in `src/game/Enemy.ts` (`updateAnomalyBehavior`)
- Mini-boss direction in `src/game/WaveDirector.ts` (`updateMiniBoss`)

The mini-boss state-machine shape — a charger-style walk / pause / charge cycle, a
rammer-style aim-commit-recover cycle, and a berserker-style enrage below a health
fraction — was adapted from `giovanneluna/poke-survivors`, specifically
`src/systems/EnemyBehaviors.ts` (charger, rammer, berserker behaviours). OFELIYA
rewrites the behaviour around its own two-phase pacing table, strict
radial-burst ↔ charge-dash alternation, combat telegraph primitives and stage
schedule validation. Donor `Math.random` usage and tween/tint telegraphs are NOT
reproduced: all randomness runs through the run-seeded `RunRng` gameplay streams
and the attack alternation itself is fully deterministic; telegraphs render only
through `drawRadialCombatTelegraph` / `drawDirectionalCombatTelegraph`. No donor
source file, art, audio, names or other assets are imported (in particular, no
Pokémon IP).

Upstream: `https://github.com/giovanneluna/poke-survivors`
License: MIT (license text quoted in the section above).

## Daily mutator adaptation — MIT

Files:

- `src/game/DailyMutator.ts`
- Daily-mutator banner in `src/scenes/GameScene.ts`
- Daily-mutator line in `src/ui/SocialHub.ts`

The "one authored modifier per calendar day" idea — a deterministic
rotation where the day (not a random draw) selects the modifier, so every
player worldwide faces the identical challenge — was adapted from
`ricardo-foundry/canvas-vampire-survivors`, `src/daily.js` (their
deterministic daily challenge and stage/boss rotation). OFELIYA rewrites
the idea around its own server-issued daily tickets: the modifier is a
pure FNV-1a hash of the server ticket's `dateKey` and only re-combines
existing `DifficultyProfile` multiplier knobs (no new simulation systems,
no runtime RNG consumed). The donor's local history/streak parts already
exist in OFELIYA as `DailyHistory`/`SocialHub` (see the daily streak
section above) and are not re-imported. No donor source file, art, audio,
names or other assets are imported.

Upstream: `https://github.com/ricardo-foundry/canvas-vampire-survivors`
Pinned revision: `v2.8.0` @ `e616704889e57efc9c1f49098786a95c364008d3`
License: MIT (license text quoted in the onboarding section above).
Copyright (c) 2024 Survivor Game

## Release rule

Any new third-party binary asset must add, in the same change:

1. exact upstream URL or package identity;
2. license identifier;
3. author/attribution text when required;
4. local file mapping.

This prevents repeating the incomplete per-file provenance of the early audio import.
