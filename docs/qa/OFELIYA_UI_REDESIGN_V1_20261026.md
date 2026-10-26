# OFELIYA — UI redesign v1

**Branch:** `feat/ui-redesign-v1-20261026`
**Base:** `main` @ `ce8ecb84ced1afa09870f2f00f9a0328257fd11c`
**Status:** implementation complete, draft PR open, not merged, not deployed.

---

## 1. Source documents

The task named three input documents that had to be read completely before any
implementation.

| Document | Status |
| --- | --- |
| `ofeliya-ui-audit-final.md` | **NOT AVAILABLE** |
| `ru-copy-dictionary.json` | **NOT AVAILABLE** |
| `ofeliya-qa-checklist.md` | **NOT AVAILABLE** |

None of the three exists anywhere this session can reach. The search covered:

* the working tree of the clone (517 files) — no match;
* **every** object of the full git history, including all 234 remote branches
  (`git rev-list --all --objects`) — no match;
* every pull request of the repository, open and closed, including their heads
  (GitHub code search on the exact filenames returned `total_count: 0`) — no match;
* the user drive — searches for `ofeliya`, `audit`, `checklist`, `copy`,
  `dictionary` and `ui audit` returned no matching file;
* the whole filesystem of the sandbox — no match.

**Consequence for this branch.** The audit's `ADOPTED / PROPOSAL / TO CONFIRM /
REJECTED` statuses and the dictionary's scoped replacements could not be read, so
nothing in this branch is derived from them. The implementation follows the
**task body itself** (sections 1–58 of the assignment, which specify the target
copy and structure literally) and the **current source code**, in the precedence
order the task defines. Where the task body says "verify against source", the
source was verified and the outcome is recorded below.

What this branch therefore does **not** contain:

* audit items that are not named in the task body — they are unknown, not
  skipped;
* the dictionary's additional scoped replacements — the exact replacement pairs
  the task body does not name are unknown;
* the QA checklist's own P0 list — its priorities were reinterpreted by
  IMPLEMENTATION OVERRIDE 1 as UI-SPRINT MUST-HAVE, and the task body enumerates
  the corresponding work items.

Two in-repo documents were used as the authoritative copy source instead:
`src/game/UiCopy.ts` (the player-facing RU copy catalog) and
`docs/GAME_LANGUAGE_BIBLE.md` (the canonical vocabulary). Where the task body
overrode the bible, the bible was updated in the same commit — see §7.

---

## 2. Base and head

| | SHA |
| --- | --- |
| `origin/main` at the start | `ce8ecb84ced1afa09870f2f00f9a0328257fd11c` |
| Previously released `ce8ecb84…` | `ce8ecb84ced1afa09870f2f00f9a0328257fd11c` |
| Final head | see §16 |

`origin/main` was fetched before the work started. **Main did not advance** beyond
the previously released `ce8ecb84…` — the branch was cut from the current main
and the working tree was clean at the start.

Commits (each one reviewable on its own):

1. `f9ca1c4` — the RU copy catalog and the shared number formatting;
2. `3c5d0a1` — the main menu;
3. `4ce5732` — the result screen and the three meta surfaces;
4. `8478b41` — the duplicated frame line and the extended contract.

---

## 3. Implemented items

### Main menu

| # | Item | Where |
| --- | --- | --- |
| 1 | One hierarchy: logo, art, statement, record, run configuration, CTA | `src/scenes/MenuScene.ts` |
| 2 | Hero copy kept, tagline `Выживай. Поглощай РНК. Эволюционируй.`, the redundant loop line removed | `MENU_COPY.hook`, `MENU_COPY.tagline` |
| 3 | One compact record line `Носитель: Олег · Рекорд: 15:20 · Уничтожено: 2 617` | `MenuScene` + `UiFormat.fmtInt` |
| 4 | One shared primary CTA style (mint plate, dark text, disabled state) | `src/ui/cta.ts` |
| 5 | Fresh state `НАЧАТЬ ЗАРАЖЕНИЕ` + `Кровоток · Стандарт` | `MenuScene` |
| 6 | Resume state `ПРОДОЛЖИТЬ ЗАБЕГ` + `Кровоток · 00:19 · Уровень 2 · Стандарт` + `НОВЫЙ ЗАБЕГ` as a real touch target | `MenuScene` |
| 7 | Difficulty card: title, current difficulty, description, chevron, unchanged selector behaviour | `MenuScene` |
| 8 | Control card: the three real control modes preserved (the chevron is truthful) | `src/game/ControlMode.ts` untouched |
| 9 | 2×2 navigation grid `РЕЙТИНГ · ЗАДАЧИ ДНЯ · КОДЕКС · КОЛЛЕКЦИЯ`, codex progress as a badge | `MenuScene` |
| 10 | Audio row `Музыка / Звук / Эффекты` as вкл/выкл, stored volumes untouched until tapped | `MenuScene` |
| 11 | Legal row `О приложении · Политика · Поддержка`; build SHA and host platform moved to About | `src/legal/LegalOverlay.ts` |

### Result screen

| # | Item | Where |
| --- | --- | --- |
| 12 | The gameplay HUD is hidden while the result owns the screen | `UIScene.setHudHidden` |
| 13 | `ИТОГ ЗАБЕГА` / `ШТАММ УНИЧТОЖЕН` / `НОСИТЕЛЬ ЗАРАЖЁН`, `забег` instead of `цикл` | `RESULT_COPY` |
| 14 | Compact stats with thousands separators | `UiFormat.fmtInt` |
| 15 | An absent critical or legendary mutation renders nothing; a present one uses the full copy | `UIScene.renderGameOver` |
| 16 | The build is named `Архетип: Снарядный штамм` (a deterministic classification exists) | `src/game/RunIdentity.ts` |
| 17 | The place line never invents a board | see §5 |
| 18 | A resumed run says `Тренировка · продолженный забег` | `RESULT_COPY.resumed` |
| 19 | `НОВЫЙ ЗАБЕГ` / `БРОСИТЬ ВЫЗОВ ДРУГУ` / `ВЫЗВАТЬ НА ДУЭЛЬ` / `В МЕНЮ`, backend actions unchanged | `UIScene` |
| 20 | The share text names OFELIYA first, says `продержался` after a defeat, carries the bot handle and no forbidden term | `UiCopy.buildShareText` |

### Daily tasks, rating, codex, collection

| # | Item | Where |
| --- | --- | --- |
| 21 | `КВЕСТЫ` → `ЗАДАЧИ ДНЯ`; the UTC string, the local language and the reward disclaimer removed; the countdown uses the rotation's own UTC reset | `src/ui/QuestBoard.ts` |
| 22 | Task cards: title, description, a real progress bar, `current / target`, the remaining count, `◆ ВЫПОЛНЕНО` | `QuestBoard` |
| 23 | `КОДЕКС` without the strain code; the `МУТАЦИИ` tab kept (see §5); `ПРОХОЖДЕНИЕ РЕЖИМОВ` | `MenuScene.showCodex` |
| 24 | No invented synergy pairings — the locked state is truthful | see §5 |
| 25 | `Снарядный штамм`, `ПРОХОЖДЕНИЕ РЕЖИМОВ`; the internal ids untouched | `RunIdentity.ts` |
| 26 | `КОЛЛЕКЦИЯ` with `ОБОЛОЧКИ · ВЕХИ · ЛАБОРАТОРИЯ`; the streak/visit line removed | `src/ui/CollectionBoard.ts` |
| 27 | One shells explanation, `✓ АКТИВЕН`, `ЗАКРЫТО` + the verified unlock condition, no select action on a locked shell | `CollectionBoard` |
| 28 | A paginator only when there is more than one page | `src/ui/collectionPages.ts` |
| 29 | `ВЕХИ` with a completed state; every subsystem shows its own real value | `CollectionBoard` |
| 30 | `СВОДКА` → `РЕЙТИНГ` with the sections `ЗАБЕГ ДНЯ · СЕЗОН · ДРУЗЬЯ` | `src/ui/SocialHub.ts` |
| 31 | `НАЧАТЬ ЗАБЕГ ДНЯ` | `SocialHub` |
| 32 | `СЕРИЯ 0` never rendered; an empty state instead | `SocialHub` |
| 33 | `Игрок (TG)` / `Игрок (MAX)` — the payload carries no display name | `SocialHub` |
| 34 | `РЕДКИЙ, НО МЕТКИЙ` was already absent from the current source | verified |
| 35 | The friends list gets an invite action instead of a dead end | `SocialHub` |
| 36 | The network error never promises a preserved progress | `SocialHub` |
| 37 | One modal frame: centered title, a 44×44 top-right close control, no second close button, one padding and radius recipe | `src/ui/modal.ts` |
| 38 | The duplicated frame line removed (see §6) | `modal.ts`, `MenuScene`, `UIScene`, `SocialHub` |
| 39 | One internal dock `ЗАДАЧИ ДНЯ · КОДЕКС · КОЛЛЕКЦИЯ`, rating excluded | `src/ui/modal.ts` |
| 40 | Thousands separators with a non-breaking space, `4 / 5`, `MM:SS` | `src/game/UiFormat.ts` |
| 41 | The existing palette only; no new framework | `src/ui/cta.ts`, `src/ui/modal.ts` |
| 42 | Every interactive surface touched is at least 44×44 | asserted by `tests/ui-redesign.mjs` |
| 43 | The responsive matrix 320 / 390 / 768 / 1080 | `docs/qa/ui-redesign-v1-evidence/` |
| 44 | Deterministic fixtures only, no mock-ups | `tests/ui-redesign.mjs` |
| 45 | RED → GREEN per behaviour | the contract test was written against the old copy and failed first |

---

## 4. Deferred items

| Item | Status | Reason |
| --- | --- | --- |
| `Погиб от: …` | **DEFERRED — requires new gameplay state** | IMPLEMENTATION OVERRIDE 2. The state does not contain the last attacker, the lethal damage source or the largest recent hit. Nothing was fabricated and no gameplay tracking was added. |
| `Задача «…»: 4 / 5 — остался 1` (the nearest task) | **DEFERRED — product rule required** | IMPLEMENTATION OVERRIDE 3. `src/quests/questRuntime.ts` exposes `activeQuestIds` in *selection* order; there is no `selected` / `active` / `tracked` / `closest` concept in the code. The result screen was completed without the line. |
| `УЛУЧШИТЬ РЕЗУЛЬТАТ` | **DEFERRED — product rule required** | §31. The backend does not implement unlimited repeats with best-attempt-only semantics. The safe CTA `НАЧАТЬ ЗАБЕГ ДНЯ` is used. |
| Synergy pair recipes | **DEFERRED — no source** | §24. `src/game/UpgradeSystem.ts` has no pair requirements. The codex shows the real critical mutations and a truthful locked state. |
| Milestone pagination → scroll | **DEFERRED — P1** | §28. The paginator is hidden when there is one page; the scroll conversion is not a v1 change. |

---

## 5. Source-truth corrections

The task asked to verify several things against the current source before using
them. The source did not always support the proposal.

1. **The board of a rank is not always knowable.**
   `server/index.mjs` computes the place with
   `getTop({ period: record.daily ? 'daily' : 'all' })`.
   * A **daily** submission carries `daily: true`, so its place is the **daily**
     board — deterministic. The result screen therefore shows
     `★ МЕСТО #N В РЕЙТИНГЕ ДНЯ`.
   * An **ordinary ranked** submission carries `daily: false`, so its place comes
     from the `all` board, **not** the `season` board (`period: 'season'` is a
     different filter and is never used for a submission). The response payload
     (`ScoreSubmitResponse`) carries no board identifier at all. The client
     therefore keeps the neutral `РЕЙТИНГ · МЕСТО #N` and never claims a season.
   * A **resumed** run is never submitted at all — `submitRunScore` returns `null`
     for `result.resumed` — so it can never carry a place. It says
     `Тренировка · продолженный забег`.
