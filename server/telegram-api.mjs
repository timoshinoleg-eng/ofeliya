import https from 'node:https';

const TELEGRAM_HOST = 'api.telegram.org';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TELEGRAM_AGENT = new https.Agent({ keepAlive: true, timeout: 70_000 });

function safeApiIp(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const ip = value.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return '';
  if (ip.split('.').some((part) => Number(part) > 255)) return '';
  return ip;
}

export function telegramApiRequestOptions({
  token,
  method,
  apiIp = process.env.OFELIYA_TELEGRAM_API_IP ?? '',
}) {
  const pinnedIp = safeApiIp(apiIp);
  return {
    host: pinnedIp || TELEGRAM_HOST,
    port: 443,
    servername: TELEGRAM_HOST,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.2',
    agent: TELEGRAM_AGENT,
    method: 'POST',
    path: '/bot' + token + '/' + method,
    headers: {
      Host: TELEGRAM_HOST,
      'Content-Type': 'application/json',
    },
  };
}

export async function telegramApiJson({
  token,
  method,
  params = {},
  timeoutMs = 10_000,
  apiIp = process.env.OFELIYA_TELEGRAM_API_IP ?? '',
}) {
  if (!token || !method) throw new Error('Telegram API token/method required');

  const requestBody = JSON.stringify(params);
  const options = telegramApiRequestOptions({ token, method, apiIp });
  options.headers['Content-Length'] = Buffer.byteLength(requestBody);

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      let size = 0;

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Telegram API response too large'));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {}
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          body: parsed,
        });
      });
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Telegram API timeout')));
    req.on('error', reject);
    req.end(requestBody);
  });
}
