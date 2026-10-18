// rAF cadence only: includes browser/OS scheduling, not GPU execution time.
const SAMPLE_POLICY = Object.freeze({ warmupFrames: 10, minSamples: 60, minWindowMs: 1000, timeoutMs: 30000 });

// Linear interpolation at (n - 1) * p; callers supply validated, sorted data.
function percentile(sorted, p) {
  if (!sorted.length || !Number.isFinite(p) || p < 0 || p > 1 ||
      sorted.some((value, i) => !Number.isFinite(value) || (i > 0 && value < sorted[i - 1]))) {
    throw new Error('invalid percentile input');
  }
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

function summarize(intervals, policy = SAMPLE_POLICY) {
  if (intervals.length < policy.minSamples || intervals.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('insufficient or invalid consecutive rAF intervals');
  }
  const windowMs = intervals.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(windowMs) || windowMs < policy.minWindowMs) throw new Error('invalid sample window');
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    sampleCount: intervals.length,
    windowMs,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    over33_3MsRatio: intervals.filter(value => value > 33.3).length / intervals.length,
  };
}

// Serialized by Playwright page.evaluate: no Node/module closures allowed here.
function collectFrameCadence({ policy, renderer, tier, enemyCount }) {
  return new Promise((resolve, reject) => {
    let raf;
    let timer;
    let warmup = policy.warmupFrames;
    let previous;
    let windowMs = 0;
    const intervals = [];
    const finish = (error) => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      if (error) reject(error);
      else resolve(intervals);
    };
    const visibility = () => finish(new Error('cadence page visibility changed'));
    document.addEventListener('visibilitychange', visibility);
    timer = setTimeout(() => finish(new Error('cadence sample timed out')), policy.timeoutMs);
    const frame = (timestamp) => {
      try {
        const game = window.__game;
        const gs = game?.scene.getScene('Game');
        const canvas = game?.canvas;
        if (document.visibilityState !== 'visible' || !canvas?.isConnected ||
            canvas.width <= 0 || canvas.height <= 0 || !game.loop.running ||
            !game.scene.isActive('Game') || !game.scene.isActive('UI') || gs.awaitingChoice ||
            gs.registry.get('performanceTier') !== tier ||
            game.renderer.type !== (renderer === 'canvas' ? 1 : 2) ||
            gs.enemies.getChildren().filter(enemy => enemy.active).length !== enemyCount) {
          throw new Error('cadence fixture is not ready/stable');
        }
        // Warmup callbacks and the initial timestamp are never measured intervals.
        if (warmup > 0) warmup--;
        else {
          if (previous !== undefined) {
            const interval = timestamp - previous;
            if (!Number.isFinite(interval) || interval <= 0) throw new Error('invalid rAF timestamp interval');
            intervals.push(interval);
            windowMs += interval;
          }
          previous = timestamp;
          if (intervals.length >= policy.minSamples && windowMs >= policy.minWindowMs) {
            finish();
            return;
          }
        }
        raf = requestAnimationFrame(frame);
      } catch (error) { finish(error); }
    };
    raf = requestAnimationFrame(frame);
  });
}

module.exports = { SAMPLE_POLICY, percentile, summarize, collectFrameCadence };
