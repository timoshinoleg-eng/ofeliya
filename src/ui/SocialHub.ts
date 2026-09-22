import Phaser from 'phaser';
import { COLORS, FONT, UI_FONT, UI_TEXT, fmtTime } from '../game/config';
import type { PlatformAdapter } from '../platform/PlatformBridge';
import {
  loadSocialSnapshotDetailed,
  type FriendSnapshot,
  type RemoteStatus,
  type SocialSnapshotDetailed,
  type SocialTopEntry,
} from '../systems/SocialClient';

const MAX_ROWS = 3;

function platformLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'max') return 'MAX';
  if (normalized === 'telegram') return 'Telegram';
  if (normalized === 'vk') return 'VK';
  if (normalized === 'browser') return 'БРАУЗЕР';
  return 'ДРУГАЯ ПЛАТФОРМА';
}

function relationLabel(value: FriendSnapshot['relation']): string {
  if (value === 'both') return 'ВЗАИМНО';
  if (value === 'inviter') return 'ВАС ПРИГЛАСИЛИ';
  return 'ПО ВАШЕМУ ПРИГЛАШЕНИЮ';
}

function errorCopy(status: RemoteStatus): string | null {
  if (status === 'network') return 'НЕТ СОЕДИНЕНИЯ · МОЖНО ПОВТОРИТЬ';
  if (status === 'http') return 'СЕРВЕР НЕ ОТВЕТИЛ · МОЖНО ПОВТОРИТЬ';
  return null;
}

function seasonRow(entry: SocialTopEntry): string {
  return `#${entry.rank} · ${platformLabel(entry.platform)} · ${fmtTime(entry.timeMs)} · УНИЧТОЖЕНО ${entry.kills}`;
}

function friendRow(entry: FriendSnapshot): string {
  return `${relationLabel(entry.relation)} · ${platformLabel(entry.platform)} · ${fmtTime(entry.timeMs)} · ${entry.kills}`;
}