2. **The `МУТАЦИИ` codex tab was not renamed to `СИНЕРГИИ`.**
   §23 allows the rename only if the content is genuinely synergy content. The
   tab lists the three evolution ids (`prism`, `halo`, `singularity`) under
   `КРИТИЧЕСКИЕ МУТАЦИИ` — critical-mutation content, not synergy. The tab kept
   the name `МУТАЦИИ`, which also matches the canonical vocabulary.
3. **A named archetype does exist.** `assessRunIdentity` in
   `src/game/RunIdentity.ts` is a deterministic classification
   (`projectile` / `orbit-control` / `infection-lysis` / `hybrid`, focused when
   `score ≥ 5 && margin ≥ 1.75`), so `Архетип: {name}` is truthful. The tags are
   shown only for a focused build, because a hybrid build has no single set of
   signals.
4. **There are three real control modes** (`one-hand`, `two-hand`, `dual-move`),
   so the control card keeps its chevron and its cycling behaviour. §8's
   "remove the chevron" branch does not apply.
5. **The compact difficulty description** (`базовый` / `сложнее`) is existing
   behaviour at short viewports and was left alone: it is the pre-existing
   short hint, not a newly hardcoded balance description, and the difficulty
   module was not touched (see §11).
6. **The counters are not merged.** `Носитель` is the messenger display name,
   `Рекорд` is `SaveData.bestSurvivalMs` (the best survival time) and
   `Уничтожено` is `SaveData.bestKills` (the best *single run*). `totalKills`
   (lifetime) and the milestone counters are a different window and are shown
   only in their own surfaces. No `Math.max` reconciliation was introduced.
