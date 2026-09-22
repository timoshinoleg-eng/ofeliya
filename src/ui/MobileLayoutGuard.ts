import Phaser from 'phaser';

const menuSignatures = new WeakMap<Phaser.Scene, string>();
const laidOutResults = new WeakSet<Phaser.GameObjects.Container>();

function textObjects(scene: Phaser.Scene): Phaser.GameObjects.Text[] {
  return scene.children.list.filter(
    (obj): obj is Phaser.GameObjects.Text => obj instanceof Phaser.GameObjects.Text
  );
}

function fitToWidth(text: Phaser.GameObjects.Text, maxWidth: number, minScale = 0.62): void {
  text.setScale(1);
  const width = text.getBounds().width;
  if (!Number.isFinite(width) || width <= maxWidth || width <= 0) return;
  const scale = Math.max(minScale, maxWidth / width);
  text.setScale(scale);
}

function menuSignature(scene: Phaser.Scene, texts: Phaser.GameObjects.Text[]): string {
  return `${scene.scale.width}x${scene.scale.height}:${texts
    .map((text) => `${text.text}:${Math.round(text.width)}`)
    .join('|')}`;
}

function guardMenu(scene: Phaser.Scene): void {
  const W = scene.scale.width;
  const H = scene.scale.height;
  if (W <= 0 || H <= 0) return;

  const texts = textObjects(scene);
  const signature = menuSignature(scene, texts);
  if (menuSignatures.get(scene) === signature) return;
  menuSignatures.set(scene, signature);

  for (const text of texts) {
    if (Math.abs(text.originX - 0.5) > 0.01) continue;
    fitToWidth(text, W - 24, 0.58);
  }

  const byName = (name: string) => texts.find((text) => text.name === name);
  const title = byName('ofeliya-menu-title');
  if (title) fitToWidth(title, W - 34, 0.58);

  const hook = byName('ofeliya-menu-hook');
  if (hook) fitToWidth(hook, W - 34, 0.68);

  const subtitle = byName('ofeliya-menu-subtitle');
  const carrier = byName('ofeliya-menu-carrier');
  // The carrier greeting is useful context, not a release-critical control. On short MAX
  // viewports it competes with the challenge card, so omit it instead of shrinking every
  // important challenge label into unreadable text.
  if (carrier && H < 680) carrier.setVisible(false);
  if (hook && subtitle && H < 620) {
    const subtitleHalf = subtitle.getBounds().height / 2;
    subtitle.setY(hook.getBounds().bottom + 12 + subtitleHalf);
  }

  const challengeHeader = byName('ofeliya-menu-challenge-header');
  if (challengeHeader) fitToWidth(challengeHeader, Math.min(W - 64, 286), 0.72);

  const challengeMeta = byName('ofeliya-menu-challenge-meta');
  if (challengeMeta) fitToWidth(challengeMeta, Math.min(W - 64, 286), 0.64);

  const challengeTarget = byName('ofeliya-menu-challenge-target');
  if (challengeTarget) fitToWidth(challengeTarget, Math.min(W - 64, 286), 0.64);

  const action = byName('ofeliya-menu-action');
  if (action) fitToWidth(action, Math.min(W - 82, 258), 0.62);

  const actionHint = byName('ofeliya-menu-action-hint');
  if (actionHint) fitToWidth(actionHint, W - 58, 0.68);
}

function resultContainer(scene: Phaser.Scene): Phaser.GameObjects.Container | null {
  return (
    scene.children.list.find(
      (obj): obj is Phaser.GameObjects.Container =>
        obj instanceof Phaser.GameObjects.Container && obj.name === 'ofeliya-result'
    ) ?? null
  );
}

