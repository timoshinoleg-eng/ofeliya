import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const phaserStub = {
  Scenes: { Events: { SHUTDOWN: 'shutdown', DESTROY: 'destroy', POST_UPDATE: 'postupdate', UPDATE: 'update' } },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) },
};
let reducedMotion = false;
function loadTs(path, stubs = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const module = { exports: {} };
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name === 'phaser') return { __esModule: true, default: phaserStub };
    if (name.endsWith('/MotionPreferences')) return { prefersReducedMotion: () => reducedMotion };
    return stubs[name] ?? {};
  }, module, module.exports);
  return module.exports;
}

class Emitter {
  entries = [];
  on(name, fn, context) { this.entries.push({ name, fn, context, once: false }); return this; }
  once(name, fn, context) { this.entries.push({ name, fn, context, once: true }); return this; }
  off(name, fn, context) {
    this.entries = this.entries.filter(e => e.name !== name || e.fn !== fn || e.context !== context);
    return this;
  }
  emit(name, ...args) {
    for (const entry of [...this.entries]) {
      if (entry.name !== name) continue;
      if (entry.once) this.off(name, entry.fn, entry.context);
      entry.fn.apply(entry.context, args);
    }
  }
  listenerCount(name) { return this.entries.filter(e => e.name === name).length; }
}

class WorldObject extends Emitter {
  active = true;
  visible = true;
  parent = null;
  input = null;
  mask = null;
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  originX = 0.5;
  originY = 0.5;
  setName(name) { this.name = name; return this; }
  setVisible(value) { this.visible = value; return this; }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  setSize(width, height) {
    this.width = width; this.height = height;
    if (this.input) this.input.hitArea = { width, height };
    return this;
  }
  setInteractive() { this.input = { enabled: true }; return this; }
  setMask(mask) { this.mask = mask; return this; }
  clearMask() { this.mask = null; return this; }
  world() {
    let x = this.x, y = this.y, parent = this.parent;
    while (parent) { x += parent.x; y += parent.y; parent = parent.parent; }
    return { x, y };
  }
  getBounds() {
    const p = this.world();
    return { x: p.x - this.width * this.originX, y: p.y - this.height * this.originY,
      width: this.width, height: this.height };
  }
  getWorldTransformMatrix() {
    const p = this.world();
    return {
      transformPoint: (x, y) => ({ x: x + p.x, y: y + p.y }),
      applyInverse: (x, y, out = { x: 0, y: 0 }) => { out.x = x - p.x; out.y = y - p.y; return out; },
    };
  }
  destroy() {
    if (!this.active) return;
    this.active = false;
    this.emit('destroy');
  }
}

class Container extends WorldObject {
  list = [];
  add(objects) {
    for (const object of Array.isArray(objects) ? objects : [objects]) {
      object.parent = this;
      this.list.push(object);
    }
    return this;
  }
  addAt(object, index) {
    object.parent = this;
    this.list.splice(index, 0, object);
    return this;
  }
  getIndex(object) { return this.list.indexOf(object); }
  getAt(index) { return this.list[index]; }
  destroy() {
    if (!this.active) return;
    for (const child of [...this.list]) child.destroy();
    super.destroy();
  }
}

class Graphics extends WorldObject {
  fills = 0;
  setDepth() { return this; }
  clear() { return this; }
  fillStyle() { return this; }
  fillRect() { this.fills += 1; return this; }
  lineStyle() { return this; }
  strokeRoundedRect() { return this; }
  createGeometryMask() {
    const mask = { destroyed: false, destroy() { this.destroyed = true; } };
    this.maskObject = mask;
    return mask;
  }
}

class CanvasElement {
  attributes = new Map();
  listeners = new Emitter();
  tabIndex = -1;
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, fn) { this.listeners.on(name, fn); }
  removeEventListener(name, fn) { this.listeners.off(name, fn); }
  focus() { globalThis.document.activeElement = this; }
}

globalThis.Element = CanvasElement;
const canvas = new CanvasElement();
globalThis.document = {
  body: new CanvasElement(), documentElement: new CanvasElement(), activeElement: canvas,
  querySelectorAll: () => [],
};
globalThis.getComputedStyle = () => ({ visibility: 'visible' });

const { MenuKeyboard } = loadTs('../src/ui/MenuKeyboard.ts');
const { ScrollViewport, SCROLL_TAP_THRESHOLD_PX } = loadTs('../src/ui/ScrollViewport.ts');

