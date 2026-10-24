import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = buildSync({
  absWorkingDir: root,
  entryPoints: ['./src/ui/ClientJuice.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const module = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require);
const { rewardReveal, squashAndStretch, impactZoom } = module.exports;

class FakeEvents {
  listeners = new Map();
  once(event, callback) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]); }
  off(event, callback) {
    const next = (this.listeners.get(event) ?? []).filter((item) => item !== callback);
    if (next.length) this.listeners.set(event, next); else this.listeners.delete(event);
  }
  emit(event) {
    const callbacks = this.listeners.get(event) ?? [];
    this.listeners.delete(event);
    for (const callback of callbacks) callback();
  }
  count(event) { return (this.listeners.get(event) ?? []).length; }
}

function fakeScene() {
  const scene = { events: new FakeEvents(), tweens: { items: [], add(config) {
    const tween = { stopped: false, stop() { this.stopped = true; } };
    this.items.push({ config, tween });
    return tween;
  } }, cameras: { main: { zoom: 1.25 } } };
  return scene;
}

const scene = fakeScene();
const preview = { alpha: 0.72, scaleX: 1.4, scaleY: 0.85 };
assert.equal(rewardReveal(scene, preview, { enabled: false, reduced: false }), false);
assert.equal(squashAndStretch(scene, preview, { enabled: true, reduced: true }), false);
assert.equal(scene.tweens.items.length, 0, 'disabled and reduced motion never create tweens');
assert.equal(preview.alpha, 0.72);

assert.equal(rewardReveal(scene, preview, { enabled: true, reduced: false }), true);
assert.equal(scene.tweens.items.length, 1);
assert.equal(scene.events.count('shutdown'), 1);
const activePreview = [preview.alpha, preview.scaleX, preview.scaleY];
assert.equal(rewardReveal(scene, preview, { enabled: true, reduced: false }), false, 'active target is not re-entered');
assert.equal(scene.tweens.items.length, 1, 're-entry creates no duplicate tween');
assert.deepEqual([preview.alpha, preview.scaleX, preview.scaleY], activePreview, 're-entry does not restart or distort the active effect');
scene.tweens.items[0].config.onComplete();
assert.deepEqual([preview.alpha, preview.scaleX, preview.scaleY], [0.72, 1.4, 0.85], 'completion restores exact baseline');
assert.equal(scene.events.count('shutdown'), 0, 'completion removes shutdown listener');

assert.equal(squashAndStretch(scene, preview, { enabled: true, reduced: false }), true);
const squash = scene.tweens.items[1];
assert.equal(squash.config.targets, preview);
assert.equal(squash.config.yoyo, true);
scene.events.emit('shutdown');
assert.equal(squash.tween.stopped, true, 'shutdown stops active tween');
assert.deepEqual([preview.alpha, preview.scaleX, preview.scaleY], [0.72, 1.4, 0.85], 'shutdown restores exact baseline');
assert.equal(scene.events.count('shutdown'), 0);

const zoomScene = fakeScene();
assert.equal(impactZoom(zoomScene, { enabled: true, reduced: false, qualityScale: 0.5 }), false);
assert.equal(impactZoom(zoomScene, { enabled: false, reduced: false, qualityScale: 1 }), false);
assert.equal(zoomScene.tweens.items.length, 0, 'disallowed or low-quality impact zoom is skipped');
assert.equal(impactZoom(zoomScene, { enabled: true, reduced: false, qualityScale: 0.75 }), true);
const zoom = zoomScene.tweens.items[0];
assert.equal(zoom.config.duration, 80);
assert.equal(zoom.config.yoyo, true);
assert.equal(zoom.config.zoom.to, 1.25 * 1.008, 'impact zoom stays within one percent');
zoomScene.events.emit('shutdown');
assert.equal(zoom.tween.stopped, true);
assert.equal(zoomScene.cameras.main.zoom, 1.25, 'shutdown restores camera baseline');
assert.equal(impactZoom(zoomScene, { enabled: true, reduced: false, qualityScale: 0.75 }), true, 'cleanup allows a later preview');
zoomScene.tweens.items[1].config.onComplete();
assert.equal(zoomScene.cameras.main.zoom, 1.25);

console.log('muse juice contract: OK');

const destroyedScene = fakeScene();
const destroyedPreview = Object.assign(new FakeEvents(), { alpha: 1, scaleX: 1, scaleY: 1 });
assert.equal(rewardReveal(destroyedScene, destroyedPreview, { reduced: false }), true);
destroyedPreview.emit('destroy');
assert.equal(destroyedScene.events.count('shutdown'), 0, 'destroying a panel removes its effect shutdown listener');
assert.equal(destroyedScene.tweens.items[0].tween.stopped, true, 'destroy stops the effect tween');
assert.equal(destroyedPreview.count('destroy'), 0);