export class SocialHub {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Container;
  private readonly panelTop: number;
  private readonly panelLeft: number;
  private readonly panelW: number;
  private readonly panelH: number;
  private closed = false;
  private loadGeneration = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly platform: PlatformAdapter,
    private readonly onDismiss: () => void
  ) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    this.panelW = Math.min(W - 22, 370);
    this.panelH = Math.min(H - 24, 620);
    this.panelTop = H / 2 - this.panelH / 2;
    this.panelLeft = W / 2 - this.panelW / 2;

    this.root = scene.add.container(0, 0).setDepth(46).setName('ofeliya-social-hub');
    const dim = scene.add
      .rectangle(W / 2, H / 2, W, H, 0x03040a, 0.96)
      .setInteractive()
      .setName('ofeliya-social-dim');
    const panel = scene.add
      .rectangle(W / 2, H / 2, this.panelW, this.panelH, 0x100d16, 0.995)
      .setStrokeStyle(2, COLORS.cyan, 0.72)
      .setName('ofeliya-social-panel');
    this.root.add([dim, panel]);

    this.root.add(
      scene.add
        .text(W / 2, this.panelTop + 24, 'СОЦИУМ', {
          fontFamily: FONT,
          fontSize: H < 650 ? '18px' : '21px',
          fontStyle: 'bold',
          color: '#fff4ec',
          letterSpacing: 1,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setName('ofeliya-social-title')
    );

    this.root.add(
      scene.add
        .text(W / 2, this.panelTop + 47, 'СЕГОДНЯ · СЕЗОН · ДРУЗЬЯ', {
          fontFamily: UI_FONT,
          fontSize: H < 650 ? '10px' : '11px',
          fontStyle: '700',
          color: '#b8f3ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const closeX = this.panelLeft + this.panelW - 25;
    const closeY = this.panelTop + 25;
    const closeHit = scene.add
      .rectangle(closeX, closeY, 44, 44, 0x000000, 0.001)
      .setInteractive({ useHandCursor: true })
      .setName('ofeliya-social-close-hit');
    const closeGlyph = scene.add
      .text(closeX, closeY - 1, '×', {
        fontFamily: FONT,
        fontSize: '27px',
        color: '#c89aaf',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-social-close-label');
    closeHit.on('pointerup', () => {
      this.platform.haptic('light');
      this.destroy();
    });
    this.root.add([closeHit, closeGlyph]);

    this.body = scene.add.container(0, 0).setName('ofeliya-social-body');
    this.root.add(this.body);

    this.platform.setBackHandler(() => this.destroy());
    this.renderLoading();
    void this.reload();
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.loadGeneration += 1;
    this.platform.setBackHandler(null);
    this.root.destroy(true);
    this.onDismiss();
  }

  private addText(
    x: number,
    y: number,
    value: string,
    size: number,
    color: string = UI_TEXT.primary,
    align: 'left' | 'center' = 'left',
    width: number = this.panelW - 34,
    name?: string
  ): Phaser.GameObjects.Text {
    const text = this.scene.add
      .text(x, y, value, {
        fontFamily: UI_FONT,
        fontSize: `${size}px`,
        fontStyle: '650',
        color,
        align,
        lineSpacing: 2,
        wordWrap: { width },
      })
      .setOrigin(align === 'center' ? 0.5 : 0, 0)
      .setResolution(2);
    if (name) text.setName(name);
    this.body.add(text);
    return text;
  }

  private sectionTitle(y: number, value: string, name: string): void {
    this.addText(
      this.panelLeft + 17,
      y,
      value,
      this.scene.scale.height < 650 ? 11 : 12,
      '#ffe066',
      'left',
      this.panelW - 34,
      name
    ).setFontStyle('700');
  }

  private renderLoading(): void {
    this.body.removeAll(true);
    const compact = this.scene.scale.height < 650;
    const left = this.panelLeft + 17;
    const width = this.panelW - 34;
    const todayY = this.panelTop + 70;
    this.sectionTitle(todayY, 'СЕГОДНЯ', 'ofeliya-social-today-title');
    this.addText(left, todayY + 22, 'ЗАГРУЗКА ЛИЧНОГО РЕЗУЛЬТАТА…', compact ? 10 : 11, UI_TEXT.secondary, 'left', width);
    this.addDisabledDailyButton(todayY + 48);

    const seasonY = todayY + 108;
    this.sectionTitle(seasonY, 'СЕЗОН', 'ofeliya-social-season-title');
    this.addText(left, seasonY + 22, 'ЗАГРУЗКА ТАБЛИЦЫ…', compact ? 10 : 11, UI_TEXT.secondary, 'left', width);

    const friendsY = seasonY + 128;
    this.sectionTitle(friendsY, 'ДРУЗЬЯ', 'ofeliya-social-friends-title');
    this.addText(left, friendsY + 22, 'ЗАГРУЗКА СВЯЗЕЙ…', compact ? 10 : 11, UI_TEXT.secondary, 'left', width);
  }

  private addDisabledDailyButton(y: number): void {
    const W = this.scene.scale.width;
    const buttonW = Math.min(this.panelW - 34, 310);
    const bg = this.scene.add
      .rectangle(W / 2, y, buttonW, 44, 0x1a1520, 0.94)
      .setStrokeStyle(1, COLORS.stroke, 0.72)
      .setName('ofeliya-social-daily-disabled');
    const label = this.scene.add
      .text(W / 2, y, 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · ПОКА НЕДОСТУПЕН', {
        fontFamily: FONT,
        fontSize: this.scene.scale.height < 650 ? '10px' : '11px',
        fontStyle: 'bold',
        color: '#a99eac',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-social-daily-label');
    this.body.add([bg, label]);
  }

  private channelLine(status: RemoteStatus, empty: string, skipped: string): string {
    const error = errorCopy(status);
    if (error) return error;
    if (status === 'skipped') return skipped;
    if (status === 'empty') return empty;
    return '';
  }

  private render(detail: SocialSnapshotDetailed): void {
    this.body.removeAll(true);
    const compact = this.scene.scale.height < 650;
    const left = this.panelLeft + 17;
    const width = this.panelW - 34;
    const rowSize = compact ? 9 : 10;
    const bodySize = compact ? 10 : 11;
    const todayY = this.panelTop + 70;

    this.sectionTitle(todayY, 'СЕГОДНЯ', 'ofeliya-social-today-title');
    const dailyError = errorCopy(detail.status.daily);
    let dailyLine = '';
    if (detail.status.daily === 'ok' && detail.snapshot.daily?.you) {
      const you = detail.snapshot.daily.you;
      const rank = detail.snapshot.daily.rank;
      dailyLine = `ВЫ · ${fmtTime(you.timeMs)} · УНИЧТОЖЕНО ${you.kills}${rank != null ? ` · МЕСТО #${rank}` : ''}`;
    } else if (detail.status.daily === 'ok') {
      dailyLine = 'СЕГОДНЯ РЕЗУЛЬТАТА ЕЩЁ НЕТ';
    } else {
      dailyLine =
        dailyError ??
        this.channelLine(
          detail.status.daily,
          'СЕГОДНЯ РЕЗУЛЬТАТА ЕЩЁ НЕТ',
          'ЛИЧНЫЙ РЕЗУЛЬТАТ ДОСТУПЕН ПОСЛЕ ВХОДА ЧЕРЕЗ MAX ИЛИ Telegram'
        );
    }
    this.addText(left, todayY + 22, dailyLine, bodySize, dailyError ? '#ffb095' : UI_TEXT.primary, 'left', width, 'ofeliya-social-today-status');
    this.addDisabledDailyButton(todayY + 48);

    const seasonY = todayY + 108;
    const seasonTitle =
      detail.status.season === 'ok' && detail.snapshot.season
        ? `СЕЗОН ${detail.snapshot.season.index} · ${detail.snapshot.season.daysLeft} ДН.`
        : 'СЕЗОН';
    this.sectionTitle(seasonY, seasonTitle, 'ofeliya-social-season-title');
    const seasonError = errorCopy(detail.status.seasonTop) ?? errorCopy(detail.status.season);
    if (seasonError) {
      this.addText(left, seasonY + 22, seasonError, bodySize, '#ffb095', 'left', width, 'ofeliya-social-season-status');
    } else if (detail.status.seasonTop === 'ok' && detail.snapshot.seasonTop.length > 0) {
      detail.snapshot.seasonTop.slice(0, MAX_ROWS).forEach((entry, index) => {
        this.addText(left, seasonY + 20 + index * 21, seasonRow(entry), rowSize, '#d8d1e2', 'left', width, `ofeliya-social-season-row-${index}`);
      });
      const hidden = detail.snapshot.seasonTop.length - MAX_ROWS;
      if (hidden > 0) {
        this.addText(left, seasonY + 83, `ЕЩЁ +${hidden}`, rowSize, UI_TEXT.secondary, 'left', width, 'ofeliya-social-season-more');
      }
    } else {
      this.addText(
        left,
        seasonY + 22,
        'В СЕЗОНЕ ПОКА НЕТ РЕЗУЛЬТАТОВ',
        bodySize,
        UI_TEXT.secondary,
        'left',
        width,
        'ofeliya-social-season-status'
      );
    }

    const friendsY = seasonY + 128;
    this.sectionTitle(friendsY, 'ДРУЗЬЯ', 'ofeliya-social-friends-title');
    const friendsError = errorCopy(detail.status.friends);
    if (friendsError) {
      this.addText(left, friendsY + 22, friendsError, bodySize, '#ffb095', 'left', width, 'ofeliya-social-friends-status');
    } else if (detail.status.friends === 'skipped') {
      this.addText(
        left,
        friendsY + 22,
        'ДРУЗЬЯ ДОСТУПНЫ ПОСЛЕ ВХОДА ЧЕРЕЗ MAX ИЛИ Telegram',
        bodySize,
        UI_TEXT.secondary,
        'left',
        width,
        'ofeliya-social-friends-status'
      );
    } else if (detail.status.friends === 'ok' && detail.snapshot.friends.length > 0) {
      detail.snapshot.friends.slice(0, MAX_ROWS).forEach((entry, index) => {
        this.addText(left, friendsY + 20 + index * 21, friendRow(entry), rowSize, '#d8d1e2', 'left', width, `ofeliya-social-friend-row-${index}`);
      });
      const hidden = detail.snapshot.friends.length - MAX_ROWS;
      if (hidden > 0) {
        this.addText(left, friendsY + 83, `ЕЩЁ +${hidden}`, rowSize, UI_TEXT.secondary, 'left', width, 'ofeliya-social-friends-more');
      }
    } else {
      this.addText(
        left,
        friendsY + 22,
        'ПОКА НЕТ РЕЗУЛЬТАТОВ ДРУЗЕЙ',
        bodySize,
        UI_TEXT.secondary,
        'left',
        width,
        'ofeliya-social-friends-status'
      );
    }

    const hasRetry = Object.values(detail.status).some((status) => status === 'network' || status === 'http');
    if (hasRetry) this.addRetryButton();
  }

  private addRetryButton(): void {
    const W = this.scene.scale.width;
    const y = this.panelTop + this.panelH - 31;
    const w = Math.min(this.panelW - 48, 230);
    const bg = this.scene.add
      .rectangle(W / 2, y, w, 44, 0x14212a, 0.97)
      .setStrokeStyle(1.5, COLORS.cyan, 0.82)
      .setInteractive({ useHandCursor: true })
      .setName('ofeliya-social-retry-bg');
    const label = this.scene.add
      .text(W / 2, y, 'ПОВТОРИТЬ ЗАГРУЗКУ', {
        fontFamily: FONT,
        fontSize: this.scene.scale.height < 650 ? '10px' : '11px',
        fontStyle: 'bold',
        color: '#c9f6ff',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-social-retry-label');
    bg.on('pointerup', () => {
      this.platform.haptic('light');
      void this.reload();
    });
    this.body.add([bg, label]);
  }

  private async reload(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.renderLoading();
    const detail = await loadSocialSnapshotDetailed(this.platform);
    if (this.closed || generation !== this.loadGeneration) return;
    this.render(detail);
  }
}
