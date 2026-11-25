import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute production methods with a small Phaser I/O adapter: no copied reveal logic.
const source = readFileSync('src/scenes/UIScene.ts', 'utf8');
const ast = ts.createSourceFile('UIScene.ts', source, ts.ScriptTarget.Latest, true);
const sceneClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'UIScene');
const names = ['showBossReveal', 'showContextHint', 'flushContextHint', 'renderOnboarding', 'isBossPresentationActive', 'pauseBossContextHint', 'finishBossPresentation', 'resumeBossVideoGame', 'suspendContextHint', 'hideStageTransition', 'canResumeFromHost'];
const methods = sceneClass.members.filter(n => names.includes(n.name?.getText(ast))).map(n => n.getText(ast));
assert.equal(methods.length, names.length);
const { outputText } = ts.transpileModule(`class Probe { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
});
const metricCode = ts.transpileModule(readFileSync('src/game/ArtMetrics.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const metricModule = { exports: {} };
new Function('module', 'exports', metricCode)(metricModule, metricModule.exports);
const { CORE_ART, artScale } = metricModule.exports;
const video = { play: () => false, cancelActive: () => {} };
const Probe = new Function('createSpecimenSurface', 'VISUAL', 'CORE_ART', 'artScale', 'FONT', 'UI_FONT', 'DEPTH', 'ONBOARDING_COPY', 'ONBOARDING_MOVE_BODY', 'VideoInterstitial', 'COLORS', `${outputText}; return Probe;`)(
  () => new Node(), { ink: 0x080f14 }, CORE_ART, artScale, 'font', 'body', 50,
  { move: { title: 'Move', body: 'Move body' } },
  { 'one-hand': 'Move body', 'two-hand': 'Move body two-hand', 'dual-move': 'Move body dual-move' },
  video, { green: 1 },
);
class Node {
  constructor(key = '', width = 0, height = 0) { Object.assign(this, { key, width, height, scaleX: 1, scaleY: 1, visible: true, list: [] }); }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setDepth() { return this; } setAlpha() { return this; } setOrigin() { return this; }
  setStrokeStyle() { return this; } setResolution() { return this; } setShadow() { return this; }
  setVisible(v) { this.visible = v; return this; } setText(t) { this.text = t; return this; }
  setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDisplaySize(w, h) { return this.setScale(w / this.width, h / this.height); }
  add(children) { this.list.push(...(Array.isArray(children) ? children : [children])); return this; }
  destroy() { this.destroyed = true; }
}
function fixture(w = 390, h = 740) {
  const ui = new Probe();
  Object.assign(ui, {
    scale: { width: w, height: h }, activeBossReveals: 0, activeBossVideos: 0, bossVideoGeneration: 0, bossVideoPausedGame: false, manualPaused: false,
    modalOpen: false, uiBlocked: false, overShown: false, transitionOverlay: null,
    registry: { get: () => undefined },
    contextHintKey: null, pendingContextHints: [], contextHintContainer: new Node(), contextHintText: new Node(),
    onboarding: { active: true, currentStep: { id: 'move' }, progressMarker: 17 },
    onboardingContainer: new Node(), onboardingTitle: new Node(), onboardingBody: new Node(),
    onboardingLastXp: 42, onboardingLastHostCells: 3, contextHintTimer: { marker: 'unchanged' },
    hudAlpha: 1, renderedHints: [], tweensList: [], images: [],
  });
  ui.setHudCinematicAlpha = value => { ui.hudAlpha = value; };
  ui.renderContextHint = hint => { ui.renderedHints.push(hint); ui.contextHintKey = hint.key; ui.contextHintText.setText(hint.message); ui.contextHintContainer.setVisible(true); };
  const sizes = {
    'immune-prime': [376, 376], 'cardiac-titan': [432, 432],
    'cinematic-immune-prime': [1536, 1024], 'cinematic-cardiac-titan': [1536, 1024],
    'unknown-boss': [640, 480],
  };
  ui.textures = { exists: key => key in sizes, getFrame: key => ({ width: sizes[key][0], height: sizes[key][1] }) };
  ui.add = {
    rectangle: () => new Node(), text: () => new Node(), container: () => new Node(),
    image: (x, y, key) => { const n = new Node(key, ...sizes[key]).setPosition(x, y); ui.images.push(n); return n; },
  };
  const hintTween = { paused: false, pause() { this.paused = true; }, resume() { this.paused = false; } };
  ui.hintTween = hintTween;
  ui.tweens = {
    add: recipe => { ui.tweensList.push(recipe); },
    getTweensOf: target => target === ui.contextHintContainer ? [hintTween] : [],
    killTweensOf: () => {},
  };
  let paused = false;
  ui.scene = {
    isActive: () => !paused, isPaused: () => paused,
    pause: () => { paused = true; }, resume: () => { paused = false; },
  };
  ui.resetControls = () => {};
  return ui;
}

for (const [w, h] of [[320, 568], [360, 640], [390, 740]]) for (const key of ['immune-prime', 'cardiac-titan', 'unknown-boss']) {
  const ui = fixture(w, h);
  assert.equal(ui.showBossReveal('Boss', key, 0x91cbd2), false, 'existing no-video return preserved');
  const portrait = ui.images.find(n => n.key === key);
  const motion = ui.tweensList.find(n => n.targets === portrait);
  const bandH = h < 620 ? 156 : 184;
  for (const scale of [portrait.scaleX, motion.scale]) {
    assert.ok(portrait.width * scale <= w * .42 + 1e-9, `${key}: fits left portrait column at ${w}`);
    assert.ok(portrait.height * scale <= bandH - 20 + 1e-9, `${key}: fits reveal band at ${w}`);
  }
  assert.ok(motion.x + portrait.width * motion.scale / 2 < w * .52, 'final portrait does not enter title column');
  const cinematic = ui.images.find(n => n.key.startsWith('cinematic-'));
  if (cinematic) {
    const tween = ui.tweensList.find(n => n.targets === cinematic);
    assert.equal(cinematic.width * tween.scaleX, w, 'cinematic final width uses fitted scale');
    assert.equal(cinematic.height * tween.scaleY, bandH, 'cinematic final height uses fitted scale');
    assert.ok(Math.abs(cinematic.scaleX / tween.scaleX - 1.04) < 1e-9, 'initial zoom relative to fitted width');
    assert.ok(Math.abs(cinematic.scaleY / tween.scaleY - 1.04) < 1e-9, 'initial zoom relative to fitted height');
  }
}

// Runtime profile validation: unexpected persisted values cannot blank step 1.
for (const [rawMode, expected] of [
  ['one-hand', 'Move body'],
  ['two-hand', 'Move body two-hand'],
  ['dual-move', 'Move body dual-move'],
  ['unknown-profile', 'Move body'],
  [null, 'Move body'],
  [undefined, 'Move body'],
  [42, 'Move body'],
]) {
  const probe = fixture(320, 568);
  probe.registry = { get: () => rawMode };
  probe.renderOnboarding();
  assert.equal(probe.onboardingBody.text, expected, 'controlMode fallback: ' + String(rawMode));
}

// First boss hint must survive reveal; the second hint waits for first expiry.
const bossHints = fixture(320, 568);
bossHints.contextHintContainer.setVisible(false);
bossHints.showContextHint('DODGE FIRST', 3200, { key: 'boss:dodge', queueIfVisible: true });
bossHints.showContextHint('LYSIS SECOND', 3400, { key: 'boss:lysis', queueIfVisible: true });
assert.deepEqual(bossHints.renderedHints.map(h => h.message), ['DODGE FIRST']);
assert.deepEqual(bossHints.pendingContextHints.map(h => h.key), ['boss:lysis']);
bossHints.showBossReveal('Prime', 'immune-prime', 0x91cbd2);
assert.equal(bossHints.contextHintContainer.visible, false);
bossHints.tweensList.filter(t => t.onComplete)[0].onComplete();
assert.equal(bossHints.contextHintContainer.visible, true);
assert.deepEqual(bossHints.renderedHints.map(h => h.message), ['DODGE FIRST'], 'reveal must preserve the first hint');
assert.deepEqual(bossHints.pendingContextHints.map(h => h.key), ['boss:lysis']);
bossHints.contextHintContainer.setVisible(false);
bossHints.contextHintKey = null;
bossHints.flushContextHint();
assert.deepEqual(bossHints.renderedHints.map(h => h.message), ['DODGE FIRST', 'LYSIS SECOND']);
const ui = fixture();
const onboardingBefore = JSON.stringify(ui.onboarding);
const timerBefore = ui.contextHintTimer;
ui.showBossReveal('First', 'immune-prime', 1);
ui.showBossReveal('Second', 'cardiac-titan', 2);
assert.equal(ui.activeBossReveals, 2);
ui.renderOnboarding();
assert.equal(ui.onboardingContainer.visible, false, 'next-frame onboarding stays hidden');
ui.showContextHint('Queued hint', 1800, { key: 'queued' });
ui.showContextHint('Queued hint', 1800, { key: 'queued' });
assert.equal(ui.pendingContextHints.length, 1, 'deduplicated while reveal blocks hint');
ui.flushContextHint();
assert.equal(ui.renderedHints.length, 0, 'manual flush cannot leak hint');
const completions = ui.tweensList.filter(n => n.onComplete);
completions[0].onComplete();
assert.equal(ui.activeBossReveals, 1);
ui.renderOnboarding();
assert.equal(ui.onboardingContainer.visible, false, 'first completion cannot expose onboarding');
assert.equal(ui.renderedHints.length, 0, 'first completion cannot flush hint');
assert.equal(ui.hudAlpha, .12, 'first completion keeps cinematic HUD');
completions[0].onComplete();
assert.equal(ui.activeBossReveals, 1, 'duplicate completion cannot release another reveal');
completions[1].onComplete();
assert.equal(ui.activeBossReveals, 0);
assert.equal(ui.renderedHints.length, 1, 'last reveal flushes queued hint once');
assert.equal(ui.hudAlpha, 1);
assert.equal(ui.onboardingContainer.visible, false, 'active context hint still has priority');
ui.contextHintKey = null;
ui.renderOnboarding();
assert.equal(ui.onboardingContainer.visible, true, 'onboarding resumes through normal render policy');
assert.equal(JSON.stringify(ui.onboarding), onboardingBefore, 'tutorial counters and step unchanged');
assert.equal(ui.contextHintTimer, timerBefore, 'existing hint clock untouched');
assert.equal(ui.onboardingLastXp, 42);
assert.equal(ui.onboardingLastHostCells, 3);
// Both orders of completion, successful and failed video, and cancellation.
function queuedHintFixture() {
  const probe = fixture();
  probe.contextHintContainer.setVisible(false);
  probe.showContextHint('DODGE FIRST', 3200, { key: 'boss:dodge' });
  probe.showContextHint('LYSIS SECOND', 3400, { key: 'boss:lysis', queueIfVisible: true });
  probe.contextHintTimer = {
    paused: false, elapsed: 450, delay: 3200,
    getRemaining() { return this.delay - this.elapsed; },
    remove() { this.removed = true; },
  };
  return probe;
}
for (const finish of ['onComplete', 'onFail']) {
  for (const order of ['reveal-first', 'video-first']) {
    const probe = queuedHintFixture();
    const timer = probe.contextHintTimer;
    let options;
    video.play = (_, args) => { options = args; return true; };
    assert.equal(probe.showBossReveal('Prime', 'immune-prime', 1, 'immunePrimeIntro'), true);
    options.onVisible();
    assert.equal(probe.activeBossVideos, 1);
    assert.equal(probe.canResumeFromHost(), false);
    assert.equal(probe.contextHintContainer.visible, false);
    assert.equal(timer.paused, true);
    assert.equal(probe.hintTween.paused, true);
    const reveal = probe.tweensList.find(t => t.onComplete);
    if (order === 'reveal-first') reveal.onComplete(); else options[finish]();
    probe.flushContextHint();
    probe.renderOnboarding();
    assert.equal(probe.contextHintContainer.visible, false, 'one remaining presentation blocks hint');
    assert.equal(timer.paused, true);
    assert.equal(probe.hintTween.paused, true);
    assert.equal(probe.canResumeFromHost(), false);
    assert.equal(probe.onboardingContainer.visible, false);
    assert.deepEqual(probe.pendingContextHints.map(h => h.key), ['boss:lysis']);
    assert.equal(probe.renderedHints.length, 1);
    if (order === 'reveal-first') options[finish](); else reveal.onComplete();
    assert.equal(probe.activeBossVideos, 0);
    assert.equal(probe.activeBossReveals, 0);
    assert.equal(probe.contextHintContainer.visible, true);
    assert.equal(probe.contextHintTimer, timer);
    assert.equal(timer.paused, false);
    assert.equal(timer.elapsed, 450);
    assert.equal(probe.hintTween.paused, false);
    assert.equal(probe.scene.isPaused('Game'), false);
    options.onComplete(); options.onFail(); reveal.onComplete();
    probe.flushContextHint();
    assert.equal(probe.renderedHints.length, 1, 'manual/duplicate completion must not replace first hint');
    probe.contextHintKey = null;
    probe.contextHintContainer.setVisible(false);
    probe.flushContextHint();
    assert.deepEqual(probe.renderedHints.map(h => h.key), ['boss:dodge', 'boss:lysis']);
  }
}
{
  const probe = queuedHintFixture();
  const timer = probe.contextHintTimer;
  let options;
  video.play = (_, args) => { options = args; return true; };
  probe.showBossReveal('Prime', 'immune-prime', 1, 'immunePrimeIntro');
  options.onVisible();
  probe.modalOpen = true; probe.uiBlocked = true;
  probe.suspendContextHint();
  assert.equal(timer.removed, true);
  assert.equal(probe.contextHintTimer, null);
  assert.equal(probe.contextHintKey, null);
  assert.deepEqual(probe.pendingContextHints.map(h => h.key), ['boss:dodge', 'boss:lysis']);
  assert.equal(probe.pendingContextHints[0].duration, 2750);
  probe.tweensList.find(t => t.onComplete).onComplete();
  options.onComplete();
  assert.equal(probe.scene.isPaused('Game'), true, 'modal owns pause now');
  assert.equal(probe.renderedHints.length, 1);
  probe.modalOpen = false; probe.uiBlocked = false;
  probe.flushContextHint();
  assert.equal(probe.renderedHints.at(-1).key, 'boss:dodge');
  assert.equal(probe.pendingContextHints[0].key, 'boss:lysis');
}
{
  const probe = queuedHintFixture();
  const callbacks = [];
  video.play = (_, args) => { callbacks.push(args); return true; };
  probe.showBossReveal('Prime', 'immune-prime', 1, 'immunePrimeIntro');
  callbacks[0].onVisible();
  probe.showBossReveal('Titan', 'cardiac-titan', 2, 'cardiacTitanIntro');
  callbacks[0].onComplete(); // stale callback cannot release replacement
  assert.equal(probe.activeBossVideos, 1);
  for (const tween of probe.tweensList.filter(t => t.onComplete)) tween.onComplete();
  assert.equal(probe.contextHintContainer.visible, false);
  probe.hideStageTransition(); // cancelOnly never calls completion
  assert.equal(probe.activeBossVideos, 0);
  assert.equal(probe.contextHintTimer.paused, false);
  assert.equal(probe.contextHintContainer.visible, true);
  callbacks[1].onFail();
  assert.equal(probe.renderedHints.length, 1);
}
video.play = () => false;
{
  const probe = queuedHintFixture();
  assert.equal(probe.showBossReveal('Prime', 'immune-prime', 1, 'immunePrimeIntro'), false);
  assert.equal(probe.activeBossVideos, 0);
  assert.equal(probe.contextHintTimer.paused, true);
  probe.tweensList.find(t => t.onComplete).onComplete();
  assert.equal(probe.contextHintTimer.paused, false);
}
const create = sceneClass.members.find(n => n.name?.getText(ast) === 'create').getText(ast);
assert.match(create, /this\.activeBossReveals = 0;/, 'scene restart resets retained presentation gate');
assert.match(create, /this\.activeBossVideos = 0;/, 'restart resets video gate');
assert.match(create, /SHUTDOWN[\s\S]*this\.activeBossVideos = 0;/, 'shutdown resets video gate');
console.log('boss presentation: video complete/fail, both completion orders, modal suspension, replacement/cancel,  production reveal/hint/onboarding methods; 9 geometry variants, fitted cinematic zoom, overlapping completion and unchanged tutorial/hint clock PASS');