7. **Progress preservation on the network error is not provable** on the rating
   surface: it is a read path, it holds no player progress. The copy states what
   happened (`Нет соединения с сервером`) and offers `ПОВТОРИТЬ` instead of
   promising a preserved progress.
8. **`РЕДКИЙ, НО МЕТКИЙ` was already absent** from the current source — no
   change was needed for §34.

---

## 6. The double-line artifact

The repeated top-left line in a framed panel was **duplicated geometry**, not
decoration and not a renderer artifact: the plate under every frame drew its own
1px straight border while the specimen membrane drew a second, rounded border
0.5px inside it. At the corners both lines were visible.

Fix: the membrane surface owns the frame. The straight stroke was removed from
the menu cards, the modal frame, the rating panel and the HUD strip.

Evidence: `docs/qa/ui-redesign-v1-evidence/doubleline-card-before.png` and
`…-after.png` (the same card, 4× device pixel ratio).

---

## 7. Before / after

### Main menu

| | Before | After |
| --- | --- | --- |
| Statement | `СИНТЕТИЧЕСКИЙ ВИРУС. ЖИВОЙ ОРГАНИЗМ.` + `Выживай. Собирай РНК. Меняй штамм.` + a third loop line at the bottom | the same statement + one tagline `Выживай. Поглощай РНК. Эволюционируй.`, nothing else |
| Record | a separate `Носитель: Олег` line and a block `Выживание 15:20 · ПРАЙМ — / Кампания — · клетки 2617` | one line `Носитель: Олег · Рекорд: 15:20 · Уничтожено: 2 617`; unknown fields disappear |
| Navigation | five texts in one row: `музыка: 50 %`, `звук: вкл`, `эффекты: 30 %`, `СВОДКА`, `КОДЕКС 3/9` | a 2×2 grid `РЕЙТИНГ · ЗАДАЧИ ДНЯ / КОДЕКС 3/9 · КОЛЛЕКЦИЯ`, and a separate row `Музыка: вкл · Звук: вкл · Эффекты: вкл` |
| Primary action | a dark maroon plate with light text | one mint plate with dark text, used by the menu, the result and the daily action |
| Resume | a duplicated yellow `НЕЗАВЕРШЁННЫЙ ЗАБЕГ` banner above the button | the state is stated once: `ПРОДОЛЖИТЬ ЗАБЕГ` + `Кровоток · 00:19 · Уровень 2 · Стандарт`; the cards say they configure the next run |
| Technical data | `mini-app · tdesktop · ce8ecb8` on the main menu | moved to the About surface; the host is named `MAX` / `Telegram` / `Браузер`, never the raw token |

