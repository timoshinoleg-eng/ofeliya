// Mechanic-only fixture. Natural startup/progression is tested separately.
// Do not stub update(), wave(), enemy behavior or the runtime clock.
async function installCombatFixture(page, { isolateStageResets = false } = {}) {
  await page.evaluate(({ isolateStageResets }) => {
    const gs = window.__game.scene.getScene('Game');
    const originalCreate = gs.create;
    if (gs.__combatFixturePending) throw new Error('combat fixture already pending');
    gs.__combatFixturePending = true;
    gs.create = function (...args) {
      this.create = originalCreate;
      this.__combatFixturePending = false;
      originalCreate.apply(this, args);
      if (this.awaitingChoice || window.__game.scene.getScene('UI')?.modalOpen) {
        throw new Error('unexpected modal before first combat fixture update');
      }
      // Only unrelated XP progression is isolated. Boss/legendary scripted choices remain real.
      this.runState.stage.xp = 0;
      this.runState.stage.xpNext = 1_000_000;
      this.queuedLevels = 0;
      if (isolateStageResets) {
        const reset = this.runState.resetStageProgression;
        this.runState.resetStageProgression = function (...args) {
          const result = reset.apply(this, args);
          this.stage.xp = 0;
          this.stage.xpNext = 1_000_000;
          return result;
        };
      }
      this.__combatFixture = { applied: true, beforeFirstUpdate: true };
    };
  }, { isolateStageResets });
}
async function startCombatFixture(page, options) {
  await installCombatFixture(page, options);
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
}
module.exports = { installCombatFixture, startCombatFixture };
