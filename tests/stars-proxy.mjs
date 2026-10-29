/**
 * stars-proxy — патч №15 (P0-1, аудит №5).
 *
 * Аудит нашёл: forwardStarsUpdate() POSTил на «голый»
 * OFELIYA_STARS_WORKER_URL без /api/webhook → при настройке строго по
 * README (https://<worker>.workers.dev) запрос уходил в / и получал 404.
 *
 * Фикс: normalizeWorkerUrl() ВСЕГДА добавляет /api/webhook (trailing slash
 * срезается, имеющийся путь не дублируется).
 *
 * Covers:
 * - normalizeWorkerUrl: bare URL → +/api/webhook; полный путь — без дубля;
 *   trailing slashes; пустой URL → throw.
 * - forwardStarsUpdate: https-требование (allowInsecure=false);
 *   секрет <16 символов → throw.
 * - Интеграционный: локальный HTTP-стаб «воркера», ассертящий путь
 *   /api/webhook и секретный заголовок; прогон через forwardStarsUpdate
 *   с allowInsecure:true → 200 и тело как есть.
 */
import { createServer } from 'node:http';
import { normalizeWorkerUrl, isStarsUpdate, forwardStarsUpdate } from '../server/stars-proxy.mjs';

const assert = (condition, message) => {
  if (!condition) throw new Error(`stars-proxy: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// --- normalizeWorkerUrl ---
eq(
  normalizeWorkerUrl('https://ofeliya-payments.workers.dev'),
  'https://ofeliya-payments.workers.dev/api/webhook',
  'bare url gets /api/webhook'
);
eq(
  normalizeWorkerUrl('https://ofeliya-payments.workers.dev/'),
  'https://ofeliya-payments.workers.dev/api/webhook',
  'trailing slash stripped, path appended'
);
eq(
  normalizeWorkerUrl('https://ofeliya-payments.workers.dev/api/webhook'),
  'https://ofeliya-payments.workers.dev/api/webhook',
  'existing path not duplicated'
);
eq(
  normalizeWorkerUrl('https://ofeliya-payments.workers.dev/api/webhook///'),
  'https://ofeliya-payments.workers.dev/api/webhook',
  'existing path + trailing slashes not duplicated'
);
eq(
  normalizeWorkerUrl('  https://ofeliya-payments.workers.dev  '),
  'https://ofeliya-payments.workers.dev/api/webhook',
  'whitespace trimmed'
);
let threw = false;
try {
  normalizeWorkerUrl('');
} catch {
  threw = true;
}
assert(threw, 'empty url throws');

// --- isStarsUpdate (регрессия) ---
assert(isStarsUpdate({ pre_checkout_query: { id: 'q' } }), 'pre_checkout is stars');
assert(
  isStarsUpdate({ message: { successful_payment: { currency: 'XTR' } } }),
  'successful_payment is stars'
);
assert(!isStarsUpdate({ message: { text: '/start' } }), '/start is not stars');
assert(!isStarsUpdate(null), 'null is not stars');

// --- forwardStarsUpdate: https-требование ---
{
  let err = null;
  try {
    await forwardStarsUpdate(
      { pre_checkout_query: { id: 'q' } },
      { workerUrl: 'http://insecure.local', workerSecret: 'x'.repeat(16) }
    );
  } catch (e) {
    err = e;
  }
  assert(err && /https/.test(err.message), 'http rejected without allowInsecure');
}
{
  let err = null;
  try {
    await forwardStarsUpdate(
      { pre_checkout_query: { id: 'q' } },
      { workerUrl: 'https://ok.example', workerSecret: 'short' }
    );
  } catch (e) {
    err = e;
  }
  assert(err && /secret/.test(err.message), 'short secret rejected');
}

// --- Интеграционный: стаб воркера ассертит путь и заголовок ---
{
  const SECRET = 'worker-secret-16-chars';
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => void (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, secret: req.headers['x-telegram-bot-api-secret-token'], body });
      // Как настоящий воркер без секрета: 403. Тест шлёт верный.
      if (req.url !== '/api/webhook') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proxied: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const update = { pre_checkout_query: { id: 'q-int-1' } };
    const res = await forwardStarsUpdate(update, {
      workerUrl: `http://127.0.0.1:${port}`,
      workerSecret: SECRET,
      allowInsecure: true,
      timeoutMs: 5000,
    });
    eq(res.status, 200, 'proxied status 200');
    eq(res.body.proxied, true, 'worker body passed through');
    eq(seen.length, 1, 'one request reached stub');
    eq(seen[0].url, '/api/webhook', 'P0-1: request path is /api/webhook');
    eq(seen[0].secret, SECRET, 'worker secret header forwarded');
    eq(JSON.parse(seen[0].body).pre_checkout_query.id, 'q-int-1', 'update body forwarded');

    // И с trailing slash в конфиге — путь всё равно ровно /api/webhook.
    seen.length = 0;
    await forwardStarsUpdate(update, {
      workerUrl: `http://127.0.0.1:${port}///`,
      workerSecret: SECRET,
      allowInsecure: true,
      timeoutMs: 5000,
    });
    eq(seen[0].url, '/api/webhook', 'trailing slashes do not break path');
  } finally {
    server.close();
  }
}

console.log('stars-proxy: all assertions passed');