function fixture() {
  const root = new Container();
  const content = new Container().setPosition(0, 100);
  root.add(content);
  const buttons = [30, 260, 650].map((y, index) => {
    const button = new WorldObject().setPosition(0, y).setSize(120, 40).setName(`button-${index}`).setInteractive();
    content.add(button);
    return button;
  });
  const tweens = [];
  const scene = {
    input: new Emitter(), events: new Emitter(), scale: new Emitter(),
    game: { canvas }, sys: { isActive: () => true }, scene: { isActive: () => false },
    add: {
      zone: (x, y, width, height) => new WorldObject().setPosition(x, y).setSize(width, height),
      graphics: () => new Graphics(),
    },
    make: { graphics: () => new Graphics() },
    tweens: {
      add: config => {
        const tween = { config, stopped: false, stop() { this.stopped = true; } };
        tweens.push(tween);
        return tween;
      },
    },
  };
  scene.input.keyboard = new Emitter();
  return { root, content, buttons, scene, tweens };
}

function pointer(id, x, y, wasCanceled = false) {
  return { id, worldX: x, worldY: y, wasCanceled };
}
function key(scene, value) {
  scene.input.keyboard.emit('keydown', {
    key: value, target: canvas, defaultPrevented: false, altKey: false, ctrlKey: false,
    metaKey: false, isComposing: false, repeat: false, shiftKey: false,
    preventDefault() { this.defaultPrevented = true; },
  });
}

const { root, content, buttons, scene, tweens } = fixture();
let baseEscapes = 0;
let overlayEscapes = 0;
const activations = [];
const keyboard = new MenuKeyboard(scene, { blocked: () => false, escape: () => { baseEscapes += 1; return true; } });
const viewport = new ScrollViewport(scene, {
  parent: root, content, bounds: { x: -100, y: 100, width: 200, height: 200 }, contentHeight: 800,
  name: 'ofeliya-test', keyboard,
  escape: () => { overlayEscapes += 1; return true; },
});
assert.equal(SCROLL_TAP_THRESHOLD_PX, 10);
assert.equal(viewport.scrollLimit, 600);
assert.equal(viewport.hitZone.name, 'ofeliya-test-hit');
assert.equal(root.list.filter(object => object.name === 'ofeliya-test-hit').length, 1, 'exactly one hit Zone');
assert.ok(content.mask, 'GeometryMask is attached');
assert.equal(content.mask.destroyed, false);
assert.equal(buttons[0].input.enabled, true, 'fully visible control is enabled');
assert.equal(buttons[1].input.enabled, false, 'clipped control cannot receive invisible hits');

viewport.setFocusTargets(buttons.map((button, index) => ({
  id: `button-${index}`, object: button, label: () => `Button ${index}`,
  activate: () => { activations.push(index); },
})));
viewport.scrollTo(900);
assert.equal(viewport.scrollOffset, 600, 'programmatic scroll is bounded');
assert.equal(content.y, -500);
viewport.scrollTo(-50);
assert.equal(viewport.scrollOffset, 0);
scene.input.emit('wheel', pointer(0, 0, 150), [], 0, 80);
assert.equal(viewport.scrollOffset, 40, 'wheel scrolls inside the viewport');
scene.input.emit('wheel', pointer(0, 0, 400), [], 0, 80);
assert.equal(viewport.scrollOffset, 40, 'wheel outside is ignored');
viewport.scrollTo(0);

buttons[0].on('pointerup', pointer => { if (!pointer.wasCanceled) activations.push(0); });
scene.input.emit('pointerdown', pointer(0, 0, 130));
scene.input.emit('pointermove', pointer(0, 0, 95));
assert.equal(buttons[0].input.enabled, false, 'drag disables the pressed button before pointerup');
if (buttons[0].input.enabled) buttons[0].emit('pointerup', pointer(0, 0, 95));
scene.input.emit('pointerup', pointer(0, 0, 95));
assert.deepEqual(activations, [], 'a drag release does not activate a button');
assert.equal(tweens.length, 1, 'drag release starts inertia');
assert.ok(tweens[0].config.offset >= 0 && tweens[0].config.offset <= 600, 'inertia target is bounded');
assert.equal(buttons[0].alpha, undefined, 'test fixture reached release without pointer errors');
viewport.scrollTo(0);
assert.equal(tweens[0].stopped, true, 'a new scroll stops inertia');
scene.input.emit('pointerdown', pointer(0, 0, 130));
if (buttons[0].input.enabled) buttons[0].emit('pointerup', pointer(0, 0, 130));
scene.input.emit('pointerup', pointer(0, 0, 130));
assert.deepEqual(activations, [0], 'a tap still activates');

