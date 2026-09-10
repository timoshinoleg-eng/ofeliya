import Phaser from 'phaser';
import { COLORS, FONT, fmtTime } from '../game/config';
import { IDENTITY } from '../game/identity';
import { META_UPGRADES, buyMeta, metaCost, metaLevel } from '../game/MetaSystem';
import { todayKey } from '../game/SeededRng';
import { Analytics } from '../systems/Analytics';
import { MessengerBridge } from '../systems/MessengerBridge';
import { SafeArea } from '../systems/SafeArea';
import { SaveSystem } from '../systems/SaveSystem';
import { Sfx } from '../systems/Sfx';
import { ServerClient } from '../systems/ServerClient';

export class MenuScene extends Phaser.Scene {
  /** K1: открытый ли мета-шоп (модалка). */
  private metaShop: Phaser.GameObjects.Container | null = null;
  /** K1: лейбл баланса осколков в меню (обновляем после покупки). */
  private metaTextRef: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Menu');
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 620;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.cameras.main.fadeIn(320, 11, 14, 26);
    Sfx.stopMusic();
    MessengerBridge.setBackHandler(null);
    Analytics.track('open', { platform: MessengerBridge.kind });

    const grid = this.add
      .tileSprite(0, 0, W, H, 'grid')
      .setOrigin(0)
      .setDepth(-10);
    grid.tilePositionX = 40;
    grid.tilePositionY = 90;
    this.add.image(W / 2, H / 2, 'vignette').setDisplaySize(W * 1.25, H * 1.25).setDepth(-9);

