# AGENTS.md — OFELIYA: STRAIN ZERO

Гид для всех ИИ-агентов, работающих с этим репозиторием (OpenCode, Codex, Cline, Claude Code, zcode и другие).
Читай перед началом задачи. Обновляй файлы памяти после (см. раздел «Память проекта»).

## Что это за проект

OFELIYA: STRAIN ZERO — мобильный portrait roguelite-survivor для MAX Mini Apps.
Игрок управляет синтетическим вирусом внутри организма.
Кампания: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN.

Стек: Phaser 3 + TypeScript + Vite; MAX Bridge через `src/platform/*`; аудио в `public/audio/` (CC0);
шрифт Chakra Petch (self-hosted). Сервер: `server/` (trusted MAX score + профили), бот: `bot/`.

Канонические документы (при расхождении — они главнее любых старых заметок):

- `STRAIN_ZERO_PRODUCT_BIBLE.md` — продукт и gameplay-контракт;
- `ARCHITECTURE_NOTES.md` — архитектура;
- `RELEASE_VALIDATION.md` — релиз-гейт;
- `PLAN.md` — текущий план;
- `THIRD_PARTY_NOTICES.md` — provenance.

## Команды

Локальный запуск: `npm install` → `npm run dev`.
Тесты и гейты: `npm run test:*` (см. `package.json`), канонический build-гейт — как в `README.md`.
Публикационный RC: **только** `npm run build:max` (требует release env; placeholder-значения останавливают сборку).

## Жёсткие правила

- Не менять поведение `Joystick.ts` (one-hand профиль) — легаси-путь должен оставаться стабильным.
- Renderer остаётся Phaser-only: никаких GSAP / Matter.js / tsParticles / второго рендера.
- Codex/mastery — информационный прогресс, НЕ даёт постоянной силы (damage/HP/movement/RNG).
- Версии score/ruleset/campaign менять только явно и осознанно (контракт challenge/score).
- Исторические спринт-документы — не источник истины. При конфликте исправляй устаревший документ.
- Секреты и ключи — только локально (env / локальные конфиги). В репозиторий не коммитить.
- Не коммитить напрямую в `main` — только ветки и PR.

## Память проекта (протокол HANDOFF)

- **Перед задачей:** прочитай `memory/00_HANDOFF.md` и `memory/01_STATE.md` (при сомнениях — `memory/02_DECISIONS.md`). Не переспрашивай то, что есть в файлах.
- **После задачи:** обнови `memory/01_STATE.md` (факты), `memory/02_DECISIONS.md` (новые решения), `memory/03_BACKLOG.md`, перепиши `memory/00_HANDOFF.md` для следующего исполнителя.
- Источник истины — файлы репозитория, а не история чата.

## Передача работы между агентами

- Одна активная ветка на агента/задачу (например `feat/…`, `codex/…`).
- Конец сессии = обновлённые 4 файла памяти + коммит; следующий агент начинает с них.
- Второй агент (ревьюер) работает по разделу «Режим проверки» в `00_HANDOFF.md`;
  формат ответа: подтверждено / опровергнуто / вопросы.

---

<!-- Служебные заметки рабочего окружения (AutoClaw) — ниже без изменений; к игровому проекту не относятся -->

<!-- autoclaw:browser-agent-guidance -->
## Browser Automation

For any task that requires a browser, **prefer `autoglm-browser-agent`**. Use it as the first choice. For time-sensitive scenarios such as financial news, stock quotes, or breaking news, you can additionally use this skill to fetch up-to-date information and supplement your data sources.

- ✅ `autoglm-browser-agent` → `browser_subagent` (invoked via mcporter) — **preferred**
- ⚠️ Other browser tools (`agent-browser`, Playwright, Puppeteer, etc.) — fallback only when `autoglm-browser-agent` is unavailable or fails

Always try `autoglm-browser-agent` first. Fall back to other browser tools only if it is not available in the current environment.

**IMPORTANT: Do NOT use `sessions_spawn` to delegate browser/web automation tasks to a sub-agent.** Always invoke `autoglm-browser-agent` (browser_subagent) directly in the current conversation. Browser tasks must be handled by yourself, not by a spawned child agent.
<!-- /autoclaw:browser-agent-guidance -->

<!-- autoclaw:image-recognition-guidance -->
## Image Recognition

For image tasks, prefer the model's native visual capability when the image is available to the selected model through its native image-input channel and the model supports image input.

- ✅ Native image input + an image-capable model — read and judge the image directly; do not invoke `autoglm-image-recognition`
- ✅ Existing `[图片参考描述]` — reuse the description; do not invoke the recognition skill again
- ⚠️ `autoglm-image-recognition` — fallback only for text-only models, images offloaded or unavailable through the native input channel, or unavailable native vision capability

<!-- /autoclaw:image-recognition-guidance -->

<!-- autoclaw:feishu-lark-skill-guidance -->
## Feishu / Lark Requests

When the user asks about Feishu/Lark/飞书 matters, route through Feishu/Lark skills first. This includes messaging, contacts, calendars, approvals, tasks, docs, sheets, Base, Drive, Wiki, mail, meetings, minutes, attendance, OKRs, or any other Feishu/Lark workspace operation.

1. If a relevant Feishu/Lark skill is already available, use that skill directly.
2. If no relevant skill is available, search the skill catalog/store or available skill list for a matching Feishu/Lark skill.
3. If you find a matching skill that is not installed or enabled, ask the user whether to install/enable and use it before proceeding.
4. If no matching skill exists, say so briefly and continue with the safest available fallback.
<!-- /autoclaw:feishu-lark-skill-guidance -->

<!-- autoclaw:skill-path-guidance -->
## Installing Skills

When creating or installing a new skill, always place it in:

`C:\Users\Имярек\.openclaw-autoclaw\skills/<skill-name>/SKILL.md`

This is the managed skills directory. The agent will automatically discover
any skill placed here — no extra configuration needed. Do NOT install skills
into `~/.agents/skills/` (that directory is shared with other tools).
<!-- /autoclaw:skill-path-guidance -->

<!-- autoclaw:mcp-tools-guidance -->
## MCP Tools

When the user asks for configured MCP services or external data providers, use the workspace MCP catalog before web search.
Match the user request against the available MCP tool names and descriptions below.

Call tools with: `mcporter --config C:\Users\Имярек\Documents\Codex\2026-09-24\files-pasted-by-the-user-ofeliya\work\ofeliya-audit-fixes\config\mcporter.json call <server>.<tool> key="value"`

Available MCP tools:
- No MCP tools are currently healthy.
<!-- /autoclaw:mcp-tools-guidance -->