assert.equal(viewport.scrollToTarget('button-1'), true);
assert.ok(viewport.scrollOffset > 0, 'target scrolling reveals a clipped control');
assert.equal(viewport.focus('button-1'), true);
key(scene, 'Enter');
assert.deepEqual(activations, [0, 1], 'Enter uses the real focused action');
viewport.scrollTo(0);
assert.equal(viewport.focus('button-0'), true);
key(scene, 'Tab');
assert.equal(activations.length, 2, 'Tab does not activate while revealing a clipped target');
assert.ok(viewport.scrollOffset > 0, 'Tab scrolls the next clipped target into view');
key(scene, 'Enter');
assert.deepEqual(activations, [0, 1, 1], 'the newly revealed keyboard target activates');
key(scene, 'Escape');
assert.equal(overlayEscapes, 1);
assert.equal(baseEscapes, 0, 'overlay Escape does not leak to the base menu');

viewport.scrollTo(0);
assert.equal(viewport.focus('button-0'), true);
key(scene, ' ');
assert.deepEqual(activations, [0, 1, 1, 0], 'Space uses the same action');
viewport.scrollTo(15);
assert.equal(buttons[0].input.enabled, false, 'partially clipped control is disabled');
viewport.scrollTo(0);
assert.equal(buttons[0].input.enabled, true);

const clip = root.list.find(object => object instanceof Graphics && object.visible === false);
const fillsBeforeResize = clip.fills;
viewport.resize({ x: -90, y: 80, width: 180, height: 300 }, 700, 80);
assert.equal(viewport.hitZone.height, 300);
assert.equal(viewport.scrollLimit, 400);
assert.equal(clip.fills, fillsBeforeResize + 1, 'mask geometry redraws once per resize');

scene.input.emit('pointerdown', pointer(2, 0, 150));
scene.input.emit('pointermove', pointer(2, 0, 120));
scene.input.emit('pointerupoutside', pointer(2, 0, 120));
assert.equal(buttons.some(button => button.input?.enabled && button.getBounds().y < 80), false,
  'outside release restores only clipping-driven input state');
const beforeCancelTweens = tweens.length;
scene.input.emit('pointerdown', pointer(3, 0, 150));
scene.input.emit('pointermove', pointer(3, 0, 120));
scene.input.emit('pointerup', pointer(3, 0, 120, true));
assert.equal(tweens.length, beforeCancelTweens, 'canceled pointers do not start inertia');

viewport.scrollTo(0);
const beforeCanceledTap = activations.length;
scene.input.emit('pointerdown', pointer(4, 0, 110));
if (buttons[0].input.enabled) buttons[0].emit('pointerup', pointer(4, 0, 110, true));
scene.input.emit('pointerup', pointer(4, 0, 110, true));
assert.equal(activations.length, beforeCanceledTap, 'a canceled tap is not an activation');
viewport.destroy();
key(scene, 'Escape');
assert.equal(baseEscapes, 1, 'destroying the viewport restores the base Escape scope');
for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'wheel', 'gameout']) {
  assert.equal(scene.input.listenerCount(event), 0, `${event} listener removed`);
}
assert.equal(scene.scale.listenerCount('resize'), 0);
assert.equal(content.mask, null, 'content mask cleared');
assert.equal(content.active, true, 'consumer retains content ownership');
assert.equal(viewport.hitZone.active, false);
assert.equal(clip.active, false);
scene.events.emit('shutdown');
assert.equal(scene.events.listenerCount('update'), 0);

const sheenSource = readFileSync(new URL('../src/ui/MutationCardSheen.ts', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/scenes/UIScene.ts', import.meta.url), 'utf8');
assert.ok(sheenSource.includes("MUTATION_CARD_SHEEN_TEXTURE_KEY = 'sz_ui_card_sheen'"), 'canonical sheen texture key');
assert.ok(sheenSource.includes("scene.textures.exists(MUTATION_CARD_SHEEN_TEXTURE_KEY)"), 'shared texture check');
assert.ok(sheenSource.includes('scene.add.rectangle'), 'Phaser fallback exists');
assert.ok(sheenSource.includes('createGeometryMask()'), 'sheen uses a geometry mask');
assert.ok(sheenSource.includes('group.removeAll()'), 'sheen tweens are removed');
assert.ok(uiSource.includes("!evolution && (legendary || def.rarity === 'rare')"), 'only rare and legendary cards receive sheen');
assert.ok(uiSource.includes('if (sheenCards.length > 0) createMutationCardSheens(this, c, sheenCards)'),
  'sheen is created only for the active mutation modal');
for (const path of ['../src/scenes/StorefrontScene.ts', '../src/ui/SocialHub.ts', '../src/ui/CollectionBoard.ts',
  '../src/ui/SkinGallery.ts', '../src/ui/QuestBoard.ts']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.ok(source.includes('addUiIcon('), `${path} uses the shared UI icon helper`);
}
console.log('ScrollViewport: scrolling, tap/drag, inertia, focus, clipping, resize, cancellation and teardown passed');
