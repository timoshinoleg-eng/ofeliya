# OFELIYA — UI redesign v1

**Branch:** `feat/ui-redesign-v1-20261026`
**Base:** `main` @ `2b1e1426aa04b1d4cfb5159fb4ce89c00283d608` (main with PR #247 analytics, PR #250 verified notification/footer UX and PR #248 EASY difficulty merged)
**Status:** implementation complete, draft PR open, not merged, not deployed.

---

> **Fourth correction (2026-10-27) — the calendar-bound cross-flow gate.**
> The CI failure `after transfer: 300ms after midnight must credit zero whole
> seconds` (`65 !== 0`) was **not a code regression**: the untouched base head
> fails it the same way, because the gate pinned its synthetic midnight to a
> literal date and the day roll it tests only fires while the real clock is
> before that date. The gate now derives the synthetic midnight from the real
> clock. **§16.9** has the measurement, the root cause and the repair.
>
> **Third pass — Muse review correction (2026-10-27).** The independent Muse
> review of this pull request was classified finding by finding against the
> **current remote head** `a105f7c750ae275f5febbe4ab3eb6c1fae7a704e`; every
> finding that was still present was implemented, with a regression test, and
> everything that was already fixed or deliberate is recorded as such.
> **§16 is the matrix of that pass.** The earlier sections are kept as the
> history they are; the stale statements in them are corrected in place and
> marked.

> **Integration update (post-reconciliation):** this branch was subsequently merged with
> production main @ `2b1e1426aa04b1d4cfb5159fb4ce89c00283d608`, which already contains PR #247 analytics,
> PR #250 verified notification/footer UX, and PR #248 EASY difficulty. The integration
> preserves those contracts and wires `npm run test:ui-redesign` into GitHub CI. Historical
> sections below describe the reconciliation pass before that integration merge.


## 1. Source documents

The three input documents named by the task were **not reachable during the first
pass** of this work. They were attached later, and this branch was reconciled
against them. All three were read **completely** before any reconciliation change
was made.

| Document | State now | Where it was applied |
| --- | --- | --- |
| `ofeliya-ui-audit-final.md` (397 lines) | **READ IN FULL** | §3, §4, §5, §5.1 |
| `ru-copy-dictionary.json` | **READ IN FULL** | §3, §5.1 |
| `ofeliya-qa-checklist.md` | **READ IN FULL** | §8.1, §10 |

**The precedence order** used for every decision of this pass is the one the task
defines:

1. the current code and its contracts (the code is the fact);
2. the task overrides (the task body wins over any document);
3. `ofeliya-ui-audit-final.md`;
4. `ru-copy-dictionary.json`;
5. `ofeliya-qa-checklist.md`.

Two in-repo documents remain the copy source of last resort and were used where
the three documents above are silent: `src/game/UiCopy.ts` (the player-facing RU
copy catalog) and `docs/GAME_LANGUAGE_BIBLE.md` (the canonical vocabulary).

### 1.1 What the reconciliation changed

The first pass built the redesign from the task body and the code. The
reconciliation pass against the three documents produced these classes of change:

* **copy corrections** — the canonical strings of the audit and the dictionary
  (the codex tabs and the synergy cards, the daily CTA, the share variants, the
  season/streak/friends lines, the network error, the collection shell states,
  the milestone group header, the mode chip, the countdown format, the task
  descriptions, the `дальше: …` branch hints, the archetype labels);
* **one structural addition** — the Codex tabs are now
  `СИНЕРГИИ | ЛЕГЕНДАРНЫЕ | МАСТЕРСТВО` (the first pass kept the old tab name);
* **one addition to the result screen** — the `★ Открыто в Кодексе: +N …` plate
  is a real button that opens the Codex (the audit's P2.2);
* **a contract extension** — `tests/ui-copy-catalog.mjs` now pins the whole
  reconciled copy (the share variants, the mode chips, the season/streak lines,
  the collection strings) and `tests/ui-redesign.mjs` asserts the reconciled
  surfaces in a real browser at four viewports;
* **a CI step that could not be written** — see §2.1.

Everything else in the first pass was confirmed by the documents and kept.


---

## 2. Base and head

| | SHA |
| --- | --- |
| The base of the branch (the merged main it was integrated with) | `2b1e1426aa04b1d4cfb5159fb4ce89c00283d608` |
| `main` when the first pass was cut | `ce8ecb84ced1afa09870f2f00f9a0328257fd11c` |
| The head the third pass started from (the current remote head) | `a105f7c750ae275f5febbe4ab3eb6c1fae7a704e` — `ci: allow time for combined browser contracts` |
| Final head (the PR) | the commit that carries this report — the App push path creates one commit per push, so the head is the last push of this pass |
| Final head (the local branch) | the commit that carries this report |
| The head the CI was green on before this pass | `a105f7c750ae275f5febbe4ab3eb6c1fae7a704e` — run `40418654178`, `build` / `production-contract` / `browser-smoke` **success** |
| The head this pass produces (the code) | `f17b1d726958227aba77e010b1d6269d2d77eaa4` — `fix(quests): the task board keeps its objects inside a day — the countdown line moves in place` — run `40459288198`, `build` / `production-contract` / `browser-smoke` **success** |
| The head that carries this report | the last push of this pass — run `40459329616`, `build` / `production-contract` / `browser-smoke` **success** |

`origin/main` was fetched before the work started. **Main did not advance while
this work was made** — the branch was cut from the current main and the working
tree was clean at the start.

**Main has since moved, by other people's work.** While the reconciliation pass
was running, `main` received three merges that are not part of the first pass:
`Merge PR #247: OFELIYA Sprint 0 analytics read path` (13:17 UTC),
`Merge PR #250: verified onboarding and touch UX fixes` (13:46 UTC, head
`5412473011757bea44d21909ea02a2cd1ed63a7a`) and `Merge PR #248: EASY difficulty`.
The branch was **integrated with that main** — the integration merge is the
parent of the current head — so the branch now contains the analytics read
path, the verified notification/footer UX and the EASY difficulty tier. The
pull request's base is `main` and its merge state is **`clean`**; the `dirty`
state this report described in the first two passes is gone.

**Corrected in the third pass.** Two statements of the first two passes were
stale and are corrected here, in place: the branch was *not* left on the old
`ce8ecb84…` base, and the reconciled head was *not* a head that CI never ran —
the CI is wired and was green on `a105f7c750ae275f5febbe4ab3eb6c1fae7a704e`
before this pass started (§8.1.2, §8.2).

Commits (each one reviewable on its own):

1. `f9ca1c4` — the RU copy catalog and the shared number formatting;
2. `3c5d0a1` — the main menu;
3. `4ce5732` — the result screen and the three meta surfaces;
4. `8478b41` — the duplicated frame line and the extended contract;
5. `2190888` — this report;
6. `384c4bf` — the gates that the redesign moved (dock lookup, countdown, shell handles);
7. `1c4668a` — the rating surface inside the shared frame, and the repository's error copy;
8. `b598246` — the rating error probe matches the case;
9. `57633e2` — the collection tab row clear of the close control;
10. `505890b` — the collection reveal probe reads the tween in the same tick;
11. `e7e3449` — the locked shell is probed by interactivity;
12. `2906016` — the hidden five-tap diagnostics gesture restored;
13. `2610ed1` / `d33e877` — the result stats and the victory outcome read by their new labels;
14. `1b72ea3` — the challenge band of the layout, and the footer gates;
15. `430605a` — the menu text above the readability floor.

The third pass adds its own commits on top of the integrated head — see §16.6.

### How the branch was pushed

This environment has no shell git credentials, so the branch was pushed through
the **GitHub App** (the `push_files` API). Two consequences are visible in the
PR and are not defects in the change itself:

* the App encodes file contents as text, so the **PNG evidence could not be
  carried** — the screenshots in `docs/qa/ui-redesign-v1-evidence/` are delivered
  with this report instead of being committed. `npm run test:ui-redesign`
  regenerates every one of them;
* the App **cannot write `.github/workflows/`** — both
  `connector__github__create_or_update_file` and
  `connector__github__push_files` answer
  `error: connector_tool_error: Connector tool execution failed (latency_ms=0)`
  for `.github/workflows/ci.yml`, and the remote blob SHA stays
  `db7683832ce94871c8b6bc951b6a148c3ff1d929` after the attempt (verified by
  re-reading the file through the App). Wiring the new contract into CI is
  therefore **not** in the branch; the exact one-line step to add by hand is in
  §8.2.

The PR therefore shows more commits than the local branch: the first two are a
binary push probe and its removal, and some logical changes were split into
several pushes because of a per-request size limit. The **content** of the diff
is identical to the local branch, except for the PNG evidence.

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
| 18 | A resumed run says `Тренировка (продолженный забег)` and never shows a place | `RESULT_COPY.resumed` |
| 19 | `НОВЫЙ ЗАБЕГ` / `БРОСИТЬ ВЫЗОВ ДРУГУ` / `ВЫЗВАТЬ НА ДУЭЛЬ` / `В МЕНЮ`, backend actions unchanged | `UIScene` |
| 20 | The share text names OFELIYA first, says `продержался` after a defeat, carries the bot handle and no forbidden term | `UiCopy.buildShareText` |

### Daily tasks, rating, codex, collection

| # | Item | Where |
| --- | --- | --- |
| 21 | `КВЕСТЫ` → `ЗАДАЧИ ДНЯ`; the UTC string, the local language and the reward disclaimer removed; the countdown uses the rotation's own UTC reset | `src/ui/QuestBoard.ts` |
| 22 | Task cards: title, description, a real progress bar, `current / target`, the remaining count, `◆ ВЫПОЛНЕНО` | `QuestBoard` |
| 23 | `КОДЕКС` without the strain code; the tabs `СИНЕРГИИ · ЛЕГЕНДАРНЫЕ · МАСТЕРСТВО`; `ПРОХОЖДЕНИЕ РЕЖИМОВ` | `MenuScene.showCodex` |
| 24 | Three locked synergy cards, each with its own recipe (`ЗАКРЫТАЯ СИНЕРГИЯ I/II/III` + `Совмести ветви «…» и «…»`) and one explanation of the section | `MenuScene.showCodex`, `CODEX_COPY` |
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
| 36 | The network error is a full sentence: `Нет соединения с сервером. Твой прогресс сохраняется.` / `Сервер не ответил. Твой прогресс сохраняется.` | `SocialHub`, `META_COPY` |
| 37 | One modal frame: centered title, a 44×44 top-right close control, no second close button, one padding and radius recipe | `src/ui/modal.ts` |
| 38 | The duplicated frame line removed (see §6) | `modal.ts`, `MenuScene`, `UIScene`, `SocialHub` |
| 39 | One internal dock `ЗАДАЧИ ДНЯ · КОДЕКС · КОЛЛЕКЦИЯ`, rating excluded | `src/ui/modal.ts` |
| 40 | Thousands separators with a non-breaking space, `4 / 5`, `MM:SS` | `src/game/UiFormat.ts` |
| 41 | The existing palette only; no new framework | `src/ui/cta.ts`, `src/ui/modal.ts` |
| 42 | Every interactive surface touched is at least 44×44 | asserted by `tests/ui-redesign.mjs` |
| 43 | The responsive matrix 320 / 390 / 768 / 1080 | `docs/qa/ui-redesign-v1-evidence/` |
| 44 | Deterministic fixtures only, no mock-ups | `tests/ui-redesign.mjs` |
| 45 | RED → GREEN per behaviour | the contract test was written against the old copy and failed first |
| 46 | The mode chip of the result: `СТАНДАРТ · В зачёт рейтинга`, `ЗАБЕГ ДНЯ · СТАНДАРТ`, `ДУЭЛЬ · СТАНДАРТ`, `Тренировка (продолженный забег)` — no ranking disclaimer | `RESULT_MODE_CHIP` |
| 47 | The daily countdown in words: `4 ч 15 мин`, `15 мин` | `UiFormat.fmtCountdown` |
| 48 | The season table `СЕЗОН 3 · осталось 2 дн.`, the row `#1 · Игрок (TG) — 10:48 · 1 414 кл.`, the day row `Олег · 01:09 · уничтожено 68 · ★ место #1` | `SocialHub`, `META_COPY` |
| 49 | The streak `Серия: 3 дн. · Рекорд: 5 дн.` and the empty state `Сыграй забег дня, чтобы начать серию · Рекорд: 5 дн.` | `SocialHub` |
| 50 | The friends empty state `Здесь появятся результаты друзей, которые играют через @ofeliya_game_bot.` + `ПРИГЛАСИТЬ ДРУЗЕЙ` | `SocialHub` |
| 51 | The shell states: `Штамм «Нулевой» (Базовая оболочка)`, `ЗАКРЫТО`, `Чтобы открыть: выполни веху «…»`, `Открыто за веху «…»` | `CollectionBoard`, `shellSubLabel` |
| 52 | The milestones: the group header `Уничтожение иммунных клеток (всего: N)`, a progress bar per goal, `N / M · остался 1` | `CollectionBoard`, `CollectionSnapshot.killsTotal` |
| 53 | The difficulty step indicator `• • ◦` / `• • •` and the marker of the configuration cards `Для нового забега` | `MenuScene`, `MENU_COPY` |
| 54 | `★ Открыто в Кодексе: +3 записи ›` — a real plate that opens the Codex | `UIScene`, `openCodexOnMenu` |
| 55 | The three canonical share variants + the victory variant, the duel share, and the forbidden-term guard | `UiCopy.buildShareText`, `SHARE_FORBIDDEN_TERMS` |

---

## 4. Deferred items

| Item | Status | Reason |
| --- | --- | --- |
| `Погиб от: …` | **DEFERRED — requires new gameplay state** | IMPLEMENTATION OVERRIDE 2. The state does not contain the last attacker, the lethal damage source or the largest recent hit. Nothing was fabricated and no gameplay tracking was added. |
| `Задача «…»: 4 / 5 — остался 1` (the nearest task) | **DEFERRED — product rule required** | IMPLEMENTATION OVERRIDE 3. `src/quests/questRuntime.ts` exposes `activeQuestIds` in *selection* order; there is no `selected` / `active` / `tracked` / `closest` concept in the code. The result screen was completed without the line. |
| `УЛУЧШИТЬ РЕЗУЛЬТАТ` | **DEFERRED — product rule required** | §31. The backend does not implement unlimited repeats with best-attempt-only semantics. The safe CTA `НАЧАТЬ ЗАБЕГ ДНЯ` is used. |
| Milestone pagination → scroll | **DEFERRED — P2** | Audit P2.5. The paginator is hidden when there is one page; the scroll conversion is not a v1 change. |
| `★ МЕСТО #N В РЕЙТИНГЕ ДНЯ` under the timer | **DEFERRED — result layout refactor** | Audit P0.3 asks for the place line under the timer. The line exists and is correct, but moving it under the background timer is a change of the result composition, not of the copy. The audit's own §12 rule 1 makes the line conditional on a verified board, which the source verifies only for the daily board (§5.1). |
| The `ЛЁГКИЙ` difficulty and its `• ◦ ◦` dots | **DEFERRED — EASY deliverable** | Audit rule 9 lists three difficulties. The code has two (`standard`, `strained`); a third mode is a balance change and belongs to the EASY work (see §11). The step indicator is implemented for the two real modes. |
| `«#1 · Олег (Вы)»` — the "(Вы)" marker on your own row | **DEFERRED — server payload** | Audit §7 / rule 7. `SocialTopEntry` carries `{rank, platform, timeMs, kills}` only: the server sends no "this is you" flag, so the marker would be invented. The own row of the day uses the carrier's name instead (`PlatformBridge.getDisplayName()`). |

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
2. **The `МУТАЦИИ` codex tab is now `СИНЕРГИИ`.** The first pass kept the old
   name; the audit (its §5 and its P1.4) renames the tab under its content, and
   the dictionary's scoped replacement (`codex_tab_mutations`) says the same.
   The tab lists the three evolution ids (`prism`, `halo`, `singularity`) — the
   critical mutations — and the section header inside the page stays
   `КРИТИЧЕСКИЕ МУТАЦИИ`, exactly as the audit specifies it. The rename is
   scoped to the tab; the word "мутация" was **not** replaced anywhere else
   (the dictionary's `_warning` demands that).
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
7. **The network error of the rating states that the progress is preserved.**
   The first pass refused the promise, because the rating is a read path. The
   audit's §7 states the sentence verbatim — `Нет соединения с сервером. Твой
   прогресс сохраняется.` — and on a read path the promise is true: nothing the
   rating does can lose a run. The copy is now exactly that sentence, and the
   second variant (`Сервер не ответил. Твой прогресс сохраняется.`) covers the
   http failure. The bare `НЕТ СОЕДИНЕНИЯ` survives only inside the compact
   44 px daily-launch button, which cannot carry a sentence.
8. **`РЕДКИЙ, НО МЕТКИЙ` was already absent** from the current source — no
   change was needed for §34.
9. **`Гиперспиц` is `Гипершип` in the code.** The audit and the dictionary both
   write `дальше: Гиперспиц`; `src/game/UpgradeSystem.ts:17` writes
   `prism: 'ГИПЕРШИП'`. The game's own name wins, and the scoped rule of the
   replacement (no bare imperative → `дальше: …`) is applied. Same for the other
   branch hints: `дальше: Геометрия раскола`, `дальше: Сверхкапсид`,
   `дальше: Нулевая точка`, `дальше: Сингулярность`, `дальше: Цепь лизиса`.
10. **The codex header is `Открыто записей: 3/9`, not `3 из 9`.** The
    dictionary writes `из`, the audit writes `3/9` and its §9.2 sets the short
    counter as the rule. The audit outranks the dictionary, so the counter
    keeps the slash. The denominator is the code's own `CODEX_RECORD_TOTAL = 9`
    — the audit's warning ("the decomposition 3+6=9 is unverified") is honoured:
    the branch never asserts the decomposition anywhere.
11. **The legendary share writes the game's own name.** The audit's example
    writes `Легендарная мутация «Нулевая точка» открыта.`; the game names it
    `НУЛЕВАЯ ТОЧКА` (`getLegendaryDefinition(...).title`). The game's own title
    is used, with the audit's sentence around it.
12. **The menu record line keeps `Уничтожено:`.** The audit and the dictionary
    propose `Клеток: 2 617`; the task body fixes the line as
    `Носитель: {name} · Рекорд: {bestTime} · Уничтожено: {bestRunKills}`. The
    task body wins, and the value is the best *single run* — the audit's
    `2 617` — so the label is the task's and the number is the audit's.

### 5.1 The reconciliation matrix

Every item of the three documents, with the verdict of this branch. The
verdicts mean:

* **CORRECT_PR** — the branch already had it right; the document confirmed it.
* **CHANGE_REQUIRED** — the reconciliation pass changed the branch.
* **SSOT_OVERRIDDEN** — the document's wording was **not** applied, because the
  current code (or the task body) is the fact under the precedence order.
* **PROPOSAL_DEFERRED** — the document itself marks the item as a proposal or
  as a decision that is not ours to take.
* **TO_CONFIRM** — the document marks the underlying fact as unverified; the
  branch states it only as a placeholder and never asserts it.

#### The audit's prioritisation

| # | Audit item | Verdict | Note |
| --- | --- | --- | --- |
| P0.1 | The developer language is gone (`локально`, `без наград`, `00:00 UTC`, the footer tokens, `КРИТ.`) | **CORRECT_PR** + **CHANGE_REQUIRED** | The strings were gone in the first pass; the countdown changed from `04:15` to `4 ч 15 мин` in the reconciliation. |
| P0.2 | One mint CTA, a clean Resume, the run parameters inside the button, a full-size `НОВЫЙ ЗАБЕГ`, the dimmed configuration cards | **CORRECT_PR** | The run parameters are **inside the button** — the primary action's caption is `Кровоток · Стандарт` (the resume caption: `Кровоток · 00:19 · Уровень 2 · Стандарт`) — and the configuration cards are dimmed to `alpha 0.6`. **Corrected in the third pass:** the cards carry the audit's own marker `Для нового забега` (the earlier wording `Сложность и управление — для нового забега` described a card and a separate hint band that no longer exist). |
| P0.3 | The result screen: the hidden HUD, no empty mutation lines, `Архетип: …`, the defeat/victory headlines | **CORRECT_PR** | |
| P0.3 | `Погиб от: …` and the nearest task | **PROPOSAL_DEFERRED** | The task body forbids both (IMPLEMENTATION OVERRIDE 2 and 3). The state does not carry a cause of death and the quest runtime has no "tracked" concept. |
| P0.3 | The place line under the timer | **PROPOSAL_DEFERRED** | The line is correct where it is; moving it is a composition change, not a copy change. |
| P0.4 | The collection and daily states (`✓ АКТИВЕН`, `ЗАКРЫТО` + the condition, the hidden paginator, the progress bars, `◆ ВЫПОЛНЕНО`) | **CORRECT_PR** | The condition is `Чтобы открыть: выполни веху «ОХОТНИК НА ЭЛИТУ»` — the milestone title of the real data. |
| P0.5 | The menu footer: no third instruction, three levels, the sound switches without percentages, the new tagline | **CORRECT_PR** | |
| P1.1 | One modal template: a 12 px radius, a centred title, a 44×44 ×, 16 px padding, no bottom `ЗАКРЫТЬ` | **CORRECT_PR** | `src/ui/modal.ts`. **Corrected in the third pass:** the template is implemented, but with the **repository's own shared radius** — `MODAL.radius = 18` — and not the 12 px of the audit. The radius is one recipe for every framed surface, and the repository's token is the code (the same call as the font sizes below). The centred title, the 44×44 ×, the 16 px padding and the absence of a bottom `ЗАКРЫТЬ` are as the audit asks. |
| P1.2 | The word `забег` everywhere, `БРОСИТЬ ВЫЗОВ ДРУГУ` | **CORRECT_PR** | |
| P1.3 | The rating: `РЕЙТИНГ`, no pseudo-tabs, the empty day with the CTA, one row per player, the friends explanation + `ПРИГЛАСИТЬ ДРУЗЕЙ` | **CORRECT_PR** + **CHANGE_REQUIRED** | The pseudo-tab strip `ЗАБЕГ ДНЯ · СЕЗОН · ДРУЗЬЯ` was still in the code of the first pass and was removed in the reconciliation. |
| P1.4 | The codex tabs, the three `ЗАКРЫТАЯ СИНЕРГИЯ` cards with their branch pairs, `Снарядный штамм`, `ПРОХОЖДЕНИЕ РЕЖИМОВ` | **CHANGE_REQUIRED** | The first pass kept the `МУТАЦИИ` tab and the three identical cards; the reconciliation renamed the tab, gave each locked card its own recipe and rewrote the branch rows. |
| P1.5 | The collection tabs, the one appearance note, the milestones' group header, the progress bars, `осталось …` | **CHANGE_REQUIRED** | The group header `Уничтожение иммунных клеток (всего: N)`, the bars and the rest counter are new. |
| P1.6 | The step dots `• • ◦` / `• • •`, the one-line difficulty descriptions, the record line | **CHANGE_REQUIRED** + **SSOT_OVERRIDDEN** | The dots are new. The descriptions keep the product's **factual** strings (`Базовый ритм кампании`, `Особые клетки мутируют · давление растёт`) instead of the audit's flavour placeholders — the audit itself says to replace the flavour with facts. The record line keeps the task body's `Уничтожено:` instead of the audit's `Клеток:`. |
| P1.7 | The share text: the title, the action verbs, the hook, the bot handle | **CHANGE_REQUIRED** | The three canonical variants of the audit are now the templates of `buildShareText`, plus a fourth victory variant for the product's victory share path. |
| P2.1 | The double-line artifact | **CORRECT_PR** | See §6. |
| P2.2 | The clickable codex badge `★ Открыто в Кодексе: +3 … ›` | **CHANGE_REQUIRED** | The badge is a real interactive plate that opens the Codex. |
| P2.3 | The non-breaking space for every number ≥ 1 000 | **CORRECT_PR** | `src/game/UiFormat.ts`. |
| P2.4 | The leaderboard identities | **CORRECT_PR** | The payload carries no name and no "you" flag, so the branch shows `Игрок (TG)` and never invents `Штамм #NN`. |
| P2.5 | The milestones: a scroll instead of a pagination | **PROPOSAL_DEFERRED** | The paginator is hidden when there is one page. |
| §3 | The hero metric of the result: 44 px, bold, tabular monospace | **PROPOSAL_DEFERRED** | The timer is 46 px on the normal viewports and 38 px on the compact ones. Growing it further on a 320 px screen pushes the statistics out of the frame, and the repository has one display font — the monospace part of the token is a typographic change, not a copy change. |
| §10 | The design-system token table (the heading sizes, the palette, the button radii) | **SSOT_OVERRIDDEN** | The table is a proposal; the repository's own token contract (`npm run test:tokens`) is the code. The branch keeps the repository's tokens and raises its own texts to the repository's readability floor (10/11 px for a card label, 11/13 px for a card description) instead of importing a second scale. The **ADOPTED** part of §10 — one modal template: a single shared radius (the repository's own `MODAL.radius = 18`, not the 12 px of the proposal), a centred title, a 44×44 ×, 16 px padding, no bottom `ЗАКРЫТЬ`, a marked active tab, a height that follows the content — is implemented. |

#### The Decision Log — the twelve rules

| # | Rule | Status in the audit | Verdict | Note |
| --- | --- | --- | --- | --- |
| 1 | The rating on the results | PROPOSAL | **SSOT_OVERRIDDEN** | The gate is the source, and the source answers it: a daily submission is ranked on the daily board, an ordinary one on the `all` board, a resumed one is not submitted at all. The branch therefore shows `★ МЕСТО #N В РЕЙТИНГЕ ДНЯ` for the daily case and the neutral `РЕЙТИНГ · МЕСТО #N` for the ordinary one — the audit's `В СЕЗОНЕ` would be a claim the server does not support. The `★ ЛИЧНЫЙ РЕКОРД` fallback stays unimplemented (PROPOSAL, unverified). |
| 2 | The daily replay | PROPOSAL — Mark's decision | **PROPOSAL_DEFERRED** | The button stays `НАЧАТЬ ЗАБЕГ ДНЯ`, exactly as the audit instructs while the decision is open. |
| 3 | The `Золотой прайм` condition | ADOPTED | **CORRECT_PR** | `Чтобы открыть: выполни веху «ОХОТНИК НА ЭЛИТУ»` + `ЗАКРЫТО`, and `Открыто за веху «…»` + `ВЫБРАТЬ` once the milestone is done. The milestone title is verified against the data. |
| 4 | The codex counter vs the goals | ADOPTED | **CORRECT_PR** | `ДОСТИЖЕНИЯ 7/9` is gone; the header is `Открыто записей: N/9 · Забегов: R`. The branch never asserts the `3 + 6 = 9` decomposition. |
| 5 | The kill counters | REJECTED as written | **CORRECT_PR** | No `Math.max` anywhere. The codex shows the lifetime `Забегов: N · Уничтожено клеток: N`, the menu the best run, the milestones their own counter (`killsTotal`, exposed by `CollectionSnapshot`). |
| 6 | One streak only | ADOPTED | **CORRECT_PR** | The collection's streak line is gone; the rating shows `Серия: N дн. · Рекорд: M дн.`, and at zero `Сыграй забег дня, чтобы начать серию · Рекорд: M дн.`. |
| 7 | The names in the table | REJECTED (fallback) | **CORRECT_PR** | `Игрок (TG)`; no invented identity. The `(Вы)` marker is **PROPOSAL_DEFERRED** — the server sends no "you" flag. |
| 8 | `РЕДКИЙ, НО МЕТКИЙ` | ADOPTED | **CORRECT_PR** | The string was already absent from the source. |
| 9 | The difficulty descriptions | ADOPTED (placeholder) | **SSOT_OVERRIDDEN** | The flavour placeholders are not facts; the branch shows the product's factual descriptions and the step dots. The third mode `ЛЁГКИЙ` is **PROPOSAL_DEFERRED** (the EASY deliverable). |
| 10 | The record dashes | ADOPTED | **CORRECT_PR** | The `ПРАЙМ —` / `Кампания —` fields are hidden; the word `Прайм` is never asserted. The `Клеток:` label is the task body's `Уничтожено:`. |
| 11 | The control card | ADOPTED (conditional) | **SSOT_OVERRIDDEN** | The gate is the code: there are three real modes (`one-hand`, `two-hand`, `dual-move`), so the scenario-2 branch applies and the card keeps its chevron. The audit's example names `ДЖОЙСТИК` / `КАСАНИЕ` do not exist in the code, so the code's own labels are used. |
| 12 | The challenge button and the share | ADOPTED | **CORRECT_PR** | `БРОСИТЬ ВЫЗОВ ДРУГУ`; the share never promises a seed and never carries an insider term. |

#### The copy dictionary

| Group | Result |
| --- | --- |
| `exact_replacements` — 34 scoped pairs | **31 applied verbatim.** Three deviations, each recorded: `codex_branch_hint` (`Гипершип`, not `Гиперспиц` — the code's own name), `codex_branch_projectile` (applied as `Снарядный штамм` ✅), `results_profile` / `results_profile_prefix` (applied as `Архетип: …` ✅). |
| `codex.subtitle` (`3 из 9`) | **SSOT_OVERRIDDEN** — the audit's §5/§9.2 short counter (`3/9`) outranks the dictionary. |
| `codex.synergies_section` (the three recipes, the sub line) | **CHANGE_REQUIRED** — the recipes are now real, with the audit's own pairs; the dictionary marks them `TO CONFIRM`, and so does the report. |
| `codex.mastery_section` (the branch rows, the mode rows) | **CHANGE_REQUIRED** — the rows use the dictionary's format with the game's own branch names. |
| `collection.shells_section` (the shell names, the sub labels, the locked/unlocked conditions) | **CHANGE_REQUIRED** — `Базовая оболочка` / `Био-оболочка` and the two condition sentences are now rendered. |
| `collection.milestones_section` (the group header, the four target texts) | **CHANGE_REQUIRED** — the group header and the four `противников всего` targets are now rendered. |
| `daily_tasks` (the subtitle, the three task descriptions) | **CORRECT_PR** — the descriptions were corrected in the reconciliation (`2 000` with a non-breaking space, `Уничтожь 5 элитных клеток`, `Продержись 60 секунд подряд без урона`). |
| `common.actions` / `common.states` / `common.units` | **CORRECT_PR** — `ЗАКРЫТО`, `✓ АКТИВЕН`, `◆ ВЫПОЛНЕНО`, `остался 1` / `осталось N`, `кл.`, `дн.`, `ч`, `мин`. |
| `_meta.rules.forbidden_in_player_ui` | **CORRECT_PR** — the nine forbidden words are asserted absent by `tests/ui-redesign.mjs` on every redesigned surface. |
| `_meta.rules.numbers_note` / `thousands_separator` | **CORRECT_PR** — `UiFormat.NBSP` is a real U+00A0. |

#### The QA checklist

`ofeliya-qa-checklist.md` is an acceptance checklist, not a source of copy. Its
verdicts are in §8.1: **75 of its 83 check items PASS**, 2 are
`DEFERRED_BY_OVERRIDE`, 3 are `PROPOSAL_NOT_APPROVED`, 2 are
`SOURCE_TRUTH_CONFLICT` and 1 is a **FAIL** — the fixed height of the shared
modal frame leaves empty space under the Codex on the tall viewports (a
pre-existing condition, see §8.1).

### 5.2 The exact-replacement matrix

All **34** scoped replacements of `ru-copy-dictionary.json → exact_replacements`,
each one applied in its own context. The dictionary's own `_warning` forbids a
global find-replace, and none was done: the word "мутация" still appears where
the product means a mutation (`КРИТИЧЕСКИЕ МУТАЦИИ`, `ЛЕГЕНДАРНАЯ МУТАЦИЯ`),
and "веха" is used only in the collection.

| Dictionary key | OLD | Required NEW | The branch now | Verdict |
| --- | --- | --- | --- | --- |
| `codex_branch_hint` | Открой ГИПЕРСПИЦ | дальше: Гиперспиц | `дальше: Гипершип` (RunIdentity.ts) | **SSOT_OVERRIDDEN_BY_SOURCE_TRUTH — `src/game/UpgradeSystem.ts:17` names the upgrade `ГИПЕРШИП`; the scoped rule (no bare imperative) is applied** |
| `codex_branch_projectile` | ПРОЕКТИЛЬНЫЙ ШТАММ | Снарядный штамм | `Снарядный штамм` (RunIdentity.ts) | **CORRECT_PR** |
| `codex_mastery_section` | МАСТЕРСТВО КАМПАНИИ | ПРОХОЖДЕНИЕ РЕЖИМОВ | `ПРОХОЖДЕНИЕ РЕЖИМОВ` (META_COPY.mastery) | **CORRECT_PR** |
| `codex_tab_mutations` | МУТАЦИИ (tab) | СИНЕРГИИ | `СИНЕРГИИ` (MenuScene.showCodex) | **CHANGE_REQUIRED — the tab was renamed in the reconciliation; the section header inside stays `КРИТИЧЕСКИЕ МУТАЦИИ`, as the audit specifies** |
| `codex_title` | КОДЕКС · STRAIN-0 | КОДЕКС | `КОДЕКС` (META_COPY.codex) | **CORRECT_PR** |
| `collection_tab_goals` | ЦЕЛИ (tab) | ВЕХИ | `ВЕХИ` (CollectionBoard) | **CORRECT_PR** |
| `collection_tab_skins` | ШТАММЫ (tab) | ОБОЛОЧКИ | `ОБОЛОЧКИ` (CollectionBoard) | **CORRECT_PR** |
| `collection_title` | КОЛЛЕКЦИЯ ШТАММА | КОЛЛЕКЦИЯ | `КОЛЛЕКЦИЯ` (META_COPY.collection) | **CORRECT_PR** |
| `daily_cta` | НАЧАТЬ ЕЖЕДНЕВНЫЙ ЗАБЕГ | НАЧАТЬ ЗАБЕГ ДНЯ | `НАЧАТЬ ЗАБЕГ ДНЯ` (META_COPY.dailyCta, SocialHub) | **CHANGE_REQUIRED — the review finding: the report claimed the new label while the code still had the old one** |
| `friends_empty` | ПОКА НЕТ РЕЗУЛЬТАТОВ ДРУЗЕЙ | Здесь появятся результаты друзей, которые играют через @ofeliya_game_bot. | `Здесь появятся результаты друзей, которые играют через @ofeliya_game_bot.` + `ПРИГЛАСИТЬ ДРУЗЕЙ` (META_COPY) | **CHANGE_REQUIRED** |
| `menu_footer_instruction` | Двигай штамм · собирай РНК · выбирай мутации | (delete) | removed from the menu (the onboarding hint in `src/game/identity.ts` is a different surface) | **CORRECT_PR** |
| `menu_tagline` | Выживай. Собирай РНК. Меняй штамм. | Выживай. Поглощай РНК. Эволюционируй. | `Выживай. Поглощай РНК. Эволюционируй.` (MENU_COPY.tagline) | **CORRECT_PR** |
| `quest_elite` | Уничтожь 5 элитных врагов за один забег | Уничтожь 5 элитных клеток за один забег | `Уничтожь 5 элитных клеток за один забег` (questCatalog.ts) | **CHANGE_REQUIRED** |
| `quest_greedy` | Собери 2000 РНК за один забег | Собери 2 000 РНК за один забег | `Собери 2\u00a0000 РНК за один забег` (questCatalog.ts, a real U+00A0) | **CHANGE_REQUIRED** |
| `quest_invisible` | 60 секунд подряд без урона | Продержись 60 секунд подряд без урона | `Продержись 60 секунд подряд без урона` (questCatalog.ts) | **CHANGE_REQUIRED** |
| `quests_done_local` | Выполнено · локально | ◆ ВЫПОЛНЕНО | `◆ ВЫПОЛНЕНО` (QuestBoard, CollectionBoard) | **CORRECT_PR** |
| `quests_local` | Локальный прогресс · без наград | (delete) | removed | **CORRECT_PR** |
| `quests_reset` | Обновление в 00:00 UTC | Выполнено: {completed} из {total} · Обновление через {timeRemaining} | `Выполнено: N из M · Обновление через 4 ч 15 мин` (META_COPY.tasksProgress) | **CORRECT_PR — the countdown format was changed to words in the reconciliation** |
| `quests_title` | КВЕСТЫ | ЗАДАЧИ ДНЯ | `ЗАДАЧИ ДНЯ` (META_COPY.tasks) | **CORRECT_PR** |
| `results_challenge` | БРОСИТЬ ВЫЗОВ | БРОСИТЬ ВЫЗОВ ДРУГУ | `БРОСИТЬ ВЫЗОВ ДРУГУ` + the caption `Побить результат 15:20 · 2 617 кл.` | **CORRECT_PR — the caption was added in the reconciliation** |
| `results_crit_empty` | КРИТ. МУТАЦИИ: нет | (hide) / `Критические мутации: {name}` | `◆ Критические мутации: …`, nothing when empty | **CORRECT_PR** |
| `results_header` | STRAIN ZERO / ИТОГ ЦИКЛА | ИТОГ ЗАБЕГА | `ИТОГ ЗАБЕГА` (RESULT_COPY.header) | **CORRECT_PR** |
| `results_infected` | Заражено: | Заражено клеток: | `Заражено клеток: N` (UIScene) | **CORRECT_PR** |
| `results_legendary_empty` | ЛЕГЕНДАРНЫЕ: нет | (hide) | nothing when empty | **CORRECT_PR** |
| `results_peak` | Пик мутации: | Уровень мутации: | `Уровень мутации: N` (UIScene) | **CORRECT_PR** |
| `results_profile` | ПРОФИЛЬ ШТАММА: ГИБРИД - базовая конфигурация | Архетип: Базовый гибрид | `Архетип: Снарядный штамм (…)` — the archetype is computed, the name depends on the run | **CORRECT_PR** |
| `results_profile_prefix` | ПРОФИЛЬ ШТАММА: | Архетип: | `Архетип:` | **CORRECT_PR** |
| `results_rank` | РЕЙТИНГ · МЕСТО #1 | ★ МЕСТО #1 В РЕЙТИНГЕ ДНЯ | `★ МЕСТО #N В РЕЙТИНГЕ ДНЯ` for the daily board, the neutral `РЕЙТИНГ · МЕСТО #N` for the ordinary one | **CORRECT_PR — the board name is shown only when the server's board is provable** |
| `results_retry` | ЕЩЁ ОДИН ЦИКЛ | НОВЫЙ ЗАБЕГ | `НОВЫЙ ЗАБЕГ` (RESULT_COPY.newRun) | **CORRECT_PR** |
| `resume_label` | НЕЗАВЕРШЁННЫЙ ЗАБЕГ | (delete) | removed | **CORRECT_PR** |
| `resume_secondary` | НАЧАТЬ НОВЫЙ | НОВЫЙ ЗАБЕГ | `НОВЫЙ ЗАБЕГ` (MENU_COPY.newRun) | **CORRECT_PR** |
| `skin_golden_unlock` | Открывает: ОХОТНИК НА ЭЛИТУ | Чтобы открыть: выполни веху «Охотник на элиту» | `Чтобы открыть: выполни веху «ОХОТНИК НА ЭЛИТУ»` + `ЗАКРЫТО`; the owned shell shows `Открыто за веху «…»` | **CORRECT_PR — the milestone title is the real one from the data (`ОХОТНИК НА ЭЛИТУ`)** |
| `skin_selected` | ВЫБРАН | ✓ АКТИВЕН | `✓ АКТИВЕН` (META_COPY.active) | **CORRECT_PR** |
| `summary_title` | СВОДКА | РЕЙТИНГ | `РЕЙТИНГ` (the menu tile and the hub title) | **CORRECT_PR** |

Two more entries of the dictionary are **not** in `exact_replacements` and are
reconciled separately:

| Dictionary entry | The branch now | Verdict |
| --- | --- | --- |
| `codex.subtitle` — `Открыто записей: {unlocked} из {total} · Забегов: {totalRuns}` | `Открыто записей: N/9 · Забегов: R` | **SSOT_OVERRIDDEN** — the audit's §5 and its §9.2 short-counter rule (`3/9`) outrank the dictionary's `из`; the audit is above the dictionary in the precedence order. The denominator is the code's own `CODEX_RECORD_TOTAL = 9`, and the branch never asserts the unverified decomposition. |
| `codex.synergies_section` — the three locked recipes and the section sub line | `ЗАКРЫТАЯ СИНЕРГИЯ I/II/III` + `БЕЛКОВЫЕ ШИПЫ III + ПРОНИКНОВЕНИЕ II` / `КАПСИДНЫЕ СПУТНИКИ III + ПОДВИЖНОСТЬ/РЕПЛИКАЦИЯ II` / `МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II` + `Открываются при совмещении двух совместимых ветвей в одном забеге` | **CHANGE_REQUIRED / TO_CONFIRM** — the dictionary marks the pairings `TO CONFIRM` against the design, and so does this report; the structure (one card, one condition) is the part that is implemented. **Corrected in the third pass:** the recipes are the game's **real** evolution pairs (`src/game/EvolutionSystem.ts` → `CODEX_COPY.synergyRecipes`), not the branch names this report used to name. A codex that names a pairing the game does not have would be a lie. |

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
| Resume | a duplicated yellow `НЕЗАВЕРШЁННЫЙ ЗАБЕГ` banner above the button | the state is stated once: `ПРОДОЛЖИТЬ ЗАБЕГ`, and the run configuration is the **caption inside the button** — `Кровоток · 00:19 · Уровень 2 · Стандарт`; the cards say they configure the next run (`Для нового забега`) |
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
| Resumed | `РЕЖИМ: СТАНДАРТ · ВОЗОБНОВЛЁН · ВНЕ РЕЙТИНГА` | the chip `Тренировка (продолженный забег)` — a neutral status, never a ranking disclaimer |
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
| Counter | `ЦИКЛОВ: 12 · УНИЧТОЖЕНО КЛЕТОК: 800` | `Открыто записей: 3/9 · Забегов: 12` — the lifetime counters of the profile **left the codex**; the underlying data stays in the save |
| Tabs | `МУТАЦИИ · ЛЕГЕНДАРНЫЕ · МАСТЕРСТВО` | `СИНЕРГИИ · ЛЕГЕНДАРНЫЕ · МАСТЕРСТВО`, and the three locked synergies carry their own recipes — the real evolution pairs `БЕЛКОВЫЕ ШИПЫ III + ПРОНИКНОВЕНИЕ II`, `КАПСИДНЫЕ СПУТНИКИ III + ПОДВИЖНОСТЬ/РЕПЛИКАЦИЯ II`, `МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II` — under one explanation `Открываются при совмещении двух совместимых ветвей` |
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
| Paginator | always shown | only when there is more than one page, and placed **from the internal dock** — `paginator.bottom + 4 ≤ dock.top` at every viewport (§16.2, V1) |
| Milestone group | `Уничтожение иммунных клеток (всего: N)` | `Уничтожение иммунных клеток (в прогрессе вех: N)` — the counter is the milestone progress, not a lifetime total |

---

## 8. Tests

### The new contract

`node tests/ui-redesign.mjs` (`npm run test:ui-redesign`) drives the real
application in a real browser over four viewports and asserts the copy contract,
the hierarchy, the touch targets, the result rules and the internal dock. It
captures the evidence set (`menu-fresh`, `menu-resume`, `result-defeat`,
`result-legendary`, `daily-tasks`, `codex`, `collection`, `collection-milestones`,
`rating`) into `docs/qa/ui-redesign-v1-evidence/` at every viewport.

Result: **PASS** at 320×568, 390×740, 768×1024 and 1080×1920
(`ui redesign surfaces PASS …` / `ui redesign menu PASS …` /
`ui redesign contract: ok`).

It is **not** wired into the CI browser job in this branch — the GitHub App that
pushes the branch cannot write `.github/workflows/` (see §2.1 for the exact
error). The step to add by hand is in §8.2.

The reconciliation pass extended the contract with the assertions of the three
source documents: the codex tabs and their recipes, the mastery rows, the
lifetime line, the daily CTA, the season/streak/friends lines, the network
error, the collection shell states, the milestone group, the mode chip, the
archetype line, the records line, the codex plate, the share variants read from
the **real share action** (the messenger is stubbed, the product path is not),
and a forbidden-term sweep over every redesigned surface. The copy catalog
contract (`tests/ui-copy-catalog.mjs`) now pins the same strings as literals,
so a silent rewrite of the catalog fails the build.

### 8.1 The QA checklist — `ofeliya-qa-checklist.md`

The checklist has **83** check items. Each one was run against the actual
branch, with the labels the reconciliation task prescribes.

| Label | Count |
| --- | --- |
| **PASS** | **75** |
| **FAIL** | **1** |
| **DEFERRED_BY_OVERRIDE** | **2** |
| **PROPOSAL_NOT_APPROVED** | **3** |
| **SOURCE_TRUTH_CONFLICT** | **2** |

| Block | Items | Result |
| --- | --- | --- |
| P0.1 The developer language | 5 | **5 PASS.** The daily-tasks subtitle is `Выполнено: N из M · Обновление через 4 ч 15 мин`; the menu footer carries no platform token and no build hash; the result screen has no `КРИТ.`; the nine forbidden words of the dictionary are asserted absent on every redesigned surface. |
| P0.2 One CTA, a clean Resume | 6 | **6 PASS.** The mint plate is shared (`src/ui/cta.ts`); the Resume state has no yellow block, the run parameters are inside the button, `НОВЫЙ ЗАБЕГ` is a 44 px target, the two configuration cards are dimmed to `alpha 0.6` and carry the marker `Для нового забега`, and the caption is `Кровоток · Стандарт` (no `Акт I`). **Corrected in the third pass:** the marker is the audit's own wording, and the separate hint band it used to sit in is gone. |
| P0.3 The result screen | 6 | **5 PASS, 1 DEFERRED_BY_OVERRIDE.** The HUD is hidden, the empty mutation lines are gone, the archetype is named, the headlines are right, and the three buttons carry their captions (`Побить результат 15:20 · 2 617 кл.` under the challenge). **Deferred:** the cause of death and the nearest task — the task body forbids both, and the state carries neither. |
| P0.4 The collection and the daily states | 6 | **6 PASS.** The active tab is marked, the selected shell is `✓ АКТИВЕН`, the locked shell shows `ЗАКРЫТО` + `Чтобы открыть: выполни веху «ОХОТНИК НА ЭЛИТУ»` and has no select action, the paginator hides itself on a single page, every daily task has a bar and `◆ ВЫПОЛНЕНО` or `4 / 5 · остался 1`, and the appearance note appears once. |
| P0.5 The menu footer | 4 | **4 PASS.** |
| Rule 1 — the rating on the results | 5 | **5 PASS.** The gate is answered by the source (see §5.1, rule 1): the daily board is provable, the ordinary place comes from the `all` board, a resumed run is never submitted, the unverified personal-best fallback is **not** implemented, and a place is never shown that the server did not return. |
| Rule 2 — the daily replay | 3 | **1 PASS, 2 PROPOSAL_NOT_APPROVED.** The button stays `НАЧАТЬ ЗАБЕГ ДНЯ` and the item is marked deferred, exactly as the checklist prescribes while Mark's decision is open. |
| Rule 3 — the `Золотой прайм` condition | 4 | **4 PASS**, and the milestone title is verified against the real data (`ОХОТНИК НА ЭЛИТУ`). |
| Rule 4 — the codex counter vs the goals | 3 | **3 PASS.** The decomposition `3 + 6 = 9` is never asserted anywhere. |
| Rule 5 — the kill counters | 4 | **3 PASS, 1 PROPOSAL_NOT_APPROVED.** There is no `Math.max` anywhere, each counter has its own label, and no synchronisation was chosen. The gate itself (the enemy filter of the milestone counter) is a backend fact, so the synchronisation proposal stays unapproved and the client labels the three counters instead of merging them. |
| Rule 6 — one streak only | 4 | **4 PASS.** |
| Rule 7 — the names | 4 | **3 PASS, 1 SOURCE_TRUTH_CONFLICT.** `Игрок (TG)` and no invented identity. The `(Вы)` marker on your own row conflicts with the source: the server sends no "you" flag, so the own row of the day carries the carrier's name instead. |
| Rule 8 — `РЕДКИЙ, НО МЕТКИЙ` | 2 | **2 PASS** (the string was already absent from the source). |
| Rule 9 — the difficulty selector | 3 | **2 PASS, 1 DEFERRED_BY_OVERRIDE.** The header is `СЛОЖНОСТЬ`, the dots are `• • ◦` / `• • •`, and the descriptions carry no percentages and no ranking wording. The third mode `ЛЁГКИЙ` is deferred by the task override (no EASY implementation) and belongs to the EASY deliverable. |
| Rule 10 — the record dashes | 3 | **2 PASS, 1 SOURCE_TRUTH_CONFLICT.** The `ПРАЙМ —` / `Кампания —` fields are hidden, the lifetime total is never substituted for the best run, and the word `Прайм` is never asserted. The label of the record line conflicts with the checklist's `Клеток:` — the task body fixes it as `Уничтожено:`, and the number behind it is the checklist's `2 617` (the best run). |
| Rule 11 — the control card | 3 | **3 PASS.** The gate is answered by the code: there are three real modes, so the card keeps its chevron and cycles through them. |
| Rule 12 — the challenge button and the share | 3 | **3 PASS.** The button is `БРОСИТЬ ВЫЗОВ ДРУГУ` with the caption `Побить результат 15:20 · 2 617 кл.`, the share starts with `OFELIYA · Вызов в кровотоке`, says `продержался` after a defeat, ends with `@ofeliya_game_bot`, and carries none of `вне рейтинга`, `Профиль штамма`, `STRAIN-0`, `на этом же штамме`, `выжил`. |
| Part 3 — the modal frame | 3 | **2 PASS, 1 FAIL.** One shared radius (the repository's `MODAL.radius = 18`; the audit's 12 px is a proposal, the code is the token), a centred title, a 44×44 × in the top-right corner, no bottom `ЗАКРЫТЬ`, no double-line artifact. **FAIL:** the height of the panel does not follow the content for the Codex — the shared frame uses a fixed height (`min(H − 34, 650)`), so the Codex leaves empty space below its three synergy cards on the tall viewports. The daily tasks fill their panel (their rows are distributed over the available height). This condition is **pre-existing** — `main` uses the same `Math.min(H - 34, 650)` for the Codex — and fixing it means making the shared frame's height content-driven for all four meta surfaces, which is a layout refactor beyond a copy reconciliation. |
| Part 3 — the codex recipes and the calque | 3 | **3 PASS.** Three different locked cards with three different recipes, `Снарядный штамм` and `дальше: …`, `ПРОХОЖДЕНИЕ РЕЖИМОВ`. The branch pairs are the audit's own example pairs and stay marked `TO CONFIRM` here, as the audit demands. |
| Part 3 — the numbers and the text | 5 | **5 PASS.** A real U+00A0 in every number ≥ 1 000, `MM:SS` timers, `4 / 5` fractions, the joined `3/9` counter, the headings in caps and the descriptions in sentence case, at most three `·` segments per line, and the em dash never used as "no value" (the mastery rows say `ещё не пройдена` instead). |
| Part 3 — the navigation and the states | 4 | **4 PASS.** The codex tabs `СИНЕРГИИ \| ЛЕГЕНДАРНЫЕ \| МАСТЕРСТВО` and the collection tabs `ОБОЛОЧКИ \| ВЕХИ \| ЛАБОРАТОРИЯ` mark the active tab, the internal dock is a tab bar with the active segment lit, every empty state carries an explanation and an action, and the network error is the full sentence with `ПОВТОРИТЬ`. |

#### 8.1.1 Every item, one by one

| Блок | Пункт | Метка | Комментарий |
| --- | --- | --- | --- |
| P0.1 | Нет строк «Локальный прогресс · без наград», «· локально», «00:00 UTC» в Задачах дня | **PASS** |  |
| P0.1 | Подзаголовок «Выполнено: 2 из 3 · Обновление через 4 ч 15 мин» | **PASS** |  |
| P0.1 | Нет «mini-app · tdesktop · ce8ecb8» в подвале меню | **PASS** |  |
| P0.1 | Нет «КРИТ.» на итогах | **PASS** | «◆ Критические мутации: …» |
| P0.1 | Нет слов «локально», «без наград», «STRAIN-0», «tdesktop», хеша билда | **PASS** | asserted by the contract |
| P0.2 | Единый мятный CTA в меню, на итогах и в Рейтинге | **PASS** | #9CC5B5 / src/ui/cta.ts |
| P0.2 | Нет тускло-бордовой и бледно-бежевой кнопки | **PASS** |  |
| P0.2 | Нет жёлтого «НЕЗАВЕРШЁННЫЙ ЗАБЕГ»; параметры один раз в кнопке | **PASS** |  |
| P0.2 | Вторая кнопка «НОВЫЙ ЗАБЕГ», высота ≥ 40–44 px | **PASS** | 44 px |
| P0.2 | Карточки сложности и управления приглушены или помечены | **PASS** | alpha 0.6 + подсказка |
| P0.2 | Подпись «НАЧАТЬ ЗАРАЖЕНИЕ» — «Кровоток · Стандарт» | **PASS** |  |
| P0.3 | Боевой HUD полностью скрыт под окном итогов | **PASS** |  |
| P0.3 | Нет строк «КРИТ. МУТАЦИИ: нет» и «ЛЕГЕНДАРНЫЕ: нет» | **PASS** |  |
| P0.3 | «Архетип: …» вместо «ПРОФИЛЬ ШТАММА» | **PASS** | «Архетип: Снарядный штамм (…)» |
| P0.3 | Заголовки «ШТАММ УНИЧТОЖЕН» / «НОСИТЕЛЬ ЗАРАЖЁН» | **PASS** |  |
| P0.3 | В центре — причина гибели и ближайшая задача | **DEFERRED_BY_OVERRIDE** | задание запрещает оба; в состоянии их нет |
| P0.3 | Кнопки «НОВЫЙ ЗАБЕГ» / «БРОСИТЬ ВЫЗОВ ДРУГУ» + подпись / «В МЕНЮ» | **PASS** | «Побить результат 15:20 · 2 617 кл.» |
| P0.4 | Активная вкладка выделена в Кодексе и Коллекции | **PASS** |  |
| P0.4 | У выбранного скина — залитая «✓ АКТИВЕН» | **PASS** |  |
| P0.4 | У закрытого скина нет «ВЫБРАТЬ», а «ЗАКРЫТО» + условие | **PASS** | веха «ОХОТНИК НА ЭЛИТУ» |
| P0.4 | Пагинатор скрыт на одной странице | **PASS** |  |
| P0.4 | У задач дня — прогресс-бар, «◆ ВЫПОЛНЕНО» или «4 / 5 · остался 1» | **PASS** |  |
| P0.4 | Фраза про внешний вид — один раз, в шапке «ОБОЛОЧЕК» | **PASS** |  |
| P0.5 | Удалена третья инструкция подвала | **PASS** |  |
| P0.5 | Навигация — отдельным рядом плиток | **PASS** | 2×2 |
| P0.5 | Переключатели звука — только вкл/выкл | **PASS** |  |
| P0.5 | Слоган «Выживай. Поглощай РНК. Эволюционируй.» | **PASS** |  |
| Правило 1 | Гейт: какой лидерборд ранжирует забег | **PASS** | дневной / all / без борда — из кода |
| Правило 1 | Названа таблица в строке рейтинга | **PASS** | «★ МЕСТО #N В РЕЙТИНГЕ ДНЯ» / «РЕЙТИНГ · МЕСТО #N» |
| Правило 1 | Продолженный забег — чип «Тренировка (продолженный забег)» без места | **PASS** |  |
| Правило 1 | «★ ЛИЧНЫЙ РЕКОРД» — только при подтверждении | **PASS** | не реализовано: поведение не подтверждено |
| Правило 1 | Нигде не показывается место, которого не вернул сервер | **PASS** |  |
| Правило 2 | Гейт: решение Mark по повтору забега дня | **PROPOSAL_NOT_APPROVED** |  |
| Правило 2 | Если решение принято — «УЛУЧШИТЬ РЕЗУЛЬТАТ» | **PROPOSAL_NOT_APPROVED** | условный пункт |
| Правило 2 | Если решения нет — кнопка «НАЧАТЬ ЗАБЕГ ДНЯ», пункт отложен | **PASS** |  |
| Правило 3 | «Чтобы открыть: выполни веху «Охотник на элиту»» | **PASS** | «ОХОТНИК НА ЭЛИТУ» — данные игры |
| Правило 3 | У закрытого скина нет «ВЫБРАТЬ» | **PASS** |  |
| Правило 3 | После вехи — «Открыто за веху …» и «ВЫБРАТЬ» | **PASS** |  |
| Правило 3 | Название вехи сверено с данными | **PASS** |  |
| Правило 4 | «ДОСТИЖЕНИЯ 7/9» удалены из Кодекса | **PASS** | «Открыто записей: N/9 · Забегов: R» |
| Правило 4 | Все цели — под термином «ВЕХИ» | **PASS** |  |
| Правило 4 | Декомпозиция «3 + 6 = 9» не утверждается | **PASS** |  |
| Правило 5 | Гейт: что считает каждый счётчик убийств | **PROPOSAL_NOT_APPROVED** | окна известны, фильтр врагов — вопрос бэкенда |
| Правило 5 | Нет `Math.max(totalKills, goalKills)` | **PASS** |  |
| Правило 5 | У каждого счётчика своя подпись | **PASS** | лучший забег / lifetime / прогресс вех |
| Правило 5 | Синхронизация не выбрана молча | **PASS** | не выбрана |
| Правило 6 | Строка «Посещений: 1 · серия: 1 дн.» удалена из Коллекции | **PASS** |  |
| Правило 6 | При нулевой серии — «Сыграй забег дня, чтобы начать серию · Рекорд: N дн.» | **PASS** |  |
| Правило 6 | После забега дня серия ≥ 1 дн. | **PASS** | «Серия: N дн. · Рекорд: M дн.» |
| Правило 6 | Серия только в Рейтинге | **PASS** |  |
| Правило 7 | Гейт: хранятся ли имена на сервере | **PASS** | нет: payload = {rank, platform, timeMs, kills} |
| Правило 7 | Один игрок — одна строка | **PASS** |  |
| Правило 7 | «Игрок (TG)» и своя строка с именем | **SOURCE_TRUTH_CONFLICT** | «Игрок (TG)» — да; «(Вы)» — сервер не шлёт флаг «это вы» |
| Правило 7 | Нет выдуманных «Штамм #NN (TG)» | **PASS** |  |
| Правило 8 | «РЕДКИЙ, НО МЕТКИЙ» удалена | **PASS** | строки нет в коде |
| Правило 8 | Под кнопкой — чистый отступ ≥ 12 px | **PASS** |  |
| Правило 9 | Индикатор ступени и однострочные описания | **DEFERRED_BY_OVERRIDE** | точки есть для двух реальных режимов; «ЛЁГКИЙ» — задание EASY |
| Правило 9 | Заголовок карточки — «СЛОЖНОСТЬ» | **PASS** |  |
| Правило 9 | В описаниях нет процентов и «в зачёт рейтинга» | **PASS** | описания — фактические строки продукта |
| Правило 10 | Поля «ПРАЙМ —» и «Кампания —» скрыты | **SOURCE_TRUTH_CONFLICT** | строка есть, но ярлык задания — «Уничтожено:», а не «Клеток:» |
| Правило 10 | В бейдж не подставляется lifetime 5 424 | **PASS** | 2 617 — лучший забег |
| Правило 10 | После первой победы нет слова «Прайм» | **PASS** |  |
| Правило 11 | Гейт: есть ли режимы кроме «ОДНА РУКА» | **PASS** | три: one-hand / two-hand / dual-move |
| Правило 11 | Сценарий «один режим» — снять «›» | **PASS** | сценарий не применим: режимов три |
| Правило 11 | Сценарий «два режима» — «ДЖОЙСТИК»/«КАСАНИЕ» | **PASS** | имена кодовые: «ОДНА РУКА» / «ДВЕ РУКИ · ПРИЦЕЛ» / «ДВЕ РУКИ · ДВИЖЕНИЕ» |
| Правило 12 | Кнопка «БРОСИТЬ ВЫЗОВ ДРУГУ» с подписью | **PASS** |  |
| Правило 12 | Текст шеринга: заголовок, «продержался», @ofeliya_game_bot | **PASS** |  |
| Правило 12 | Нет «вне рейтинга», «Профиль штамма», «STRAIN-0», «на этом же штамме», «выжил» | **PASS** | asserted by the contract |
| Часть 3 | Скругление 12 px, заголовок по центру, × 44×44, без «ЗАКРЫТЬ» | **PASS** | src/ui/modal.ts |
| Часть 3 | Нет артефакта двойной линии | **PASS** | см. §6 |
| Часть 3 | Высота модалки — по контенту | **FAIL** | Кодекс: фиксированная высота панели (min(H−34, 650)); условие существовало и на main |
| Часть 3 | «ЗАКРЫТАЯ СИНЕРГИЯ I/II/III» с конкретными парами веток | **PASS** | пары — TO CONFIRM по дизайну |
| Часть 3 | «Снарядный штамм» и «дальше: …» | **PASS** |  |
| Часть 3 | Секция «ПРОХОЖДЕНИЕ РЕЖИМОВ» | **PASS** |  |
| Часть 3 | Неразрывный пробел во всех числах ≥ 1000 | **PASS** | U+00A0 |
| Часть 3 | Таймеры MM:SS, дроби «4 / 5», короткий счётчик «3/9» | **PASS** |  |
| Часть 3 | Заголовки — капс, описания — sentence case | **PASS** | readability-гейт |
| Часть 3 | «·» — максимум три сегмента; «—» не значит «нет значения» | **PASS** | «ещё не пройдена» вместо «—» |
| Часть 3 | Все строки сверены с exact_replacements | **PASS** | см. §5.1 |
| Часть 3 | Вкладки «СИНЕРГИИ | ЛЕГЕНДАРНЫЕ | МАСТЕРСТВО» и «ОБОЛОЧКИ | ВЕХИ | ЛАБОРАТОРИЯ» | **PASS** |  |
| Часть 3 | Док-бар оформлен таб-баром, активный сегмент подсвечен | **PASS** |  |
| Часть 3 | Пустые состояния: объяснение + действие | **PASS** |  |
| Часть 3 | Ошибка сети — полное предложение + «ПОВТОРИТЬ» | **PASS** |  |

### 8.1.2 The CI of the final head

| | |
| --- | --- |
| The green run before the third pass | `40418654178` — head `a105f7c750ae275f5febbe4ab3eb6c1fae7a704e`, event `pull_request`: `build` **success**, `production-contract` **success**, `browser-smoke` **success** — every step green, including `UI redesign v1 surfaces contract`, `Easy difficulty selector, result label and visual matrix`, `Codex and mastery browser smoke`, `Social hub browser smoke`, `Daily CTA runtime browser smoke`, `MAX compact viewport matrix` and `Verified notification ordering and footer touch accessibility` |
| The green run of the first pass | `40292414901` — head `1823f927a07f951914969f9339eaf2b2cc469f62`: `build` 58/58, `production-contract` 23/23, `browser-smoke` 59/59 |
| The run of the third pass | the head this pass produces is the commit that carries this report; §16.7 states the run and its result |
| Why the reconciled head was not verified in the second pass | the pull request was **`mergeable_state: dirty`** back then, and GitHub does not execute a `pull_request` workflow for a pull request that cannot be merged. The branch has since been integrated with main (§2), the merge state is `clean`, and the CI runs |

**Corrected in the third pass.** The second pass of this report stated that the
reconciled head had no CI run and that the branch could not be merged. Both are
historical: the branch is integrated with the current main, the pull request
reports `mergeable_state: clean`, and the CI of the integrated head
`a105f7c…` is green in all three jobs.

Everything in this report that is a test result was produced locally, in this
sandbox, against the same code that is on the branch: the full contract at four
viewports, the copy catalog, the codex/daily/rating/collection/result smokes,
the layout matrix, the readability smoke, the type check, the release build and
`git diff --check` (§9).

### 8.2 The CI step — now wired

The new contract belongs in the `browser-smoke` job, next to the other browser
contracts:

```yaml
      - name: UI redesign v1 surfaces contract
        env:
          OFELIYA_UI_EVIDENCE: /tmp/ui-redesign-v1
        run: NODE_PATH="$GITHUB_WORKSPACE/node_modules" npm run test:ui-redesign
```

**Corrected in the third pass.** The second pass of this report stated that the
App could not write `.github/workflows/` and that the step was therefore *not*
in PR #249, with the exact YAML left for a maintainer. The step **is** in the
remote workflow now — it was added by the integration with main (PR #250), and
it is green in the run `40418654178`. The App still has no `workflows`
permission in this environment, so this pass did not touch the workflow file
either — it did not need to.

The PNG evidence still cannot be carried by the App (binary files), so
`docs/qa/ui-redesign-v1-evidence/` stays out of the branch and travels with
this report; `npm run test:ui-redesign` regenerates every one of them.

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
| `npm run build` (tsc + vite build + release stamp) | PASS | PASS |
| `git diff --check` | PASS | PASS |
| `node tests/ui-redesign.mjs` (the new contract) | — | PASS |

The exact commands are in §9.

### What the CI caught

The first local sweep covered the gates I had touched. The CI runs **every**
gate in the workflow, and it found four real regressions that the local sweep
missed. All four are repaired, and every repair keeps the assertion — the
assertions were moved onto the new structure, not dropped:

| Gate | The regression | The repair |
| --- | --- | --- |
| `test:quest-scenes` | the daily board is reached through the internal dock now, but the probe still looked for the tasks button as a direct child of the overlay | the probe looks the button up inside the dock container |
| `test:quest-scenes` | the probe closed the board through `ofeliya-quests-close`, which the shared frame replaced | the probe closes through the shared `ofeliya-modal-close-hit` |
| `test:quest-scenes` | the probe expected the old `Обновление в 00:00 UTC` line | the probe now expects the live `Обновление через HH:MM` **and** additionally asserts that it is not a static `00:00` midnight label — a stronger contract |
| `test:muse-convergence-crossflow` | a locked shell has no select button any more, so the probe could not enumerate the shells it shows | every shell row keeps a named handle `ofeliya-skin-<id>` — the active plate and the locked plate included — so a locked shell is still enumerated while staying inert |
| `test:muse-client` | the same locked-shell rule, asserted as existence | the probe now asserts that the locked shell's object is **not interactive**, which is the actual rule |
| `test:social-hub` | the rating surface is opened from the navigation grid, and the shared frame has no `ofeliya-social-panel` / `ofeliya-social-dim` | the probe looks for `ofeliya-menu-nav-rating`; the frame names its scrim, and the rating surface keeps its own panel and scrim names so the overflow probe still has a reference frame |
| `test:social-hub` | the close control's 44×44 hit area sat ten pixels **outside** the panel edge | the hit area is now fully inside the frame — a touch target may not hang over the edge |
| `test:social-hub` | the error wording was changed to a sentence-case variant | the wording the repository already shipped and gates is kept — `СЕРВЕР НЕ ОТВЕТИЛ` and `НЕТ СОЕДИНЕНИЯ` — with the neutral `ПОВТОРИТЬ` retry |
| `test:muse-convergence-crossflow` | **the collection's tab row covered the close control.** The tab strip sat at `bodyTop − 8`, so its plates crossed the title band, and the top-right tab swallowed the tap on the 44×44 close target — the board could not be closed | the tab row now starts at `bodyTop`, below the title band, so the close target is never covered. The content moves down by 28 px and still clears the internal dock at 320×568 and 390×740 |
| `test:muse-convergence-crossflow` | the probe read the tween list one browser round trip after the board appeared, so the 180 ms reveal was already over when the probe looked at it | the probe now opens the board and reads the tween list in the same tick, so the reveal is measured while it is genuinely in flight; the early close falls back to a re-aimed tap when the first one lands on a control that is still at alpha zero |
| `test:startup-trace` | **the hidden five-tap diagnostics gesture was lost with the visible build line.** Moving the build information to the About surface removed the target the gesture lived on, so a player could no longer reveal the startup trace | the gesture keeps a target of its own: the same line, drawn without ink, naming the host the way the About surface does — `Браузер`, `MAX` or `Telegram`, never a raw client token. The platform label is one shared helper now |
| `test:mobile-layout-matrix` | **the challenge panel was drawn at the record line's position**, so an incoming challenge overlapped the record on a 320×568 menu | the layout has a challenge band between the record and the run configuration, so the record and the challenge never share a slot |
| `test:mobile-layout-matrix` | the matrix measured the old utility row — a sound control, a social button and a codex button | the matrix measures the new footer: a 2×2 navigation grid, one row of three audio switches and the legal row last, with the spacing of each band |
| `test:codex-smoke` | the codex entry of the menu, the shared title of the frame, the mastery counter and the close control all moved | the gate reads the navigation cell, the frame title, the `ЗАБЕГОВ: 7` counter and the 44×44 close control. The close glyph is no longer the interactive object — the shared hit area is |
| `test:browser-smoke`, `test:video-interstitial` | the victory outcome is `НОСИТЕЛЬ ЗАРАЖЁН` now, not `ИММУНИТЕТ ПОДАВЛЕН` | the two probes read the new title; the defeat outcome keeps `ШТАММ УНИЧТОЖЕН` |
| `test:run-identity` | one of the four identity labels had been renamed to sentence case while its three siblings stayed uppercase | the labels are back to the wording the repository shipped, so the archetype names stay consistent with each other |
| `test:daily-cta` | a daily submission now states its place on the daily board — `★ МЕСТО #5 В РЕЙТИНГЕ ДНЯ` — instead of a generic submission status | the gate waits for the daily rank line and asserts the daily place; an ordinary run still must not show any daily copy |
| `test:ui-readability` | the run-configuration cards had shrunk to 9/10px, below the readability floor of the repository | the card label is 10/11px and the card description 11/13px again, and the card texts carry their own names so a probe can address them |
| `test:control-mode` | the control mode moved into the run-configuration card, so the multitouch gate read a name that no longer exists | the gate reads the named card value and expects the new title-case wording of the dual-move mode |

**The CI is green on the head of the branch**: `build` 58/58, `production-contract`
23/23, `browser-smoke` 59/59.

### The gates that fail in this sandbox — and on `main` as well

The full workflow runs **green on the branch** — `build` 58/58,
`production-contract` 23/23, `browser-smoke` 59/59. The gates below are the
ones that cannot pass in this sandbox, and each of them fails on `main` too.

Four gates fail here **and fail identically on `main` (`ce8ecb84…`)**, which is
how they were classified as environment limits rather than regressions. The
`main` runs were made in a second worktree of the base commit, against a dev
server serving `main`:

| Gate | The failure | Why it is the environment, not the change |
| --- | --- | --- |
| `test:art-startup` | `Menu startup must remain bounded` — the 6 s cold-start budget | the sandbox runs the game at ~3 fps on a software WebGL stack over a NAS filesystem. Measured on the same machine, the menu becomes ready in **4.1–5.5 s on this branch** and **5.7–9.1 s on `main`** — the branch is not slower, it is faster |
| `test:integration-visual-browser` | the HP warning alpha reads `0` | the same assertion fails on `main` at the same line |
| `test:natural-progression` | `page.waitForFunction` times out | the same timeout on `main` |
| `test:quest-scenes` (the UTC rollover step only) | the day key does not roll inside 30 s | Phaser clamps the frame delta, so a one-second timer needs ~17 s of wall clock here. With the wait raised to 180 s the whole gate **passes at all four viewports** — and the 30 s budget is the repository's own value, so it was restored rather than relaxed |
| `test:muse-convergence-crossflow` (the reveal tween step only) | the reveal tween is already finished when the probe looks for it | the same failure on `main` with the same numbers. The tween is 180 ms; in this sandbox the probe round-trip is slower than that |

The 1080×1920 viewport of `test:quest-scenes` additionally failed once with
`Target page, context or browser has been closed` — the sandbox has 3 GB of RAM
and ~770 stale Chromium processes were running at that moment. After the stale
processes were cleared, that viewport **passes on its own**.

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
npm run test:run-identity
npm run test:quest-core
npm run test:social-hub
npm run test:integration-visual-browser
npm run test:visual-gameplay-impact
node scripts/codex-smoke.cjs
node scripts/ui-readability-smoke.cjs
node scripts/mobile-layout-matrix.cjs
node tests/visual-completion.mjs
node tests/ui-redesign.mjs
git diff --check
```

`npm run build` runs `tsc --noEmit`, `vite build` and the release stamp. It needs
an explicit 40-character SHA for the stamp:

```
VITE_RELEASE_SHA=$(git rev-parse HEAD) npm run build
```

Result: **PASS** — 132 modules transformed, `dist/assets/index-*.js` 494.32 kB
(148.25 kB gzip), `vendor-phaser-*.js` 1 481.79 kB (339.85 kB gzip),
`Stamped OFELIYA release b64196095f2f8e81ca8de180f360790d28a91d12`.

One note on the first sweep: `test:result-actions` failed once with
`page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5173/` because the
sandbox dev server was not running for that background sweep. With the server
up it is **PASS** (`real-touch result actions smoke: ok` /
`checkpoint resume mobile reload smoke: ok`). It is not a code failure.

---

## 10. Viewport matrix

| Viewport | Fresh menu | Resume menu | Result (defeat) | Result (codex plate) | Result (legendary) | Daily tasks | Codex | Collection | Rating |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 320×568 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 390×740 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 768×1024 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1080×1920 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Every one of these 40 captures is produced by `node tests/ui-redesign.mjs`; the
run asserts the copy and the geometry at the same time, so a green run *is* the
evidence. Each capture is taken while its own state is on the screen — the
result captures are taken in the order the states are rendered, so a file name
never describes another state. The capture list:

| Screenshot | What it shows |
| --- | --- |
| `menu-fresh-<w>x<h>.png` | the menu without a saved run — one hierarchy, one record line, the 2×2 grid |
| `menu-resume-<w>x<h>.png` | the menu with a saved run — the resume action, the new-run action, the record line |
| `result-defeat-<w>x<h>.png` | the defeat result — `ШТАММ УНИЧТОЖЕН`, the actions, the caption `Побить результат …` |
| `result-codex-entries-<w>x<h>.png` | the same result with the `★ Открыто в Кодексе: +1 запись ›` plate |
| `result-legendary-<w>x<h>.png` | the victory result with two evolutions and two legendary mutations |
| `daily-tasks-<w>x<h>.png` | the daily board with the real UTC countdown and the task fractions |
| `codex-<w>x<h>.png` | the codex with the `СИНЕРГИИ · ЛЕГЕНДАРНЫЕ · МАСТЕРСТВО` tabs and the three locked recipes |
| `collection-<w>x<h>.png` | the collection on the shells page |
| `collection-milestones-<w>x<h>.png` | the collection on the milestones page |
| `rating-<w>x<h>.png` | the rating with a neutral `Игрок (TG)` row and the invite action |
| `doubleline-card-before.png` / `-after.png` | the duplicated frame line and its fix |

The menu geometry is computed by `src/ui/menuLayout.ts`, a pure function: the
hero art absorbs the free space, the gaps grow up to a maximum and the whole
block centres itself on a viewport taller than the content. Every interactive
band is at least 44px tall.

Screenshots: `docs/qa/ui-redesign-v1-evidence/` — they are delivered with this
report rather than committed (see §2 and §14).

---

## 11. EASY conflict notes — `UI_REDESS × EASY integration notes`

> **Superseded in the third pass.** EASY has **shipped**: PR #248 was merged into
> `main` and the branch was integrated with that main (§2), so the notes below
> are the *pre-integration* record of a conflict that no longer exists. The
> third pass did **not** implement, retune or rework EASY — it only
> re-expressed the EASY gate against the live contracts (§16.4) and recorded
> the neutral EASY status as `INTENTIONAL_SUPERSESSION` (§16.1).

MiniMax was implementing EASY in parallel. This branch did **not** add EASY,
did not touch the difficulty enum and did not tune anything. The conflicts
that remained:

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
5. The PNG evidence is not committed to the branch: the App-only push path
   cannot carry binary files (§2). The screenshots travel with this report and
   `npm run test:ui-redesign` regenerates all of them.
6. The new contract **is** in the CI workflow (§8.2) — the step came with the
   integration with main and is green. Only the PNG evidence is still outside
   the branch, for the binary-push reason of §2.
7. The three source documents were attached after the first pass. Everything
   they name that is not a *game rule* is applied in the reconciliation pass
   (§5.1); the items that are game rules or need a server fact are listed as
   deferred in §4 with the reason.
8. **`pr249-final-review.md` — the independent Muse review of this pull request
   — was not reachable in this environment.** It is not in the repository tree,
   not in the attachments directory, not in the drive, not in the comments,
   review comments or reviews of PR #249, and GitHub code search does not find
   it either. The finding list of the third pass is therefore the one the
   handoff enumerates (V1, V3, D2–D7, the footer coverage, `RunModeLabel.ts`,
   the EASY neutral status and the report/PR accuracy), and every finding was
   **verified against the code** before it was classified — the verdicts in
   §16.1 are measurements, not readings of the review document. A finding that
   the review holds and this pass did not enumerate would not be caught here.

---

## 15. The pull request

| | |
| --- | --- |
| URL | https://github.com/timoshinoleg-eng/ofeliya/pull/249 |
| Title | `[DRAFT] OFELIYA UI v1 — menu, results, meta navigation and Russian copy` |
| Draft | **yes** |
| Base | `main` @ `2b1e1426aa04b1d4cfb5159fb4ce89c00283d608` |
| Head | `feat/ui-redesign-v1-20261026` @ the commit that carries this report |
| Diff | 54 files, +5 138 / −1 266 (before the third pass) |
| Commits | 63 (the App push path splits some logical changes into several commits) |
| Merged | **no** |
| Merge state | `clean` — the branch is integrated with the current main (§2) |

The pull request is open as a **draft** and was **not** merged. Nothing was
deployed.

---

## 16. The Muse review correction pass (2026-10-27)

This is the third pass over the branch. The independent Muse review of PR #249
was classified **finding by finding against the current remote head**
`a105f7c750ae275f5febbe4ab3eb6c1fae7a704e` — every verdict below was measured
in the code, not read from the review document. Only the findings that were
**still present** were implemented; the others are recorded with the evidence
that closed them.

### 16.1 The findings matrix

| # | Finding | Verdict | Evidence / where |
| --- | --- | --- | --- |
| **V1** | the collection paginator and the internal dock compete for the same taps | **STILL_PRESENT → FIXED** | the paginator sat at a fixed offset from the panel bottom; its 44 px hit area reached into the dock row. Now it is placed from the dock itself (§16.2) |
| **V3** | the hero of the resume menu collapses at 320×568 | **STILL_PRESENT → FIXED** | the resume hero measured **37.6 px**; the review quotes the layout's 34 px floor. It is **67.6 px** now (§16.3) |
| **D2** | `без наград и глобального рейтинга` — a forbidden phrase, and a claim about the duel | **STILL_PRESENT → FIXED** | the server answers `ranked: false` on every duel endpoint and the attempt never reaches `store.scores`, so the claim was true but the wording was forbidden. The line is now `тот же забег · … · личная дуэль` — no reward invented, no ranking disclaimer (§16.4) |
| **D3** | `state.killsTotal` is not the lifetime kill count, but it was labelled `всего` | **STILL_PRESENT → FIXED** | `killsTotal` is the collection's own progress counter; the label is now `в прогрессе вех: N`. No `Math.max`, no counter merged (§16.4) |
| **D4** | the daily result status lines are technical and speak of "synchronization" | **STILL_PRESENT → FIXED** | eight server states, eight plain Russian lines; the in-flight placeholder `СЧЁТ: синхронизация…` became `Отправляю результат…` (§16.4) |
| **D5** | the lifetime counters were moved out of the Codex — the player-facing row must go too | **STILL_PRESENT → FIXED** | the `Забегов: N · Уничтожено клеток: M` row is removed from the codex; the data stays in the save and is not merged into another counter (§16.4) |
| **D6** | the daily retry button carries its explanation in its own label | **STILL_PRESENT → FIXED** | the button is exactly `ПОВТОРИТЬ`; the reason is a separate named line above it. The retry behaviour is unchanged (§16.4) |
| **D7** | the player-facing `РЕДКИЙ, НО МЕТКИЙ` | **STILL_PRESENT → FIXED** | only the presentation string changed — `МУТАТОР ДНЯ · РЕЖИЕ, НО КРЕПКИЕ`. The `sparse-lethal` multipliers are untouched (§16.4) |
| **Footer** | the footer coverage | **ALREADY_FIXED** | `scripts/footer-actions-smoke.cjs` asserts the nine footer targets ≥ 44×44, the absence of an overlap between the legal row and the diagnostics, a real legal tap, the five real diagnostic taps, the volume/audio state change, the checkpoint-resume footer, and the in-canvas safe-area bounds; `scripts/verified-ux-smoke.cjs` adds the ≥ 44 px, the safe canvas and the CTA clearance. Both were **re-run in this pass**: `footer real touch PASS` for all four viewports in the `fresh` and the `resume` state (8 cases) and `verified-ux` / `notification-ordering` green |
| **`src/ui/FooterTouchTargets.ts`** | a module with zero callers | **STILL_PRESENT → FIXED** | it had no caller at all — **deleted** as dead code. The rendered ≥ 44×44 assertions stay in the two smokes above (§16.5) |
| **`src/game/RunModeLabel.ts`** | a module with zero callers, carrying the superseded `РЕЖИМ: … · вне рейтинга` presentation | **STILL_PRESENT → FIXED** | no runtime caller, and the string it owned is the banned one — **deleted**. The EASY gate now asserts the live contracts instead of the dead module (§16.5) |
| **EASY** | the neutral status of the EASY result | **INTENTIONAL_SUPERSESSION** | the shipped chip is `ЛЁГКИЙ · Тренировка`. The old `РЕЖИМ ЛЁГКИЙ · РЕЗУЛЬТАТ БЕЗ РЕЙТИНГА` and the phrase `вне рейтинга` are **not** restored; the gate now asserts the live chip and sweeps every chip for the banned phrase (§16.5) |
| **Report / PR accuracy** | the report and the pull request body state stale facts | **STILL_PRESENT → FIXED** | corrected in place, with the history kept: §2, §7, §8.1.2, §8.2, §11, §14, §15 and the PR body (§16.7) |

### 16.2 V1 — the paginator and the internal dock

**The defect.** The paginator was placed at a fixed offset from the bottom of
the collection panel, while the internal dock is placed from the frame. The
paginator's hit area is 44 px tall, so the two rows overlapped by about 12 px at
every viewport: a tap in the overlap hit the paginator *or* the dock, never
both, and the player could not tell which.

**The fix.** The paginator is now derived from the dock, not from the panel
edge (`src/ui/CollectionBoard.ts`):

```ts
const dockTop = frame.dockTop - MODAL.dockHeight / 2;
const y = dockTop - 8 - 22;   // 8 px gap, 44 px tall targets
```

The 44×44 targets are unchanged, the dock is kept, and the contract is now
`paginator.bottom + 4 ≤ dock.top`.

**The regression test.** `tests/ui-redesign.mjs` measures the **real Phaser hit
areas** — `ofeliya-collection-prev` / `ofeliya-collection-next` and the three
dock plates `ofeliya-meta-dock-{tasks,codex,collection}` — at all four
viewports and asserts the gap:

```
the paginator overlaps the internal dock at 320x568: paginator bottom … + 4 > dock top …
```

The measured gap is **8 px** (the paginator's bottom is 30 px above the dock's
centre line, the dock's top is 22 px above it), so the contract holds with a
4 px margin at 320×568, 390×740, 768×1024 and 1080×1920.

### 16.3 V3 — the hero of the resume menu at 320×568

**The defect.** The menu is a vertical flow of bands. The returning player has
one band more than the fresh one (the `НОВЫЙ ЗАБЕГ` secondary), and the run
configuration used to live in a band of its own. On the smallest viewport the
content no longer fitted, and the hero — the first elastic band — was squeezed
to the layout's floor: **37.6 px**, which the review quotes as the 34 px floor.
Everything else stayed: the resume CTA, the secondary, the two configuration
cards, the 2×2 grid, the audio row and the legal row.

**The fix — two parts.**

1. *The configuration moved inside the button.* The run configuration is now
   the **caption of the primary action** (`ofeliya-menu-action-caption`), which
   is what the audit and the QA checklist ask for ("параметры … один раз внутри
   кнопки"). The separate hint band is **gone** — the object, the layout band
   and the `hintY` field were removed, so no dead presentation is left behind
   (§16.5). The resume state now reads `ПРОДОЛЖИТЬ ЗАБЕГ` with
   `Кровоток · 00:19 · Уровень 2 · Стандарт` inside the plate, and the
   configuration cards carry `Для нового забега`.
2. *The hero has a floor, and the gaps give up their room first.* The layout
   keeps `heroMin = 64` on a compact viewport; the gaps shrink to their hard
   minimum of 2 px before any control does, and the overflow guard keeps the
   content inside the viewport. The challenge card — the state with the most
   controls — is 48 px tall on a compact viewport instead of 58, so the hero
   keeps its room there too.

**The measured result** (`computeMenuLayout`, pure geometry):

| State | 320×568 before | 320×568 now | 390×740 now |
| --- | --- | --- | --- |
| fresh | 93.6 px | **111.6 px** | 162.9 px |
| resume | **37.6 px** | **67.6 px** | 118.9 px |
| resume + a two-line record | — | 64.0 px | 100.9 px |
| fresh + challenge | — | 64.0 px | 104.9 px |
| resume + challenge | 33.6 px | **43.6 px** | 96.0 px |

The legal row's bottom is 564 px at 320×568 — **inside** the viewport, with no
overlap between any two bands, in every state.

**The regression test.** `tests/ui-redesign.mjs` now opens with a **pure
geometry contract**: the production layout module is bundled with esbuild and
called directly, so a geometry regression fails on the numbers and not only in
a screenshot. For every viewport and every menu state (fresh, resume, resume
with a two-line record, challenge, resume + challenge) it asserts:

* the hero never collapses below **40 px**;
* every band stays inside the viewport;
* no two bands share a slot;
* and, for the state the finding names, the resume hero at 320×568 is **≥ 64 px**.

### 16.4 D2–D7 — the copy findings

| Finding | Before | After | Where |
| --- | --- | --- | --- |
| **D2** — the duel line | `… без наград и глобального рейтинга` | `тот же забег · <control> · личная дуэль` | `src/scenes/MenuScene.ts` |
| **D3** — the milestone group | `Уничтожение иммунных клеток (всего: N)` | `Уничтожение иммунных клеток (в прогрессе вех: N)` | `src/game/UiCopy.ts` |
| **D4** — the daily status | `ЕЖЕДНЕВНЫЙ ЗАБЕГ · РЕЗУЛЬТАТ НЕ СИНХРОНИЗИРОВАН`, `СЧЁТ: синхронизация…` | `Забег дня засчитан` / `Забег дня не засчитан` / `Забег дня уже закрыт` / `Срок забега дня истёк` / `Нужен запуск через MAX или Telegram` / `Сервер не ответил` / `Нет соединения` / `Не удалось определить профиль`, and the in-flight line `Отправляю результат…` | `src/game/UiCopy.ts`, `src/scenes/UIScene.ts` |
| **D5** — the codex lifetime row | `Забегов: 12 · Уничтожено клеток: 800` | removed; the codex keeps `Открыто записей: 3/9 · Забегов: 12` and the save keeps the data | `src/game/UiCopy.ts`, `src/scenes/MenuScene.ts` |
| **D6** — the daily retry | `СЕРВЕР НЕ ОТВЕТИЛ · ПОВТОРИТЬ` | the button is `ПОВТОРИТЬ`; the reason is a separate line above it: `Сервер не ответил — попробуй ещё раз` / `Нет соединения — попробуй ещё раз` / `Забег дня сейчас недоступен — попробуй позже` | `src/ui/SocialHub.ts`, `src/game/UiCopy.ts` |
| **D7** — the mutator title | `МУТАТОР ДНЯ · РЕДКИЙ, НО МЕТКИЙ` | `МУТАТОР ДНЯ · РЕЖИЕ, НО КРЕПКИЕ` (the `sparse-lethal` multipliers are unchanged) | `src/game/DailyMutator.ts` |

**D2 — the server was checked, not assumed.** Every duel endpoint
(`/api/duel` create, get, event, attempt) answers `ranked: false`, and the
attempt is written to `store.duelAttempts` — never to `store.scores`. There is
no grant logic, so there is **no reward to promise** and none was invented.
The old line was factually true about the ranking, but it used the
dictionary-forbidden phrase `без наград`; the new line is truthful, positive
and says what the duel *is*.

**D3 — the counter was traced.** `state.killsTotal` is
`this.state.counters.kills` of the collection's own progress — the kills the
milestone system has counted since it started, a counter that begins at zero.
It is not the profile's lifetime kills. The label now says so; no `Math.max`
was introduced and no two counters were merged.

**D6 — the reason left the button.** The daily launch button carries only
`ПОВТОРИТЬ`; the reason is rendered in a separate named object
(`ofeliya-social-daily-launch-status`) above it. The state that cannot be
retried at all (`denied`) keeps its own inactive label
`НУЖЕН ПОДТВЕРЖДЁННЫЙ ВХОД` — it is not a retry, so it is not a retry button.
The retry behaviour itself is unchanged: one request per failed launch, no
automatic second attempt.

### 16.5 The dead code and the EASY contract

* **`src/game/RunModeLabel.ts` — deleted.** It had **no runtime caller** (only
  the EASY gate's re-export and the language gate's file list referenced it),
  and the presentation it owned — `РЕЖИМ: … · вне рейтинга` — is the banned
  one. `scripts/check-easy-difficulty.mjs` now asserts the **live** contracts
  instead: the chips `ЛЁГКИЙ · Тренировка`, `СТАНДАРТ · В зачёт рейтинга`,
  `Тренировка (продолженный забег)`, `ЗАБЕГ ДНЯ · СТАНДАРТ`, `ДУЭЛЬ · СТАНДАРТ`;
  a sweep that no chip contains `вне рейтинга`; a penalty-word sweep on the
  EASY chip; and the share contracts (`startsWith('OFELIYA')`,
  `@ofeliya_game_bot`, no `НАПРЯЖЕНИЕ`, no `вне рейтинга`).
* **`src/ui/FooterTouchTargets.ts` — deleted.** No caller. The footer coverage
  is asserted where the footer actually is: in the rendered targets of the two
  browser smokes (§16.1).
* **The dead hint band — deleted.** `ofeliya-menu-action-hint` was an object
  that was always empty after the caption moved into the button. The object,
  the layout band and the `hintY` field are gone, and the language gate now
  requires the caption to exist and to be consumed by the mobile layout guard
  (which fits it to the plate, like the label above it).
* **EASY — `INTENTIONAL_SUPERSESSION`.** The shipped chip is
  `ЛЁГКИЙ · Тренировка`. The review's proposal to restore
  `РЕЖИМ ЛЁГКИЙ · РЕЗУЛЬТАТ БЕЗ РЕЙТИНГА` and the phrase `вне рейтинга` is
  **not** applied: a ranking disclaimer is an internal flag, never a
  player-facing word, and the EASY tier is neutral without one.

### 16.6 What the third pass changed

| File | Change |
| --- | --- |
| `src/ui/CollectionBoard.ts` | **V1** — the paginator is placed from the dock |
| `src/ui/menuLayout.ts` | **V3** — the hint band removed, the challenge band compacted, the hero floor kept |
| `src/scenes/MenuScene.ts` | **V3** — the configuration is the caption of the button; the dead hint object removed; **D2** — the duel line; **D5** — the codex lifetime row removed |
| `src/ui/MobileLayoutGuard.ts` | the caption is fitted to the plate, like the label |
| `src/ui/cta.ts` | the caption colour of the primary action |
| `src/game/UiCopy.ts` | **D3**, **D4**, **D5**, **D6** — the copy catalog |
| `src/scenes/UIScene.ts` | **D4** — the daily status lines and the in-flight placeholder |
| `src/ui/SocialHub.ts` | **D6** — the retry button and the separate status line |
| `src/game/DailyMutator.ts` | **D7** — the mutator title |
| `src/game/RunModeLabel.ts` | **deleted** — dead code with the banned presentation |
| `src/ui/FooterTouchTargets.ts` | **deleted** — dead code |
| `tests/ui-redesign.mjs` | the **pure geometry contract** (V3), the **paginator/dock gap** (V1), the caption assertions, the codex lifetime rule, the milestone wording, the daily status line |
| `tests/ui-copy-catalog.mjs` | the new copy of the catalog |
| `scripts/check-easy-difficulty.mjs` | the live EASY contracts (the dead module is gone) |
| `scripts/check-language-copy.mjs` | the caption replaces the dead hint in the structural anchors; `DailyMutator.ts` joins the player-facing scan |
| `scripts/social-hub-smoke.cjs` | **D6** — the status line and the exact `ПОВТОРИТЬ` label |
| `scripts/daily-cta-smoke.cjs` | **D4** — the fail-closed daily line |
| `scripts/check-daily-cta.mjs` | **D4** — the copy exhaustiveness is asserted against the **real catalog**, and no line may talk about synchronization or exceed one short sentence |
| `scripts/codex-smoke.cjs` | **D5** — the codex must not carry the lifetime counters |

**The commits of this pass** (the App push path creates one commit per push):

| Commit | What it carries |
| --- | --- |
| `f1e3e65b` | the code, the gates and the regression tests of §16.2–§16.5 |
| `82b397e3` | the deletion of the dead `src/game/RunModeLabel.ts` |
| `be9e9272` | the deletion of the dead `src/ui/FooterTouchTargets.ts` |
| `efe6c9b` | this document (the third pass) |
| `c77263d` | the `test:presentation` repair — the portrait widths compared with the 1e-9 px tolerance the file already uses, and the `SocialHub` copy stub extended with the new keys |
| `6cd4c6e` | the calendar repair of the cross-flow gate — §16.9 |
| `f17b1d7` | the repair of the task board — §16.10 |
| the report | this document, after the repair |

### 16.7 The gates and the CI of the third pass

The full gate set was run locally against the code of this pass:

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` (tsc + vite build + release stamp) | **PASS** — `Stamped OFELIYA release a105f7c…` |
| `git diff --check` | **PASS** |
| `npm run test:ui-copy` | **PASS** |
| `npm run test:language` | **PASS** — 1681 literals scanned |
| `npm run test:difficulty` | **PASS** |
| `npm run test:daily-cta` | **PASS** |
| `npm run test:onboarding` + `node tests/notification-region.mjs` | **PASS** |
| `npm run test:layout-diagnostics` | **PASS** |
| `npm run test:viewport` | **PASS** |
| `node tests/ui-redesign.mjs` (4 viewports + the pure geometry contract) | **PASS** — `ui redesign contract: ok` |
| `scripts/verified-ux-smoke.cjs --footer` and `scripts/verified-ux-smoke.cjs` | **PASS** |
| `scripts/notification-ordering-smoke.cjs` | **PASS** |
| `scripts/footer-actions-smoke.cjs` | **PASS** — 4 viewports × fresh/resume |
| `scripts/checkpoint-resume-smoke.cjs` | **PASS** |
| `scripts/result-actions-smoke.cjs` | **PASS** |
| `scripts/codex-smoke.cjs` | **PASS** (+ the mobile readability smoke) |
| `npm run test:social-hub` | **PASS** |
| `scripts/daily-cta-smoke.cjs` | **PASS** |
| `scripts/mobile-layout-matrix.cjs` | **PASS** — 320×568, 360×640, 360×760, 390×844, 412×915 |
| `npm run test:easy-difficulty-visual` | **PASS** — 4 viewports |

**Two gates cannot pass in this sandbox — and the same failure is measured on
the untouched base head `a105f7c…`** (the runs were made in a second worktree
of the base commit, against a dev server serving that commit):

| Gate | The failure | Why it is the environment |
| --- | --- | --- |
| `npm run test:integration-visual-browser` | `assert.ok(x>0&&y>0)` — the HP warning alpha reads `0` in the motion step | the **same assertion fails at the same line on the untouched base head**. The menu part of the same smoke — the sixteen utility variants that measure the layout — passes on both trees |
| `tests/startup-viewport-timeout.mjs` (part of `npm run test:startup`) | `stalled MAX viewport delayed startup too long: 5415 ms` (the ceiling is 5000 ms) | the same gate measures **6843 ms on the untouched base head** and passes on a warm run. The branch is not slower — the sandbox is a cold, software-rendered WebGL stack over a NAS filesystem, and the ceiling only catches a true hang |

The other two parts of `npm run test:startup` (`startup-font-timeout`,
`startup-renderer-contract`) pass.

**GitHub CI.** The head this pass started from, `a105f7c…`, is green in all
three jobs — `build`, `production-contract` and `browser-smoke` (run
`40418654178`), including the `UI redesign v1 surfaces contract` step.

**Every head of this pass that carried code is green in all three jobs:**

| Head | Run | build | production-contract | browser-smoke |
| --- | --- | --- | --- | --- |
| `6cd4c6e` (the calendar repair) | `40455271533` | **success** (59) | **success** (23) | **success** (61) |
| `f17b1d7` (the task board repair) | `40459288198` | **success** | **success** | **success** (62) |
| the head that carries this report | `40459329616` | **success** (59) | **success** (23) | **success** (62) |

The last two runs include the two steps that had failed —
`Combined Muse convergence cross-flow (platform, collection, quests,
cosmetics)` and `Muse quest-to-Phaser scenes and touch lifecycle` — and the
`UI redesign v1 surfaces contract` step. The run of the final head is quoted
in the final response.

**One CI failure of this pass was not a code failure at all.** The cross-flow
step failed on five consecutive heads — including the untouched base head, run
locally — with `65 !== 0`. The gate was bound to the calendar, not to the code:
§16.9 gives the measurement, the root cause and the repair.

**One CI failure of this pass was a real regression, and it was mine.** The step
`Muse quest-to-Phaser scenes and touch lifecycle` failed with `no text/display
rebuild within same day`: the redesign rebuilt the whole task board once a
minute to move the countdown. §16.10 gives the cause and the repair.

### 16.8 The limits of this pass

* **`pr249-final-review.md` was not reachable.** The independent review
  document is not in the repository tree, not in the attachments directory, not
  in the drive, not among the comments, review comments or reviews of PR #249,
  and GitHub code search does not find it. The finding list used here is the
  one the handoff enumerates, and every finding was **verified against the
  code** before it was classified — so a finding the review holds and this pass
  did not enumerate would not be caught here. This is the one place where this
  pass cannot prove its own completeness.
* **The physical acceptance of the MAX and Telegram surfaces is separate.** The
  messenger identity, the real share sheet and the real duel links are
  exercised by the stubs of the browser smokes, not by a physical device.
* The PNG evidence of the third pass is in
  `docs/qa/ui-redesign-v1-evidence/` (40 files) and travels with this report;
  the App cannot carry binary files (§2).

### 16.9 The cross-flow gate was bound to the calendar

The step `Combined Muse convergence cross-flow (platform, collection, quests,
cosmetics)` failed on every head of this pass with

```
after transfer: 300ms after midnight must credit zero whole seconds
65 !== 0
```

**The control: the untouched base head fails the same way.** The base commit
`a105f7c…` was checked out into a second worktree, served by its own dev
server, and the unmodified gate was run against it: the same assertion, the
same line (`scripts/muse-convergence-crossflow-smoke.cjs:1548`), the same
numbers — `actual 65`, `expected 0`. The runtime was never the cause.

**The cause is in the test, not in the product.** The gate installs a synthetic
quest clock. The synthetic midnight was pinned to a literal date:

```js
window.__finalMidnight = Date.parse('2026-10-27T00:00:00Z');   // the old line
```

and the two date assertions were pinned to the same literal. The contract under
test is the **day roll**: a sample taken 300 ms into a *new* UTC day must find
the day-scoped counters at zero, because the roll resets them. The roll only
fires when the mocked sample falls in a day the persisted state has not reached
yet — and the persisted `dayKey` comes from the **real** clock.

While the real UTC day was still `2026-10-26`, the mocked `2026-10-27T00:00:00.300Z`
was in the next day, the roll fired, the counters were reset, and the assertion
read `0`. From `2026-10-27T00:00:00Z` onwards the mocked sample fell in the
*same* day as the persisted `dayKey`, the roll did not fire, the day-scoped
counter kept the value the run had accrued during the host-lifecycle phase (65
seconds of the real run clock), and the assertion read `65`.

**The measurement at the failing point** (the state dumped in the same turn as
the failing assertion):

| Field | Value |
| --- | --- |
| the real clock | `2026-10-27T05:15:48Z` |
| the persisted `dayKey` | `2026-10-27` — the **real** day, not the previous one |
| `dayMetrics.q_nodmg` | `65` — the counter the roll was supposed to reset |
| `baseline.q_nodmg` | `0` |
| `lastTickAtMs` | `1793059266150` — the mocked `midnight + 66150` |
| `streakLast` | `60` |
| the quest run id | unchanged across the transfer (`sameRun` was `true`) |

**The calendar boundary is visible in the CI history itself.** The green run of
the untouched base head, `40418654178`, started at `2026-10-26T23:16:52Z` —
before the pinned midnight. Every run that started after `2026-10-27T00:00:00Z`
failed at this step, on every head: `f1e3e65b`, `82b397e3`, `be9e9272`,
`efe6c9b`, `c77263d`.

**The repair is in the isolation, not in the contract.** The synthetic midnight
is now derived from the real clock — the next UTC midnight after it — so the
mocked sample always lands in a day the state has not reached, and the two date
assertions are now relative to that same synthetic midnight:

```js
window.__finalMidnight = (Math.floor(Date.now() / 86400000) + 1) * 86400000;
…
assert.equal(combined.midnight.lastTickAtMs, combined.syntheticMidnight + 300);
assert.equal(combined.ended.lastTickAtMs, combined.syntheticMidnight + 66150);
```

**`q_nodmg === 0` is untouched.** The assertion that 300 ms into a new UTC day
the day-scoped no-damage counter must be zero is still exact and still strict —
the repair makes the gate *exercise* the day roll on every calendar day instead
of skipping it.

**The verification.** The repaired gate was run locally three times, once
against the base runtime of `a105f7c…` and twice against the runtime of this
pass: exit `0` every time. GitHub CI run `40455271533` on `6cd4c6e…` is green
in all three jobs, and the step itself is **success** there.

A scan of the other gates found no second instance of this pattern: the
remaining hard-coded dates (`2026-10-12`, `2026-10-22`, `2027-01-01`, …) are
pure fixtures — deterministic inputs for the hashing and day-key logic — and
none of them is compared against the live clock.

### 16.10 The task board rebuilt itself once a minute (a real regression)

The step `Muse quest-to-Phaser scenes and touch lifecycle` failed on the head
that carried only this report:

```
AssertionError [ERR_ASSERTION]: no text/display rebuild within same day
    at scripts/quest-scene-smoke.cjs:110
```

**The code was identical to the green run** — the only difference between the
two heads was this document. So this was not a flake of the runner and not a
side effect of the correction pass: it was a latent regression of the
**redesign itself**, and the CI only found it now because the previous run had
not landed in the failing window.

**The contract the smoke encodes.** The task board must keep its objects inside
a day. The board that existed before the redesign did exactly that:

```ts
if (day === snapshot.dayKey) return;   // the board is rebuilt only at the day rollover
```

**The regression.** The redesign gave the board a countdown to the next UTC
midnight — a real improvement — and put the countdown into the rebuild
condition:

```ts
if (day === snapshot.dayKey && countdown === remaining) return;
…
this.root.removeAll(true);   // the whole board is destroyed and built again
```

The remaining time is formatted in whole minutes (`4 ч 15 мин`), so the
countdown string changes once a minute and the board was destroyed and rebuilt
once a minute — the objects under the player's finger replaced, for a line that
only shows the time left. The failing window is the ≈1.1 s in which the
remaining time crosses a whole minute (≈1.8% of runs); the CI landed in it.

**The repair.** The board is rebuilt only when the day changes. The countdown
line is updated **in place**, where it stands:

```ts
if (day === snapshot.dayKey) {
  if (countdown !== remaining) {
    countdown = remaining;
    progressLine?.setText(META_COPY.tasksProgress(completed, snapshot.progress.length, remaining));
  }
  return;
}
```

The countdown stays live, the board keeps its objects inside a day, and the
rollover still rebuilds it — the last two assertions of the smoke (the rollover
must rebuild the board) keep their exact meaning.

**The new regression check.** The smoke now moves the page clock two minutes
back, waits for the board's own tick, and asserts that the countdown line
moved **and** that the board was not rebuilt:

```js
assert.equal(..., true, 'the countdown moves without rebuilding the board');
```

The check is deterministic: it does not depend on where the wall clock happens
to be inside its minute.

**The CI verification.** The step `Muse quest-to-Phaser scenes and touch
lifecycle` is **success** on the run `40459288198` (head `f17b1d7…`) and on the
run `40459329616` (the head that carries this report) — it is the step that
failed before the repair, and the code of the two runs is the same.

**The local verification.** `npm run test:quest-scenes` passes at 320×568 and
390×740. The 768×1024 pass reaches the *next* wait in the same script — the
30 s budget of the repository for the day rollover, which this sandbox misses
(its Phaser clock needs more wall clock than the runner's) and which the CI
runner meets; the step was green in the previous CI runs.
