const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const TRACKS = [
  'audio/music/loop0.ogg',
  'audio/music/loop1.ogg',
  'audio/music/loop2.ogg',
  'audio/music/loop3.mp3',
  'audio/music/loop4.mp3',
  'audio/music/loop5.mp3',
  'audio/music/loop6.mp3',
];

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });

  const results = await page.evaluate(async (tracks) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('AudioContext unavailable');
    const audio = new AudioContextCtor();
    const rows = [];
    for (const track of tracks) {
      try {
        const response = await fetch(track, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const decoded = await audio.decodeAudioData(bytes);
        rows.push({
          track,
          ok: true,
          duration: Number(decoded.duration.toFixed(3)),
          channels: decoded.numberOfChannels,
          sampleRate: decoded.sampleRate,
        });
      } catch (error) {
        rows.push({ track, ok: false, error: String(error) });
      }
    }
    await audio.close();
    return rows;
  }, TRACKS);

  const failed = results.filter((row) => !row.ok);
  if (failed.length > 0) {
    throw new Error(`music bed decode failed: ${JSON.stringify(failed)}`);
  }
  if (results.length !== TRACKS.length || results.some((row) => row.duration <= 0)) {
    throw new Error(`music bed decode contract failed: ${JSON.stringify(results)}`);
  }

  await browser.close();
  console.log(`music bed browser decode: ok (${results.length}/${TRACKS.length})`);
  console.log(JSON.stringify(results));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
