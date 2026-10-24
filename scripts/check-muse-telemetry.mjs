import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

async function loadTypeScript(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const flagsModule = await loadTypeScript('src/systems/ClientFeatureFlags.ts');
const analyticsModule = await loadTypeScript('src/systems/OptionalWebAnalytics.ts');

function fakeDocument() {
  const scripts = [];
  const head = {
    appendChild(script) {
      script.parentNode = head;
      scripts.push(script);
      return script;
    },
    removeChild(script) {
      const index = scripts.indexOf(script);
      if (index >= 0) scripts.splice(index, 1);
      script.parentNode = null;
      return script;
    },
  };
  return {
    scripts,
    head,
    createElement(tag) {
      assert.equal(tag, 'script');
      const attrs = new Map();
      return {
        tagName: 'SCRIPT',
        async: false,
        src: '',
        dataset: {},
        parentNode: null,
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.get(name) ?? null; },
        remove() { this.parentNode?.removeChild(this); },
        _attrs: attrs,
      };
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'script[data-ofeliya-umami]');
      return scripts.filter((item) => item.getAttribute('data-ofeliya-umami') !== null);
    },
  };
}

const defaults = flagsModule.resolveClientFlags({ qaTools: false, search: '' });
assert.deepEqual(defaults, {
  skins: { gallery: true },
  collection: { enabled: true },
  juice: { enhanced: true },
  telemetry: { web: false },
});
const refused = flagsModule.resolveClientFlags({
  qaTools: false,
  search: '?flag.skins.gallery=false&flag.telemetry.web=true&flag.events.doubleRna=true',
});
assert.equal(refused.skins.gallery, true, 'production must ignore URL overrides');
assert.equal(refused.telemetry.web, false, 'production must not enable optional analytics by URL');
assert.equal('events' in refused, false, 'gameplay flags must not exist');
const qa = flagsModule.resolveClientFlags({
  qaTools: true,
  search: '?flag.skins.gallery=false&flag.collection.enabled=0&flag.juice.enhanced=true&flag.telemetry.web=true&flag.events.doubleRna=true',
});
assert.equal(qa.skins.gallery, false);
assert.equal(qa.collection.enabled, true, 'malformed boolean value must be ignored');
assert.equal(qa.juice.enhanced, true);
assert.equal(qa.telemetry.web, true);
assert.equal('events' in qa, false);
assert.equal(Object.isFrozen(qa), true);

const noConfigDoc = fakeDocument();
const noConfig = analyticsModule.createOptionalWebAnalytics({ document: noConfigDoc, window: {} });
assert.equal(await noConfig.ready, false, 'analytics without explicit configuration must be a no-op');
assert.equal(noConfigDoc.scripts.length, 0, 'no configuration must not touch the DOM');
const invalidDoc = fakeDocument();
const invalid = analyticsModule.createOptionalWebAnalytics({
  enabled: true, src: 'http://analytics.example/script.js', websiteId: 'site-123', document: invalidDoc, window: {},
});
assert.equal(await invalid.ready, false, 'non-HTTPS script must be rejected');
assert.equal(invalidDoc.scripts.length, 0);
const invalidIdDoc = fakeDocument();
const invalidId = analyticsModule.createOptionalWebAnalytics({
  enabled: true, src: 'https://cloud.umami.is/script.js', websiteId: 'bad id', document: invalidIdDoc, window: {},
});
assert.equal(await invalidId.ready, false, 'malformed website ID must be rejected');
assert.equal(invalidIdDoc.scripts.length, 0);

const document = fakeDocument();
const calls = [];
const window = { umami: { track: (...args) => calls.push(args) } };
const config = {
  enabled: true,
  src: 'https://cloud.umami.is/script.js',
  websiteId: 'site_12345678',
  document,
  window,
};
const first = analyticsModule.createOptionalWebAnalytics(config);
const second = analyticsModule.createOptionalWebAnalytics(config);
assert.equal(document.scripts.length, 1, 'concurrent instances must share one script element');
assert.equal(document.scripts[0].src, 'https://cloud.umami.is/script.js');
assert.equal(document.scripts[0].getAttribute('data-auto-track'), 'false', 'Umami automatic page/click tracking must not leak launch URL');
document.scripts[0].onload();
assert.equal(await first.ready, true);
assert.equal(await second.ready, true);
assert.equal(document.scripts.length, 1, 'loaded script must be deduplicated');
assert.equal(first.track('win', {
  mode: 'daily', result: 'win', durationBucket: 'under_1m', questCount: 3,
  telegramUserId: '12345', initData: 'sensitive', url: 'https://secret.invalid/?x=1',
  arbitrary: true,
}), true);
assert.deepEqual(calls, [[
  {website:config.websiteId,url:'/ofeliya',title:'OFELIYA',name:'win',data:{ mode: 'daily', result: 'win', durationBucket: 'under_1m', questCount: 3 }},
]], 'only allowlisted primitive event fields may reach Umami');
assert.equal(first.track('unknown_event', { mode: 'daily' }), false);
assert.equal(first.track('app_open', { mode: { unsafe: true } }), true);
assert.deepEqual(calls.at(-1), [{website:config.websiteId,url:'/ofeliya',title:'OFELIYA',name:'app_open',data:{}}], 'malformed values must be dropped before tracking');

const retryDocument = fakeDocument();
const retry = analyticsModule.createOptionalWebAnalytics({ ...config, document: retryDocument, window: {} });
const failedScript = retryDocument.scripts[0];
failedScript.onerror();
assert.equal(await retry.ready, false);
assert.equal(retryDocument.scripts.length, 0, 'failed script must be removed to allow retry');
const retried = analyticsModule.createOptionalWebAnalytics({ ...config, document: retryDocument, window: {} });
assert.equal(retryDocument.scripts.length, 1, 'next request must retry after a script error');
retryDocument.scripts[0].onload();
assert.equal(await retried.ready, true);

console.log('MUSE telemetry contracts PASS');
