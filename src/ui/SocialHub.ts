import Phaser from 'phaser';
import { FONT, UI_FONT, fmtTime } from '../game/config';
import type { PlatformAdapter } from '../platform/PlatformBridge';
import {
  loadSocialSnapshotDetailed,
  type FriendSnapshot,
  type RemoteStatus,
  type SocialSnapshotDetailed,
  type SocialTopEntry,
} from '../systems/SocialClient';
import type { DailyTicketStatus } from '../systems/DailyRunClient';
import { dailyStreakSummary } from '../systems/DailyHistory';
import { dailyPreviewTitle, dailyPreviewRefreshDelay } from './DailyPreview';
import { META_COPY, buildInviteText } from '../game/UiCopy';
import { fmtInt } from '../game/UiFormat';
import { VISUAL, VISUAL_TEXT } from './visualTokens';
import { createModalFrame } from './modal';
import { createSpecimenSurface } from './specimenSurface';

const MAX_ROWS = 3;

function platformLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'max') return 'MAX';
  if (normalized === 'telegram') return 'TG';
  if (normalized === 'vk') return 'VK';
  if (normalized === 'browser') return 'WEB';
  return 'ДРУГАЯ';
}

function relationLabel(value: FriendSnapshot['relation']): string {
  if (value === 'both') return 'ВЗАИМНО';
  if (value === 'inviter') return 'ВАС ПРИГЛАСИЛИ';
  return 'ВЫ ПРИГЛАСИЛИ';
}

/**
 * The error of a read-only surface.
 *
 * The rating surface reads the server; it does not hold the player's progress, so
 * it never promises that the progress is preserved.
 */
function errorCopy(status: RemoteStatus): string | null {
  if (status === 'network') return META_COPY.networkError;
  if (status === 'http') return 'Сервер не ответил';
  return null;
}

/**
 * Player rows of the tables.
 *
 * The social payload carries no display name, so the row names the platform
 * instead of inventing an identity.
 */
function seasonRow(entry: SocialTopEntry): string {
  return `#${entry.rank} · ${META_COPY.player(platformLabel(entry.platform))}\n${fmtTime(entry.timeMs)} · Уничтожено ${fmtInt(entry.kills)}`;
}

