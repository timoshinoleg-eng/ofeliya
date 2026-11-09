import fs from 'node:fs';

const upgrades = fs.readFileSync(new URL('../src/game/UpgradeSystem.ts', import.meta.url), 'utf8');
const evolutions = fs.readFileSync(new URL('../src/game/EvolutionSystem.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/scenes/UIScene.ts', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function blockFor(shortName) {
  const marker = "shortName: '" + shortName + "'";
  const start = upgrades.indexOf(marker);
  assert(start >= 0, 'missing upgrade ' + shortName);
  const end = upgrades.indexOf('apply:', start);
  assert(end > start, 'missing apply block for ' + shortName);
  return upgrades.slice(start, end);
}

assert(upgrades.includes("singularity: 'СИНГУЛЯРНОСТЬ'"), 'singularity must have a distinct player-facing name');
assert(upgrades.includes("shortName: 'МЕМБРАННЫЙ ИМПУЛЬС'"), 'nova must not reuse lysis terminology');
assert(upgrades.includes("name: 'Взрыв клетки: +30% урон · +8% радиус'"), 'cytolysis must state what receives the +30%/+8% bonuses');
assert(upgrades.includes("desc: 'Лизис — разрыв заражённой клетки. Взрыв ранит врагов вокруг неё.'"), 'cytolysis must define lysis in player language');

for (const title of ['РЕЦЕПТОРНЫЙ ЗАХВАТ', 'ЦИТОЛИЗ', 'ВИРУСНАЯ ФАБРИКА']) {
  assert(!blockFor(title).includes("evolutionHint: 'singularity'"), title + ' must not falsely advertise the singularity recipe');
}
for (const title of ['РНК-АФФИНИТЕТ', 'МЕМБРАННЫЙ ИМПУЛЬС']) {
  assert(blockFor(title).includes("evolutionHint: 'singularity'"), title + ' must retain the real singularity recipe hint');
}

assert(evolutions.includes("recipe: 'МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II'"), 'singularity recipe copy must match its actual prerequisites');
assert(evolutions.includes("ids: ['nova'], target: 3"), 'singularity recipe steps must name the nova branch');
assert(evolutions.includes("ids: ['magnet'], target: 2"), 'singularity recipe steps must name the magnet branch');
assert(evolutions.includes("ids: ['speed', 'rate'], target: 2"), 'halo alternative branch (speed or rate) must be a recipe step');
assert(ui.includes('getUpgradeBeforeAfter(gs.runState, def)'), 'level-up cards must compute «было → стало» rows from the live run state');
assert(ui.includes('formatMutationStatValue('), 'level-up stat rows must attach units through the catalog formatter');
assert(ui.includes('LEGENDARY_CARD_DETAILS[def.legendaryId]'), 'the last-carrier card must render its structured condition/effect/price copy');
assert(ui.includes('LEVELUP_COPY.title'), 'the level-up title must come from the copy catalog');
assert(ui.includes('LEVELUP_COPY.hint'), 'the level-up hint must come from the copy catalog');
assert(!ui.includes('if (!evolution && def.evolutionHint)'), 'level-up cards must prioritize immediate effects over evolution arrows');
assert(ui.includes('`УРОВЕНЬ ${progress.next}/${progress.max}`'), 'level-up progress must use a clear level label');
assert(ui.includes('getRecipeProgress(gs.runState, def.evolutionHint, def)'), 'recipe blocks must be computed from the live run state');
assert(ui.includes('TROPHY_COPY.subtitle'), 'the trophy transition line must come from the copy catalog');
assert(ui.includes('TROPHY_COPY.rule(cards.length)'), 'the one-pick rule must reflect the actual offer count');
assert(ui.includes('trophySlotNote(gs.runState.run.legendaryIds.size)'), 'the trophy footnote must depend on the run state');
assert(!ui.includes('Синергия'), 'the synergy arrow row is replaced by the full recipe block');
assert(!ui.includes('выбери мутацию для СЕРДЦА'), 'the old trophy subtitle must be replaced by the transition line');

console.log('mutation clarity copy contract: ok');