### Results

| | Before | After |
| --- | --- | --- |
| Header | `STRAIN ZERO / ИТОГ ЦИКЛА` | `ИТОГ ЗАБЕГА` |
| Outcome | `ИММУНИТЕТ ПОДАВЛЕН` | `НОСИТЕЛЬ ЗАРАЖЁН` |
| HUD | visible through the scrim | hidden |
| Stats | `УНИЧТОЖЕНО: 2617 · Заражено: 61` / `Пик мутации: 23 · Комбо ×460` | `Уничтожено: 2 617 · Заражено клеток: 61` / `Уровень мутации: 23 · Комбо ×460` |
| Mutations | `КРИТ. МУТАЦИИ: нет` / `ЛЕГЕНДАРНЫЕ: нет` | nothing when absent; `◆ КРИТИЧЕСКАЯ МУТАЦИЯ: …` / `◆ ЛЕГЕНДАРНАЯ МУТАЦИЯ: …` when present |
| Build | `ПРОФИЛЬ ШТАММА: ПРОЕКТИЛЬНЫЙ · …` | `Архетип: Снарядный штамм · …` |
| Resumed | `РЕЖИМ: СТАНДАРТ · ВОЗОБНОВЛЁН · ВНЕ РЕЙТИНГА` | `РЕЖИМ: СТАНДАРТ · Тренировка · продолженный забег` |
| Actions | `ЕЩЁ ОДИН ЦИКЛ` / `БРОСИТЬ ВЫЗОВ` / `БРОСИТЬ ДУЭЛЬ` / `В МЕНЮ` | `НОВЫЙ ЗАБЕГ` / `БРОСИТЬ ВЫЗОВ ДРУГУ` / `ВЫЗВАТЬ НА ДУЭЛЬ` / `В МЕНЮ` |
| Share | `Мой STRAIN-0 выжил 15:20. Иммунных клеток: 2617…` | `OFELIYA — штамм продержался 15:20. Уничтожено: 2 617 · заражено клеток: 61. Сможешь дольше? @ofeliya_game_bot` |