function friendRow(entry: FriendSnapshot): string {
  return `${relationLabel(entry.relation)} · ${META_COPY.player(platformLabel(entry.platform))}\n${fmtTime(entry.timeMs)} · Уничтожено ${fmtInt(entry.kills)}`;
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
  private refreshTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private lastDetail: SocialSnapshotDetailed | null = null;
  private dailyLaunchStatus: DailyTicketStatus | 'idle' | 'loading' = 'idle';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly platform: PlatformAdapter,
    private readonly onDailyLaunch: () => Promise<DailyTicketStatus>,
    private readonly onDismiss: () => void
  ) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    this.panelW = Math.min(W - 22, 400);
    this.panelH = Math.min(H - 24, 620);
    this.panelTop = H / 2 - this.panelH / 2;
    this.panelLeft = W / 2 - this.panelW / 2;

    this.root = scene.add.container(0, 0).setDepth(46).setName('ofeliya-social-hub');
    // The rating surface shares the frame of the other meta surfaces: one
    // scrim, one membrane, one centered title and one 44x44 close control.
    createModalFrame(scene, this.root, {
      x: W / 2,
      y: H / 2,
      width: this.panelW,
      height: this.panelH,
      title: META_COPY.rating,
      compact: H < 650,
      onClose: () => {
        this.platform.haptic('light');
        this.destroy();
      },
    });
    // The shared frame owns the title and the close control; the rating surface
    // keeps its own object names so the existing probes stay valid.
    const frameTitle = this.root.list.find((obj) => obj.name === 'ofeliya-modal-title');
    frameTitle?.setName('ofeliya-social-title');
    const closeHit = this.root.list.find((obj) => obj.name === 'ofeliya-modal-close-hit');
    closeHit?.setName('ofeliya-social-close-hit');
    const closeGlyph = this.root.list.find((obj) => obj.name === 'ofeliya-modal-close-label');
    closeGlyph?.setName('ofeliya-social-close-label');

    this.root.add(
      scene.add
        .text(W / 2, this.panelTop + 47, 'ЗАБЕГ ДНЯ · СЕЗОН · ДРУЗЬЯ', {
          fontFamily: UI_FONT,
          fontSize: '11px',
          fontStyle: '700',
          color: VISUAL_TEXT.host,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

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
    if (this.refreshTimer !== null) globalThis.clearTimeout(this.refreshTimer);
    this.platform.setBackHandler(null);
    this.root.destroy(true);
    this.onDismiss();
  }

  private addText(
    x: number,
    y: number,
    value: string,
    size: number,
    color: string = VISUAL_TEXT.ivory,
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
    this.body.add(createSpecimenSurface(
      this.scene, this.scene.scale.width / 2, y + 58, this.panelW - 20, 132,
      { accent: VISUAL.host, fill: VISUAL.ink, alpha: 0.58, detail: 'quiet' },
    ));
    this.addText(
      this.panelLeft + 17,
      y,
      value,
      this.scene.scale.height < 650 ? 11 : 12,
      VISUAL_TEXT.host,
      'left',
      this.panelW - 34,
      name
    ).setFontStyle('700');
  }

  private renderLoading(): void {
    this.body.removeAll(true);
    const left = this.panelLeft + 17;
    const width = this.panelW - 34;
    const todayY = this.panelTop + 70;
    this.sectionTitle(todayY, 'ЗАБЕГ ДНЯ', 'ofeliya-social-today-title');
    this.addText(left, todayY + 22, 'ЗАГРУЗКА ЛИЧНОГО РЕЗУЛЬТАТА…', 11, VISUAL_TEXT.muted, 'left', width);
    this.addDailyButton(todayY + 74, true);

    const seasonY = todayY + 136;
    this.sectionTitle(seasonY, 'СЕЗОН', 'ofeliya-social-season-title');
    this.addText(left, seasonY + 22, 'ЗАГРУЗКА ТАБЛИЦЫ…', 11, VISUAL_TEXT.muted, 'left', width);

    const friendsY = seasonY + 136;
    this.sectionTitle(friendsY, 'ДРУЗЬЯ', 'ofeliya-social-friends-title');
    this.addText(left, friendsY + 22, 'ЗАГРУЗКА СВЯЗЕЙ…', 11, VISUAL_TEXT.muted, 'left', width);
  }

  private canLaunchDaily(): boolean {
    return (
      (this.platform.kind === 'max' || this.platform.kind === 'telegram') &&
      Boolean(this.platform.initData)
    );
  }

  private dailyButtonState(loadingView: boolean): {
    label: string;
    enabled: boolean;
    color: string;
    fill: number;
    stroke: number;
  } {
    if (loadingView || this.dailyLaunchStatus === 'loading') {
      return {
        label: 'ПОЛУЧАЕМ ЗАБЕГ ДНЯ…',
        enabled: false,
        color: VISUAL_TEXT.muted,
        fill: VISUAL.panelRaised,
        stroke: VISUAL.line,
      };
    }
    if (!this.canLaunchDaily() || this.dailyLaunchStatus === 'unavailable') {
      return {
        label: 'НУЖЕН ВХОД ЧЕРЕЗ MAX ИЛИ TG',
        enabled: false,
        color: VISUAL_TEXT.muted,
        fill: VISUAL.panelRaised,
        stroke: VISUAL.line,
      };
    }
    if (this.dailyLaunchStatus === 'denied') {
      return {
        label: 'НУЖЕН ПОДТВЕРЖДЁННЫЙ ВХОД',
        enabled: false,
        color: VISUAL_TEXT.danger,
        fill: VISUAL.panelRaised,
        stroke: VISUAL.line,
      };
    }
    if (this.dailyLaunchStatus === 'incompatible') {
      return {
        label: 'ОБНОВИТЕ ИГРУ И ПОВТОРИТЕ',
        enabled: false,
        color: VISUAL_TEXT.danger,
        fill: VISUAL.panelRaised,
        stroke: VISUAL.line,
      };
    }
    if (this.dailyLaunchStatus === 'capacity') {
      return {
        label: 'ЗАБЕГ НЕДОСТУПЕН · ПОВТОРИТЬ',
        enabled: true,
        color: VISUAL_TEXT.warning,
        fill: VISUAL.panelRaised,
        stroke: VISUAL.warning,
      };
    }
    if (this.dailyLaunchStatus === 'http') {
      return {
        label: 'СЕРВЕР НЕ ОТВЕТИЛ · ПОВТОРИТЬ',
        enabled: true,
        color: VISUAL_TEXT.danger,
        fill: VISUAL.panelRaised,
        stroke: VISUAL.danger,
      };
    }
    if (this.dailyLaunchStatus === 'network') {
      return {
        label: 'НЕТ СОЕДИНЕНИЯ · ПОВТОРИТЬ',
        enabled: true,
        color: VISUAL_TEXT.danger,
        fill: VISUAL.panelRaised,
        stroke: VISUAL.danger,
      };
    }
    return {
      label: 'НАЧАТЬ ЕЖЕДНЕВНЫЙ ЗАБЕГ',
      enabled: true,
      color: '#080f14',
      fill: VISUAL.ivory,
      stroke: VISUAL.host,
    };
  }

  private addDailyButton(y: number, loadingView = false): void {
    const W = this.scene.scale.width;
    const buttonW = Math.min(this.panelW - 34, 310);
    const state = this.dailyButtonState(loadingView);
    const bg = this.scene.add
      .rectangle(W / 2, y, buttonW, 44, state.fill, 0.97)
      .setStrokeStyle(state.enabled ? 1.5 : 1, state.stroke, state.enabled ? 0.84 : 0.72)
      .setName(state.enabled ? 'ofeliya-social-daily-bg' : 'ofeliya-social-daily-disabled');
    if (state.enabled) {
      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        void this.startDaily();
      });
    }
    const label = this.scene.add
      .text(W / 2, y, state.label, {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: state.color,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-social-daily-label');
    const mutatorText = this.scene.add
      .text(W / 2, y + 28, dailyPreviewTitle(loadingView ? null : this.lastDetail?.snapshot.daily ?? null), {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setAlpha(0.92)
      .setName('ofeliya-social-daily-mutator');
    this.body.add([bg, label, mutatorText]);
    const streak = dailyStreakSummary();
    // A zero streak is an empty state, not a counter that reads "СЕРИЯ 0".
    if (streak.current > 0 || streak.best > 0) {
      const streakText = this.scene.add
        .text(W / 2, y + 43, streak.current > 0 ? `СЕРИЯ ${streak.current} · РЕКОРД ${streak.best}` : META_COPY.streakEmpty, {
          fontFamily: FONT,
          fontSize: '11px',
          fontStyle: 'bold',
          color: VISUAL_TEXT.host,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setName('ofeliya-social-daily-streak');
      this.body.add(streakText);
    }
  }

  private async startDaily(): Promise<void> {
    if (this.closed || this.dailyLaunchStatus === 'loading' || !this.canLaunchDaily()) return;
    this.platform.haptic('medium');
    this.dailyLaunchStatus = 'loading';
    if (this.lastDetail) this.render(this.lastDetail);
    const status = await this.onDailyLaunch();
    if (this.closed) return;
    if (status === 'ok') return;
    this.dailyLaunchStatus = status;
    if (this.lastDetail) this.render(this.lastDetail);
  }

  private channelLine(status: RemoteStatus, empty: string, skipped: string): string {
    const error = errorCopy(status);
    if (error) return error;
    if (status === 'skipped') return skipped;
    if (status === 'empty') return empty;
    return '';
  }

  private render(detail: SocialSnapshotDetailed): void {
    this.lastDetail = detail;
    this.body.removeAll(true);
    const left = this.panelLeft + 17;
    const width = this.panelW - 34;
    const rowSize = 11;
    const bodySize = 11;
    const todayY = this.panelTop + 70;

    this.sectionTitle(todayY, 'ЗАБЕГ ДНЯ', 'ofeliya-social-today-title');
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
    this.addText(left, todayY + 22, dailyLine, bodySize, dailyError ? VISUAL_TEXT.danger : VISUAL_TEXT.ivory, 'left', width, 'ofeliya-social-today-status');
    this.addDailyButton(todayY + 74);

    const seasonY = todayY + 136;
    const seasonTitle =
      detail.status.season === 'ok' && detail.snapshot.season
        ? `СЕЗОН ${detail.snapshot.season.index} · ${detail.snapshot.season.daysLeft} ДН.`
        : 'СЕЗОН';
    this.sectionTitle(seasonY, seasonTitle, 'ofeliya-social-season-title');
    const seasonError = errorCopy(detail.status.seasonTop) ?? errorCopy(detail.status.season);
    if (seasonError) {
      this.addText(left, seasonY + 22, seasonError, bodySize, VISUAL_TEXT.danger, 'left', width, 'ofeliya-social-season-status');
    } else if (detail.status.seasonTop === 'ok' && detail.snapshot.seasonTop.length > 0) {
      detail.snapshot.seasonTop.slice(0, MAX_ROWS).forEach((entry, index) => {
        this.addText(left, seasonY + 20 + index * 32, seasonRow(entry), rowSize, VISUAL_TEXT.ivory, 'left', width, `ofeliya-social-season-row-${index}`);
      });
      const hidden = detail.snapshot.seasonTop.length - MAX_ROWS;
      if (hidden > 0) {
        this.addText(left, seasonY + 116, `ЕЩЁ +${hidden}`, rowSize, VISUAL_TEXT.muted, 'left', width, 'ofeliya-social-season-more');
      }
    } else {
      this.addText(
        left,
        seasonY + 22,
        'В СЕЗОНЕ ПОКА НЕТ РЕЗУЛЬТАТОВ',
        bodySize,
        VISUAL_TEXT.muted,
        'left',
        width,
        'ofeliya-social-season-status'
      );
    }

    const friendsY = seasonY + 136;
    this.sectionTitle(friendsY, 'ДРУЗЬЯ', 'ofeliya-social-friends-title');
    const friendsError = errorCopy(detail.status.friends);
    if (friendsError) {
      this.addText(left, friendsY + 22, friendsError, bodySize, VISUAL_TEXT.danger, 'left', width, 'ofeliya-social-friends-status');
    } else if (detail.status.friends === 'skipped') {
      this.addText(
        left,
        friendsY + 22,
        'ДРУЗЬЯ ДОСТУПНЫ ПОСЛЕ ВХОДА ЧЕРЕЗ MAX ИЛИ Telegram',
        bodySize,
        VISUAL_TEXT.muted,
        'left',
        width,
        'ofeliya-social-friends-status'
      );
    } else if (detail.status.friends === 'ok' && detail.snapshot.friends.length > 0) {
      detail.snapshot.friends.slice(0, MAX_ROWS).forEach((entry, index) => {
        this.addText(left, friendsY + 20 + index * 32, friendRow(entry), rowSize, VISUAL_TEXT.ivory, 'left', width, `ofeliya-social-friend-row-${index}`);
      });
      const hidden = detail.snapshot.friends.length - MAX_ROWS;
      if (hidden > 0) {
        this.addText(left, friendsY + 116, `ЕЩЁ +${hidden}`, rowSize, VISUAL_TEXT.muted, 'left', width, 'ofeliya-social-friends-more');
      }
    } else {
      this.addText(
        left,
        friendsY + 22,
        META_COPY.friendsEmpty,
        bodySize,
        VISUAL_TEXT.muted,
        'left',
        width,
        'ofeliya-social-friends-status'
      );
      this.addInviteButton(friendsY + 74);
    }

    const hasRetry = Object.values(detail.status).some((status) => status === 'network' || status === 'http');
    if (hasRetry) this.addRetryButton();
  }

  /**
   * The invite action of the empty friends list.
   *
   * It uses the existing messenger share: no referral system, no reward.
   */
  private addInviteButton(y: number): void {
    const W = this.scene.scale.width;
    const buttonW = Math.min(this.panelW - 34, 310);
    const bg = this.scene.add
      .rectangle(W / 2, y, buttonW, 44, VISUAL.panelRaised, 0.97)
      .setStrokeStyle(1, VISUAL.host, 0.82)
      .setName('ofeliya-social-invite-bg');
    const label = this.scene.add
      .text(W / 2, y, META_COPY.inviteFriends, {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-social-invite-label');
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerup', () => {
      this.platform.haptic('light');
      void this.platform.shareResult(buildInviteText()).then((ok) => {
        if (!ok) this.addText(W / 2, y + 30, 'Нативный шаринг недоступен в этом клиенте', 11, VISUAL_TEXT.muted);
      });
    });
    this.body.add([bg, label]);
  }

  private addRetryButton(): void {
    const W = this.scene.scale.width;
    const y = this.panelTop + this.panelH - 31;
    const w = Math.min(this.panelW - 48, 230);
    const bg = this.scene.add
      .rectangle(W / 2, y, w, 44, VISUAL.panelRaised, 0.97)
      .setStrokeStyle(1, VISUAL.host, 0.82)
      .setInteractive({ useHandCursor: true })
      .setName('ofeliya-social-retry-bg');
    const label = this.scene.add
      .text(W / 2, y, META_COPY.retry, {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
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
    if (this.refreshTimer !== null) globalThis.clearTimeout(this.refreshTimer);
    const generation = ++this.loadGeneration;
    this.renderLoading();
    const detail = await loadSocialSnapshotDetailed(this.platform);
    if (this.closed || generation !== this.loadGeneration) return;
    this.render(detail);
    this.refreshTimer = globalThis.setTimeout(() => { void this.reload(); }, dailyPreviewRefreshDelay(detail.snapshot.daily));
  }
}