    const decor = [
      { tex: 'enemy-swarm', x: 0.16, y: 0.3 },
      { tex: 'enemy-runner', x: 0.86, y: 0.24 },
      { tex: 'enemy-brute', x: 0.78, y: 0.78 },
      { tex: 'gem', x: 0.12, y: 0.72 },
    ];
    decor.forEach((d, i) => {
      const s = this.add
        .image(W * d.x, H * d.y, d.tex)
        .setAlpha(0.3)
        .setAngle(Phaser.Math.Between(-15, 15));
      this.tweens.add({
        targets: s,
        y: s.y + Phaser.Math.Between(-14, 14),
        angle: s.angle + Phaser.Math.Between(-12, 12),
        duration: 2200 + i * 350,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    });

    const title = this.add
      .text(W / 2, H * (compact ? 0.12 : 0.15), 'OFELIYA', {
        fontFamily: FONT,
        fontSize: compact ? '46px' : '54px',
        fontStyle: 'bold',
        color: '#35e0ff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    title.setShadow(0, 0, 'rgba(53,224,255,0.85)', 22, true, true);

    this.add
      .text(
        W / 2,
        H * (compact ? 0.12 : 0.15) + (compact ? 38 : 44),
        IDENTITY.copy.menuTagline,
        { fontFamily: FONT, fontSize: '13px', color: '#aab4d4' }
      )
      .setOrigin(0.5)
      .setResolution(2);

    // Персонализация (приветствие + deep-link) — после готовности моста:
    // MAX/TG/браузер сразу, VK — после VKWebAppInit (user/start_param асинхронны).
    void MessengerBridge.whenReady().then(() => this.personalize());

    const save = SaveSystem.get();
    const survival = save.bestSurvivalMs > 0 ? fmtTime(save.bestSurvivalMs) : '—';
    const victory = save.bestWinTimeMs > 0 ? fmtTime(save.bestWinTimeMs) : '—';
    const records =
      save.runs > 0
        ? `Выживание ${survival}   ·   Победа ${victory}\nОчищено ${save.bestKills}   ·   Ядро ${save.bestLevel}`
        : IDENTITY.copy.firstRun;
    this.add
      .text(W / 2, H * (compact ? 0.3 : 0.33), records, {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#e8f4ff',
        align: 'center',
        lineSpacing: 5,
      })
      .setOrigin(0.5)
      .setResolution(2);

    // — Ежедневное испытание: один сид на всех, результаты сравнимы, стрики.
    const today = todayKey();
    const daily = save.daily;
    const dailyLines: string[] = [`📅 ЕЖЕДНЕВНОЕ ${today.slice(5).replace('-', '.')}`];
    if (daily.streak > 0) dailyLines.push(`🔥 стрик ${daily.streak}`);
    if (daily.dateKey === today && (daily.timeMs > 0 || daily.kills > 0)) {
      dailyLines.push(`сегодня: ${daily.win ? '🏆' : '⏱'} ${fmtTime(daily.timeMs)}`);
    }
    this.add
      .text(W / 2, H * (compact ? 0.41 : 0.435), dailyLines.join('  ·  '), {
        fontFamily: FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#73eaff',
      })
      .setOrigin(0.5)
      .setResolution(2);

    const btnY = H * (compact ? 0.53 : 0.56);
    const btnBg = this.add
      .rectangle(W / 2, btnY, 250, 58, COLORS.cyan, 0.16)
      .setStrokeStyle(2, COLORS.cyan, 1);
    this.add
      .text(W / 2, btnY, 'ЗАПУСТИТЬ ЯДРО', {
        fontFamily: FONT,
        fontSize: '19px',
        fontStyle: 'bold',
        color: '#35e0ff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    btnBg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.startRun(false));
    btnBg.on('pointerover', () => btnBg.setFillStyle(COLORS.cyan, 0.28));
    btnBg.on('pointerout', () => btnBg.setFillStyle(COLORS.cyan, 0.16));

    // Второстепенные кнопки в ряд: daily + мета-шоп (K1) + звук (все ≥ 44×44).
    const rowY = btnY + (compact ? 44 : 50);
    const dailyBg = this.add
      .rectangle(W / 2 - 124, rowY, 144, 44, COLORS.panel, 0.95)
      .setStrokeStyle(2, COLORS.cyan, 0.7);
    this.add
      .text(W / 2 - 124, rowY, 'ЕЖЕДНЕВНОЕ', {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#73eaff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    dailyBg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.startRun(true));
    dailyBg.on('pointerover', () => dailyBg.setFillStyle(COLORS.panelHover, 1));
    dailyBg.on('pointerout', () => dailyBg.setFillStyle(COLORS.panel, 0.95));

    const metaBg = this.add
      .rectangle(W / 2 + 28, rowY, 144, 44, COLORS.panel, 0.95)
      .setStrokeStyle(2, COLORS.gold, 0.75);
    const metaText = this.add
      .text(W / 2 + 28, rowY, `ЯДРО · ⬢ ${save.shards}`, {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setResolution(2);
    metaBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      this.openMetaShop();
    });
    metaBg.on('pointerover', () => metaBg.setFillStyle(COLORS.panelHover, 1));
    metaBg.on('pointerout', () => metaBg.setFillStyle(COLORS.panel, 0.95));
    this.metaTextRef = metaText; // обновляется после покупки (closeMetaShop)

    const soundBg = this.add
      .rectangle(W / 2 + 130, rowY, 44, 44, COLORS.panel, 0.95)
      .setStrokeStyle(2, COLORS.stroke, 1);
    const soundText = this.add
      .text(W / 2 + 130, rowY, Sfx.muted ? '🔇' : '🔊', {
        fontFamily: FONT,
        fontSize: '18px',
      })
      .setOrigin(0.5)
      .setResolution(2);
    soundBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      const muted = Sfx.toggle();
      soundText.setText(muted ? '🔇' : '🔊');
      if (!muted) Sfx.play('click');
    });

    // Локальный топ-3: витрина «с чем ты соревнуешься».
    if (!compact && save.leaderboard.length > 0) {
      const top = save.leaderboard.slice(0, 3);
      const lbY = rowY + (compact ? 0 : 46);
      this.add
        .text(
          W / 2,
          lbY,
          top
            .map(
              (e, i) =>
                `${i + 1}. ${fmtTime(e.timeMs)} · ${e.kills}${e.win ? ' · 🏆' : ''}${e.daily ? ' · 📅' : ''}`
            )
            .join('\n'),
          {
            fontFamily: FONT,
            fontSize: '12px',
            color: '#aab4d4',
            align: 'center',
            lineSpacing: 4,
          }
        )
        .setOrigin(0.5, 0)
        .setResolution(2);
    }

    // Глобальный топ-3 (с сервера, V3) + сезон (C5): витрина «с кем ты
    // соревнуешься». Асинхронно; если сервер недоступен — блок не показываем.
    // Топ — сезонный (честная конкуренция внутри окна, сброс между сезонами).
    if (!compact && ServerClient.enabled) {
      const hasLocal = save.leaderboard.length > 0;
      const gy = rowY + (hasLocal ? 88 : 46);
      void Promise.all([ServerClient.getSeason(), ServerClient.getTop('season')]).then(
        ([season, entries]) => {
          if (!this.scene.isActive()) return;
          const lines: string[] = [];
          if (season) lines.push(`🏆 СЕЗОН ${season.index} · ${season.daysLeft} дн до конца`);
          if (entries && entries.length > 0) {
            const mark = (p: string) =>
              p === 'telegram' ? '✈' : p === 'max' ? '✉' : p === 'vk' ? '📱' : '🖥';
            lines.push(
              ...entries
                .slice(0, 3)
                .map((e) => `${e.rank}. ${mark(e.platform)} ${fmtTime(e.timeMs)} · ${e.kills}${e.win ? ' · 🏆' : ''}`)
            );
          }
          if (lines.length === 0) return;
          this.add
            .text(W / 2, gy, lines.join('\n'), {
              fontFamily: FONT,
              fontSize: '12px',
              color: '#7f8bb0',
              align: 'center',
              lineSpacing: 4,
            })
            .setOrigin(0.5, 0)
            .setResolution(2);
        }
      );
    }

    const sb = SafeArea.bottom;
    this.add
      .text(W / 2, H - 52 - sb, IDENTITY.copy.howToPlay, {
        fontFamily: FONT,
        fontSize: '12px',
        color: '#8a94b0',
        align: 'center',
        wordWrap: { width: W - 40 },
      })
      .setOrigin(0.5, 0)
      .setResolution(2);

    this.add
      .text(
        W / 2,
        H - 12 - sb,
        `mini-app · ${MessengerBridge.kind === 'browser' ? 'browser' : MessengerBridge.platform} · v0.4.0`,
        { fontFamily: FONT, fontSize: '10px', color: '#5a6480' }
      )
      .setOrigin(0.5, 1)
      .setResolution(2);

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });

    this.tryDailyShortcut();
  }

  /** Старт забега: обычный или daily (сид от сегодняшней даты). */
  private startRun(daily: boolean): void {
    Sfx.play('click');
    MessengerBridge.haptic('light');
    this.closeMetaShop();
    this.cameras.main.fadeOut(280, 11, 14, 26);
    this.cameras.main.once('camerafadeoutcomplete', () =>
      this.scene.start('Game', daily ? { daily: true, dateKey: todayKey() } : undefined)
    );
  }

  /**
   * K1: мета-шоп — покупка персистентных усилений за осколки.
   * После покупки модалка пересобирается (простое и точное обновление строк).
   */
  private openMetaShop(): void {
    if (this.metaShop || !this.scene.isActive()) return;
    Sfx.play('click');
    MessengerBridge.haptic('light');
    const W = this.scale.width;
    const H = this.scale.height;
    const save = SaveSystem.get();
    const c = this.add.container(0, 0).setDepth(60);

    const panelW = Math.min(W - 24, 384);
    const rowH = 62;
    const panelH = Math.min(H - 32, 96 + META_UPGRADES.length * rowH + 58);
    const topY = H / 2 - panelH / 2;
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.82);
    const panel = this.add
      .rectangle(W / 2, H / 2, panelW, panelH, COLORS.panel, 0.98)
      .setStrokeStyle(2, COLORS.gold, 0.8);
    c.add([dim, panel]);
    c.add(
      this.add
        .text(W / 2, topY + 26, 'ЯДРО · УСИЛЕНИЯ', {
          fontFamily: FONT,
          fontSize: '17px',
          fontStyle: 'bold',
          color: '#ffe066',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );
    c.add(
      this.add
        .text(W / 2, topY + 52, `⬢ ${save.shards} осколков`, {
          fontFamily: FONT,
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#7dff6e',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    META_UPGRADES.forEach((def, i) => {
      const y = topY + 96 + i * rowH + rowH / 2 - 6;
      const level = metaLevel(save.meta, def.id);
      const maxed = level >= def.max;
      const cost = maxed ? 0 : metaCost(def, level);
      const afford = !maxed && save.shards >= cost;
      c.add(
        this.add
          .text(W / 2 - panelW / 2 + 16, y - 9, def.name, {
            fontFamily: FONT,
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#e8f4ff',
          })
          .setOrigin(0, 0.5)
          .setResolution(2)
      );
      c.add(
        this.add
          .text(W / 2 - panelW / 2 + 16, y + 11, `${def.effect} · Lv ${level}/${def.max}`, {
            fontFamily: FONT,
            fontSize: '11px',
            color: afford ? '#9fb6d8' : '#5a6480',
          })
          .setOrigin(0, 0.5)
          .setResolution(2)
      );
      const bx = W / 2 + panelW / 2 - 16 - 46;
      const btn = this.add
        .rectangle(bx, y, 92, 38, afford ? 0x14301f : 0x0f1424, 1)
        .setStrokeStyle(2, maxed ? 0x3a4258 : afford ? COLORS.green : 0x3a4258, 1);
      c.add(btn);
      c.add(
        this.add
          .text(bx, y, maxed ? 'MAX' : `⬢ ${cost}`, {
            fontFamily: FONT,
            fontSize: '13px',
            fontStyle: 'bold',
            color: maxed ? '#5a6480' : afford ? '#7dff6e' : '#5a6480',
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
      btn.setInteractive({ useHandCursor: afford }).on('pointerup', () => {
        if (!afford) {
          Sfx.play('hurt');
          return;
        }
        const r = buyMeta(def.id);
        if (r.ok) {
          Sfx.play('levelup');
          MessengerBridge.haptic('light');
          Analytics.track('meta_bought', { id: def.id, level: r.level, cost: r.cost });
          this.closeMetaShop();
          this.openMetaShop();
        } else {
          Sfx.play('hurt');
        }
      });
    });

    const closeY = topY + panelH - 27;
    const close = this.add
      .rectangle(W / 2, closeY, 130, 36, COLORS.panelHover, 1)
      .setStrokeStyle(2, COLORS.stroke, 1);
    c.add(close);
    c.add(
      this.add
        .text(W / 2, closeY, 'ЗАКРЫТЬ', {
          fontFamily: FONT,
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#aab4d4',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );
    close.setInteractive({ useHandCursor: true }).on('pointerup', () => this.closeMetaShop());
    dim.setInteractive({ useHandCursor: false }).on('pointerup', () => this.closeMetaShop());

    this.metaShop = c;
  }

  /** K1: закрыть мета-шоп и обновить баланс в меню. */
  private closeMetaShop(): void {
    if (!this.metaShop) return;
    const c = this.metaShop;
    this.metaShop = null;
    c.destroy(true);
    const save = SaveSystem.get();
    this.metaTextRef?.setText(`ЯДРО · ⬢ ${save.shards}`);
  }

  /**
   * Персонализация после готовности моста (MessengerBridge.whenReady):
   * приветствие + deep-link (реф/вызов). Для VK user и start_param приходят
   * асинхронно — отсюда и асинхронный вызов.
   */
  private personalize(): void {
    if (!this.scene.isActive()) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 620;

    const displayName = MessengerBridge.getDisplayName();
    if (MessengerBridge.available && displayName) {
      this.add
        .text(
          W / 2,
          H * (compact ? 0.12 : 0.15) + (compact ? 58 : 68),
          `Привет, ${displayName}!`,
          { fontFamily: FONT, fontSize: '12px', color: '#7dff6e' }
        )
        .setOrigin(0.5)
        .setResolution(2);
    }

    // Пришли по deep link: либо реф-ссылка (ref_<uid>), либо карточка друга.
    const startParam = this.readStartParam();
    if (startParam?.startsWith('ref_')) {
      const from = startParam.slice(4);
      const hadRef = SaveSystem.get().pendingRef !== null;
      SaveSystem.setPendingRef(from);
      if (!hadRef) Analytics.track('ref_opened');
      this.add
        .text(
          W / 2,
          H * (compact ? 0.12 : 0.15) + (compact ? 76 : 88),
          '👋 друг позвал тебя в ядро — бонус на первый забег!',
          { fontFamily: FONT, fontSize: '11px', color: '#ffe066' }
        )
        .setOrigin(0.5)
        .setResolution(2);
    } else if (startParam) {
      this.add
        .text(
          W / 2,
          H * (compact ? 0.12 : 0.15) + (compact ? 76 : 88),
          '⚡ ты пришёл по вызову — обнови их результат!',
          { fontFamily: FONT, fontSize: '11px', color: '#ffe066' }
        )
        .setOrigin(0.5)
        .setResolution(2);
    }
  }

  /**
   * Старт-параметр: masonry-мост (MAX/TG/VK) или query-string (браузер/PWA:
   * ?ref=<uid> и ?startapp=<payload>).
   */
  private readStartParam(): string | null {
    const viaBridge = MessengerBridge.getStartParam();
    if (viaBridge) return viaBridge;
    try {
      const q = new URLSearchParams(location.search);
      return q.get('ref') || q.get('startapp');
    } catch {
      return null;
    }
  }

  /** PWA-shortcut «Ежедневное» (?daily=1 в manifest) — сразу в daily-забег. */
  private tryDailyShortcut(): void {
    try {
      if (new URLSearchParams(location.search).get('daily') === '1') {
        this.time.delayedCall(600, () => this.startRun(true));
      }
    } catch {
      /* file:// и т.п. */
    }
  }

  private onResize(): void {
    this.scene.restart();
  }
}