### Daily tasks

| | Before | After |
| --- | --- | --- |
| Title | `КВЕСТЫ` | `ЗАДАЧИ ДНЯ` |
| Subtitle | `Обновление в 00:00 UTC` / `Локальный прогресс · без наград` | `Выполнено: 2 из 3 · Обновление через 05:23` |
| Task | `Выполнено · локально` or `4 / 5` | `◆ ВЫПОЛНЕНО` or `4 / 5 · остался 1` with a progress bar |
| Frame | its own panel and a bottom `ЗАКРЫТЬ` | the shared frame and the internal dock |

### Rating

| | Before | After |
| --- | --- | --- |
| Title | `СВОДКА` | `РЕЙТИНГ` |
| Sections | `СЕГОДНЯ · СЕЗОН · ДРУЗЬЯ` | `ЗАБЕГ ДНЯ · СЕЗОН · ДРУЗЬЯ` |
| Daily action | `НАЧАТЬ ЕЖЕДНЕВНЫЙ ЗАБЕГ` | `НАЧАТЬ ЗАБЕГ ДНЯ` |
| Table row | `#7 · TG` | `#7 · Игрок (TG)` |
| Streak | `СЕРИЯ 0 · РЕКОРД 3` is possible | an empty state sentence |
| Friends | `ПОКА НЕТ РЕЗУЛЬТАТОВ ДРУЗЕЙ` | `Здесь появятся результаты друзей, которые играют в OFELIYA.` + `ПРИГЛАСИТЬ ДРУЗЕЙ` |
| Error | `НЕТ СОЕДИНЕНИЯ · МОЖНО ПОВТОРИТЬ` | `Нет соединения с сервером` + a `ПОВТОРИТЬ` action |

### Codex

| | Before | After |
| --- | --- | --- |
| Title | `КОДЕКС · STRAIN-0` | `КОДЕКС` |
| Mastery | `МАСТЕРСТВО КАМПАНИИ` | `ПРОХОЖДЕНИЕ РЕЖИМОВ` |
| Counter | `ЦИКЛОВ: 12 · УНИЧТОЖЕНО КЛЕТОК: 800` | `ЗАБЕГОВ: 12 · УНИЧТОЖЕНО: 800` |
| Tabs | `МУТАЦИИ · ЛЕГЕНДАРНЫЕ · МАСТЕРСТВО` | unchanged — the content is critical mutations, not synergies |
| Navigation | a `КВЕСТЫ` / `КОЛЛЕКЦИЯ` footer | the internal dock `ЗАДАЧИ ДНЯ · КОДЕКС · КОЛЛЕКЦИЯ` |

### Collection

