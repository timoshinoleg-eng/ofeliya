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
assert(ui.includes('.text(tx, descY, def.desc,'), 'level-up cards must render the player-facing description');
assert(!ui.includes('if (!evolution && def.evolutionHint)'), 'level-up cards must prioritize immediate effects over evolution arrows');
assert(ui.includes('`УРОВЕНЬ ${progress.next}/${progress.max}`'), 'level-up progress must use a clear level label');

console.log('mutation clarity copy contract: ok');
