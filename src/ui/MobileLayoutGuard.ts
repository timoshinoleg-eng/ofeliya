import Phaser from 'phaser';

const RESULT_BUTTONS = new Set(['ЕЩЁ ОДИН ЦИКЛ', 'БРОСИТЬ ВЫЗОВ', 'В МЕНЮ']);
const RESULT_TITLES = new Set(['ШТАММ УНИЧТОЖЕН', 'ИММУНИТЕТ ПОДАВЛЕН']);

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
  if (W <= 0) return;

  const texts = textObjects(scene);
  const signature = menuSignature(scene, texts);
  if (menuSignatures.get(scene) === signature) return;
  menuSignatures.set(scene, signature);

  for (const text of texts) {
    if (Math.abs(text.originX - 0.5) > 0.01) continue;
    fitToWidth(text, W - 24, 0.58);
  }

  const byExact = (value: string) => texts.find((text) => text.text === value);
  const title = byExact('OFELIYA');
  if (title) fitToWidth(title, W - 34, 0.58);

  const hook = texts.find((text) => text.text.startsWith('ОРГАНИЗМ ЕЩЁ НЕ ЗНАЕТ'));
  if (hook) fitToWidth(hook, W - 34, 0.68);

  const challengeHeader = byExact('ВЫЗОВ ПОЛУЧЕН');
  if (challengeHeader) fitToWidth(challengeHeader, Math.min(W - 64, 286), 0.72);

  const challengeMeta = texts.find((text) => /иммун\.\s*·.*клеток.*мутация/i.test(text.text));
  if (challengeMeta) fitToWidth(challengeMeta, Math.min(W - 64, 286), 0.64);

  const challengeTarget = texts.find(
    (text) => text.text.startsWith('Подави IMMUNE PRIME') || text.text.startsWith('Продержись дольше')
  );
  if (challengeTarget) fitToWidth(challengeTarget, Math.min(W - 64, 286), 0.64);

  const action = texts.find(
    (text) => text.text === 'ПРИНЯТЬ ВЫЗОВ' || text.text === 'НАЧАТЬ ЗАРАЖЕНИЕ'
  );
  if (action) fitToWidth(action, Math.min(W - 82, 258), 0.62);

  const actionHint = texts.find((text) => text.text.startsWith('атака автоматическая'));
  if (actionHint) fitToWidth(actionHint, W - 58, 0.68);
}

function resultContainer(scene: Phaser.Scene): Phaser.GameObjects.Container | null {
  for (const obj of scene.children.list) {
    if (!(obj instanceof Phaser.GameObjects.Container)) continue;
    const hasTitle = obj.list.some(
      (child) => child instanceof Phaser.GameObjects.Text && RESULT_TITLES.has(child.text.replace(/\n/g, ' '))
    );
    if (hasTitle) return obj;
  }
  return null;
}

function pairedButtonBackground(
  container: Phaser.GameObjects.Container,
  label: Phaser.GameObjects.Text
): Phaser.GameObjects.Rectangle | null {
  return (
    container.list.find(
      (obj): obj is Phaser.GameObjects.Rectangle =>
        obj instanceof Phaser.GameObjects.Rectangle &&
        !!obj.input?.enabled &&
        Math.abs(obj.y - label.y) < 1
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
  const title = texts.find((text) => RESULT_TITLES.has(text.text.replace(/\n/g, ' ')));
  const time = texts.find((text) => /^\d{2}:\d{2}$/.test(text.text));
  const stats = texts.find((text) => text.text.includes('Клеток:') && text.text.includes('Мутация:'));
  const buttonLabels = texts.filter((text) => RESULT_BUTTONS.has(text.text));

  if (!title || !time || !stats || buttonLabels.length !== 3) return;

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
        !RESULT_BUTTONS.has(text.text)
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
  const orderedButtons = ['ЕЩЁ ОДИН ЦИКЛ', 'БРОСИТЬ ВЫЗОВ', 'В МЕНЮ'];
  orderedButtons.forEach((label, index) => {
    const text = buttonLabels.find((item) => item.text === label);
    if (!text) return;
    const bg = pairedButtonBackground(container, text);
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