function guardGameOver(scene: Phaser.Scene): void {
  const container = resultContainer(scene);
  if (!container || laidOutResults.has(container)) return;
  laidOutResults.add(container);

  const W = scene.scale.width;
  const H = scene.scale.height;
  if (W <= 0 || H <= 0) return;

  const texts = container.list.filter(
    (obj): obj is Phaser.GameObjects.Text => obj instanceof Phaser.GameObjects.Text
  );
  const byName = (name: string) => texts.find((text) => text.name === name);
  const rectByName = (name: string) =>
    container.list.find(
      (obj): obj is Phaser.GameObjects.Rectangle =>
        obj instanceof Phaser.GameObjects.Rectangle && obj.name === name
    ) ?? null;

  const title = byName('ofeliya-result-title');
  const time = byName('ofeliya-result-time');
  const stats = byName('ofeliya-result-stats');
  const retryButton = byName('ofeliya-result-retry-label');
  const shareButton = byName('ofeliya-result-share-label');
  const menuButton = byName('ofeliya-result-menu-label');

  if (!title || !time || !stats || !retryButton || !shareButton || !menuButton) return;
  const buttonLabels = [retryButton, shareButton, menuButton];

  if (W < 420 && !title.text.includes('\n')) {
    title.setText(title.text.replace(' ', '\n')).setAlign('center').setLineSpacing(0);
  }
  fitToWidth(title, W - 32, 0.72);
  fitToWidth(time, W - 52, 0.72);

  if (!stats.text.includes('\n')) {
    stats.setText(stats.text.replace(/\s+·\s+/g, '\n')).setAlign('center').setLineSpacing(1);
  }
  fitToWidth(stats, W - 44, 0.82);

  const titleY = Math.max(58, H * 0.1);
  title.setPosition(W / 2, titleY);

  const timeHalfHeight = time.getBounds().height / 2;
  time.setPosition(W / 2, title.getBounds().bottom + Math.max(12, H * 0.014) + timeHalfHeight);

  const statsHalfHeight = stats.getBounds().height / 2;
  stats.setPosition(W / 2, time.getBounds().bottom + Math.max(10, H * 0.012) + statsHalfHeight);

  const details = texts
    .filter(
      (text) =>
        text !== title &&
        text !== time &&
        text !== stats &&
        !buttonLabels.includes(text)
    )
    .sort((a, b) => a.y - b.y);

  let cursor = stats.getBounds().bottom + 14;
  const detailsBottomLimit = H - 205;
  for (const detail of details) {
    fitToWidth(detail, W - 38, 0.7);
    const halfHeight = detail.getBounds().height / 2;
    detail.setPosition(W / 2, cursor + halfHeight);
    cursor = detail.getBounds().bottom + 7;
  }

  if (cursor > detailsBottomLimit && details.length > 0) {
    const top = stats.getBounds().bottom + 12;
    const naturalHeight = cursor - top;
    const availableHeight = Math.max(80, detailsBottomLimit - top);
    const compactScale = Math.max(0.72, Math.min(1, availableHeight / naturalHeight));
    cursor = top;
    for (const detail of details) {
      detail.setScale(detail.scaleX * compactScale, detail.scaleY * compactScale);
      const halfHeight = detail.getBounds().height / 2;
      detail.setPosition(W / 2, cursor + halfHeight);
      cursor = detail.getBounds().bottom + 5;
    }
  }

  const buttonYs = [H - 166, H - 112, H - 58];
  const buttonRows = [
    { text: retryButton, bg: rectByName('ofeliya-result-retry-bg') },
    { text: shareButton, bg: rectByName('ofeliya-result-share-bg') },
    { text: menuButton, bg: rectByName('ofeliya-result-menu-bg') },
  ];
  buttonRows.forEach(({ text, bg }, index) => {
    const y = buttonYs[index];
    text.setPosition(W / 2, y);
    fitToWidth(text, Math.min(W - 78, 208), 0.68);
    bg?.setPosition(W / 2, y);
    if (bg && bg.width > W - 48) bg.setSize(W - 48, bg.height);
  });
}

export function installMobileLayoutGuard(game: Phaser.Game): void {
  const apply = (): void => {
    const menu = game.scene.getScene('Menu');
    if (menu) guardMenu(menu);
    const ui = game.scene.getScene('UI');
    if (ui) guardGameOver(ui);
  };

  game.events.on('poststep', apply);
  apply();
}