| | Before | After |
| --- | --- | --- |
| Title | `КОЛЛЕКЦИЯ ШТАММА` | `КОЛЛЕКЦИЯ` |
| Tabs | `ЦЕЛИ · ШТАММЫ · ЛАБОРАТОРИЯ` | `ОБОЛОЧКИ · ВЕХИ · ЛАБОРАТОРИЯ` |
| Streak | `Посещений: 4 · серия: 2 дн.` | removed |
| Shells | `Только внешний вид` on every shell | one explanation for the tab |
| Selected | `ВЫБРАН` | `✓ АКТИВЕН` on a filled plate |
| Locked | a disabled `ВЫБРАТЬ` | `ЗАКРЫТО` + the verified unlock condition, no select action |
| Paginator | always shown | only when there is more than one page |

---

## 8. Tests

### The new contract

`node tests/ui-redesign.mjs` (`npm run test:ui-redesign`) drives the real
application in a real browser over four viewports and asserts the copy contract,
the hierarchy, the touch targets, the result rules and the internal dock. It is
wired into the CI browser job.

### Existing gates

The existing repository gates were run before and after the change. The gates
that pinned the old copy were updated to the new contract — never weakened:

| Gate | Before | After |
| --- | --- | --- |
| `test:language` (player language guard) | PASS | PASS |
| `test:ui-copy` | PASS | PASS |
| `test:mutation-copy` | PASS | PASS |
| `test:tokens` | PASS | PASS |
| `test:challenge` | PASS | PASS |
| `test:duel` | PASS | PASS |
| `test:telegram-share` | PASS | PASS |
| `test:result-actions` | FAIL (no Chrome in the sandbox) | PASS |
| `test:daily-cta` / `daily-v2` / `daily-preview` / `daily-history` | PASS | PASS |
| `test:streaks` | PASS | PASS |
| `test:score-outbox` / `social` / `profile` | PASS | PASS |
| `test:save` / `test:checkpoint` | PASS | PASS |
| `test:onboarding` / `test:viewport` | PASS | PASS |
| `test:presentation` | PASS | PASS |
| `test:integration-visual` | FAIL (the old five-item utility row) | PASS |
| `test:b2b4-fixes` | PASS | PASS |
| `test:muse-client` / `test:quest-core` / `test:quest-runtime` | PASS | PASS |
| `test:layout-diagnostics` | PASS | PASS |
| `test:review-browser` | FAIL (the old legal copy, the old codex footer) | PASS |
| `npx tsc --noEmit` | PASS | PASS |
| `git diff --check` | PASS | PASS |

The exact commands are in §9.

---

## 9. Exact commands

```
npx tsc --noEmit
npm run test:language
npm run test:ui-copy
npm run test:mutation-copy
npm run test:tokens
npm run test:challenge
npm run test:duel
npm run test:telegram-share
npm run test:result-actions
npm run test:daily-cta
npm run test:daily-v2
npm run test:daily-preview
npm run test:daily-history
npm run test:streaks
npm run test:score-outbox
npm run test:social
npm run test:profile
npm run test:save
npm run test:checkpoint
npm run test:onboarding
npm run test:viewport
npm run test:presentation
npm run test:integration-visual
npm run test:b2b4-fixes
npm run test:muse-client
npm run test:quest-core
npm run test:quest-runtime
npm run test:layout-diagnostics
npm run test:review-browser
node tests/ui-redesign.mjs
git diff --check
```

`npm run build` is the remaining repository gate; it runs `tsc --noEmit`,
`vite build` and the release stamp.

---

## 10. Viewport matrix

| Viewport | Fresh menu | Resume menu | Result | Daily tasks | Codex | Collection |
| --- | --- | --- | --- | --- | --- | --- |
| 320×568 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 390×740 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768×1024 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1080×1920 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

The menu geometry is computed by `src/ui/menuLayout.ts`, a pure function: the
hero art absorbs the free space, the gaps grow up to a maximum and the whole
block centres itself on a viewport taller than the content. Every interactive
band is at least 44px tall.

Screenshots: `docs/qa/ui-redesign-v1-evidence/`.

---

## 11. EASY conflict notes — `UI_REDESS × EASY integration notes`

MiniMax is implementing EASY in parallel. This branch does **not** add EASY,
does not touch the difficulty enum and does not tune anything. The conflicts
that remain:

| # | Conflict | Where | Severity | Note |
| --- | --- | --- | --- | --- |
| 1 | The difficulty card is redesigned | `MenuScene` — the card, `renderDifficulty` | **medium** | The card renders whatever `getDifficultyProfile(id)` returns, so a third mode appears without a code change here — but the card must then fit **three** labels and a longer description inside the same box. The compact branch currently falls back to the pre-existing short hint below a 170px card width. |
| 2 | The difficulty copy | `src/game/DifficultyProfile.ts` | **low** | Untouched by this branch. A third `description` must be data-driven; the compact short hint in `MenuScene` is a pre-existing scene-local string, not a profile field. If EASY wants a data-driven short description, it belongs in the profile — and that would be the second touch point on this file. |
| 3 | The difficulty enum | `src/game/DifficultyProfile.ts` | **none here** | Untouched. `DifficultyId` is unchanged in this branch. |
| 4 | The result difficulty label | `UIScene` — `РЕЖИМ: …` | **low** | The label is derived from `res.difficultyId` and only distinguishes `standard` from "not standard". A third mode needs a third branch here. |
| 5 | The run-configuration line | `MenuScene` — `renderRunConfiguration` | **low** | `Кровоток · Стандарт` is built from the selected difficulty's short label, so a third mode flows through; the title case helper covers it. |
| 6 | The persisted selection | `readDifficultySelection` / `writeDifficultySelection` | **none here** | Untouched. The stored value keeps working: an unknown value already falls back to `standard`. |
| 7 | The resume state | `MenuScene` — the checkpoint summary | **low** | The summary prints the checkpoint's difficulty, so a third mode shows correctly without a change. |
| 8 | The EASY branch must not be merged or cherry-picked here | — | — | This branch is cut from `main` and contains no EASY work. |

**Merging order.** This branch touches `MenuScene` (the card, the run
configuration, the result) and the shared copy catalog. The EASY branch touches
`DifficultyProfile` and the menu. A merge will therefore conflict in
`MenuScene` around the difficulty card and around the difficulty copy. The
resolution is mechanical: keep this branch's card layout and take EASY's
profile, then check that the third description still fits the compact card.

---

## 12. Analytics compatibility

* `src/systems/AnalyticsClient.ts` — **untouched**.
* `server/` — **untouched**.
* The semantic event ids are unchanged and their callsites did not move:
  `replay` (1), `share` (3), `daily` (1), the duel `open` (1) and the duel
  `start` (1) — identical before and after.
* The share event keeps its three kinds (`challenge`, `duel`, `daily-result` /
  `result`); only the *text* of the share changed, not the event or its
  parameters.
* **No event callsite was moved.** The only structural change near the analytics
  is the result screen's action labels, and each action still calls the same
  event with the same payload.
* PR #247 (the analytics read path) is untouched by this branch.

---

## 13. Safety

* no EASY implementation — **confirmed**
* no difficulty balance change — **confirmed**
* no Standard tuning change — **confirmed**
* no mutation mechanics change — **confirmed**
* no Daily rule change — **confirmed** (the countdown reads the existing UTC
  rotation; the reset timing is untouched)
* no leaderboard rule change — **confirmed** (the rank wording follows the
  server's own board)
* no save migration — **confirmed** (the save schema is untouched; the audio
  values are only written when the player taps a switch)
* no analytics backend change — **confirmed**
* no MAX lifecycle change — **confirmed**
* no Telegram lifecycle change — **confirmed**
* no payment change — **confirmed**
* no production configuration — **confirmed**
* no deploy — **confirmed**
* no merge — **confirmed**
* no EASY merge or cherry-pick — **confirmed**

---

## 14. Known limitations

1. The three source documents are unavailable, so the audit's own status list and
   the dictionary's additional replacements could not be applied. §1 states
   exactly what that costs.
2. The compact difficulty card keeps the pre-existing short hint
   (`базовый` / `сложнее`) below a 170px card width, because the full
   description does not fit. The full profile description is used as soon as the
   card is wide enough.
3. The milestone pagination is still a paginator; the scroll conversion is a P1
   item per §28.
4. The desktop viewports (768 and 1080) keep the game's existing logical-pixel
   font sizes. The layout adapts, the type does not scale — a separate
   typographic pass would be needed for a tablet.
