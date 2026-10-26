import Phaser from 'phaser';
import { SKIN_CATALOG } from '../game/collection/ClientCollection';
import { clientCollection, clientFlags, cosmeticColor } from '../systems/ClientExperience';
import { rewardReveal, squashAndStretch } from './ClientJuice';
import { PlatformBridge } from '../platform';
import { FONT, UI_FONT } from '../game/config';
import { META_COPY } from '../game/UiCopy';
import { fmtInt } from '../game/UiFormat';
import { VISUAL, VISUAL_TEXT } from './visualTokens';
import { createMetaDock, createModalFrame, MODAL, type MetaDockTarget } from './modal';
import { collectionPageCount, shouldShowPaginator } from './collectionPages';

type Page = 'milestones' | 'shells' | 'lab';

/** Cosmetic-only Muse collection. No inventory, currency, boosts or product save writes. */
export class CollectionBoard {
  private readonly collection = clientCollection();
  private readonly root: Phaser.GameObjects.Container;
  private page: Page = 'milestones';
  private offset = 0;
  private closed = false;

  constructor(
    private scene: Phaser.Scene,
    private dismissed: () => void,
    private navigate: (target: MetaDockTarget) => void
  ) {
    this.root = scene.add.container(0, 0).setDepth(72).setName('ofeliya-collection');
    this.collection.visit();
    this.render();
    rewardReveal(scene, this.root, { enabled: clientFlags().juice.enhanced });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    PlatformBridge.setBackHandler(() => this.destroy());
  }

  private render(): void {
    this.root.removeAll(true);
    const s = this.scene;
    const W = s.scale.width;
    const H = s.scale.height;
    const w = Math.min(W - 22, 440);
    const h = Math.min(H - 24, 620);
    const left = (W - w) / 2;
    const top = (H - h) / 2;
    const compact = H < 650;
    const state = this.collection.snapshot();

    const dismiss = (): void => this.destroy();
    const frame = createModalFrame(s, this.root, {
      x: W / 2,
      y: H / 2,
      width: w,
      height: h,
      title: META_COPY.collection,
      compact,
      withDock: true,
      onClose: dismiss,
    });

    const text = (
      x: number,
      y: number,
      value: string,
      size = 12,
      color: string = VISUAL_TEXT.ivory,
      width = w - MODAL.padX * 2
    ): Phaser.GameObjects.Text => {
      const t = s.add
        .text(x, y, value, { fontFamily: UI_FONT, fontSize: size, color, wordWrap: { width }, lineSpacing: 3 })
        .setResolution(2);
      this.root.add(t);
      return t;
    };
    const button = (
      name: string,
      x: number,
      y: number,
      bw: number,
      label: string,
      action: () => void,
      enabled = true
    ): Phaser.GameObjects.Rectangle => {
      const hit = s.add
        .rectangle(x, y, bw, 44, VISUAL.ink, 1)
        .setStrokeStyle(1, VISUAL.line)
        .setName(name);
      if (enabled) hit.setInteractive({ useHandCursor: true }).on('pointerup', action);
      this.root.add(hit);
      text(x, y, label, 11, enabled ? VISUAL_TEXT.ivory : VISUAL_TEXT.muted, bw - 8).setOrigin(0.5);
      return hit;
    };

    // ---- Tabs --------------------------------------------------------------
    const tabW = (w - MODAL.padX * 2 - 12) / 3;
    const tabY = frame.bodyTop - 8;
    const tabs: Array<[Page, string]> = [
      ['shells', META_COPY.shells],
      ['milestones', META_COPY.milestones],
      ['lab', META_COPY.lab],
    ];
    tabs.forEach(([page, label], index) => {
      const enabled = page !== 'shells' || clientFlags().skins.gallery;
      const x = left + MODAL.padX + tabW * (index + 0.5);
      const active = this.page === page;
      const plate = s.add
        .rectangle(x, tabY, tabW - 4, 40, active ? VISUAL.panelRaised : VISUAL.ink, active ? 1 : 0.001)
        .setStrokeStyle(1, active ? VISUAL.host : VISUAL.line, active ? 0.8 : 0.3)
        .setName(`ofeliya-collection-${page}`)
        .setInteractive({ useHandCursor: true });
      if (!enabled) plate.disableInteractive();
      plate.on('pointerup', () => {
        if (!enabled) return;
        this.page = page;
        this.offset = 0;
        this.render();
      });
      this.root.add(plate);
      text(x, tabY, label, compact ? 11 : 12, active ? VISUAL_TEXT.host : VISUAL_TEXT.muted, tabW - 6)
        .setOrigin(0.5);
    });

    const y0 = tabY + 34;
    const rowH = this.page === 'shells' ? 96 : compact ? 78 : 91;
    const pageSize = Math.max(1, Math.min(4, Math.floor((h - 250) / rowH)));

    if (this.page === 'milestones') {
      const rows = state.achievements.slice(this.offset, this.offset + pageSize);
      rows.forEach((a, i) => {
        const y = y0 + i * rowH;
        text(
          left + MODAL.padX,
          y,
          `${a.unlocked ? '◆' : '◇'} ${a.title}`,
          13,
          a.unlocked ? VISUAL_TEXT.host : VISUAL_TEXT.ivory
        );
        text(left + MODAL.padX, y + 22, a.description, 11, VISUAL_TEXT.muted);
        text(
          left + MODAL.padX,
          y + 51,
          a.unlocked
            ? `◆ ВЫПОЛНЕНО · ${fmtInt(a.progress)} / ${fmtInt(a.threshold)}`
            : `${fmtInt(a.progress)} / ${fmtInt(a.threshold)}`,
          11,
          a.unlocked ? VISUAL_TEXT.host : VISUAL_TEXT.muted
        );
      });
    } else if (this.page === 'shells') {
      // One explanation for the whole tab, not one line per shell.
      text(left + MODAL.padX, y0, META_COPY.shellsNote, 11, VISUAL_TEXT.muted);
      const shellTop = y0 + 22;
      SKIN_CATALOG.slice(this.offset, this.offset + pageSize).forEach((skin, i) => {
        const y = shellTop + i * rowH;
        const owned = state.ownedSkinIds.includes(skin.id);
        const selected = state.selectedSkinId === skin.id;
        const orb = s.add
          .circle(left + MODAL.padX + 16, y + 22, 15, cosmeticColor(skin.id), owned ? 0.95 : 0.25)
          .setStrokeStyle(2, VISUAL.line);
        this.root.add(orb);
        if (owned) orb.setInteractive().on('pointerdown', () => squashAndStretch(s, orb, { enabled: clientFlags().juice.enhanced }));
        text(left + MODAL.padX + 40, y, skin.title, 12, owned ? VISUAL_TEXT.ivory : VISUAL_TEXT.muted, w - MODAL.padX * 2 - 56);
        if (!owned) {
          // The unlock condition comes from the milestone catalog itself.
          const goal = state.achievements.find((a) => a.id === skin.earnedBy);
          text(
            left + MODAL.padX + 40,
            y + 20,
            goal ? `${META_COPY.locked} · ${goal.title} — ${goal.description}` : META_COPY.locked,
            10,
            VISUAL_TEXT.muted,
            w - MODAL.padX * 2 - 56
          );
        }
        if (selected) {
          const activePlate = s.add
            .rectangle(left + w - MODAL.padX - 52, y + 52, 104, 30, VISUAL.host, 0.95)
            .setStrokeStyle(1, VISUAL.host, 1)
            .setName(`ofeliya-skin-${skin.id}`);
          this.root.add(activePlate);
          text(left + w - MODAL.padX - 52, y + 52, META_COPY.active, 11, '#080f14').setOrigin(0.5);
        } else if (!owned) {
          // A locked shell keeps a named, inert row handle: it is shown, but it
          // never offers a select action.
          const lockedPlate = s.add
            .rectangle(left + w - MODAL.padX - 52, y + 52, 104, 30, VISUAL.ink, 0.001)
            .setName(`ofeliya-skin-${skin.id}`);
          this.root.add(lockedPlate);
        } else if (!state.readOnly) {
          button(`ofeliya-skin-${skin.id}`, left + w - MODAL.padX - 52, y + 52, 104, 'ВЫБРАТЬ', () => {
            if (this.collection.selectSkin(skin.id)) this.render();
          });
        }
      });
    } else {
      text(left + MODAL.padX, y0, 'ИССЛЕДОВАНИЯ · БЕЗ УСИЛЕНИЙ', 13, VISUAL_TEXT.host);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      for (let i = 0; i < 7; i++) {
        const date = new Date(today.getTime() - (6 - i) * 86400000);
        const day = date.toISOString().slice(0, 10);
        const visited = state.recentVisitDays.includes(day);
        const x = left + MODAL.padX + ((w - MODAL.padX * 2) / 7) * (i + 0.5);
        text(x, y0 + 29, `${visited ? '◆' : '◇'} ${date.getUTCDate()}`, 10, visited ? VISUAL_TEXT.host : VISUAL_TEXT.muted, 40)
          .setOrigin(0.5, 0);
      }
      const done = state.achievements.filter((a) => a.unlocked).length;
      const branches: Array<[string, string]> = [
        ['МЕТАБОЛИЗМ', 'Записи собранной РНК и длительности забегов.'],
        ['ХИТИН', 'История серий без урона и завершённых забегов.'],
        ['ХЕМОТАКСИС', 'Исследование клеток хозяина и элитных противников.'],
      ];
      const branchStep = Math.min(68, Math.max(48, (h - 300) / 3));
      branches.forEach(([title, desc], i) => {
        text(left + MODAL.padX, y0 + 57 + i * branchStep, title, 14);
        text(left + MODAL.padX, y0 + 80 + i * branchStep, desc, 12, VISUAL_TEXT.muted);
      });
      text(
        left + MODAL.padX,
        top + h - 110,
        `Открыто вех: ${done} / ${state.achievements.length}\nУрон, здоровье, скорость и награды не меняются.`,
        11,
        VISUAL_TEXT.host
      );
    }

    // ---- Pagination --------------------------------------------------------
    // One page needs no paginator.
    const total = this.page === 'shells' ? SKIN_CATALOG.length : state.achievements.length;
    const pageCount = collectionPageCount(total, pageSize);
    if (this.page !== 'lab' && shouldShowPaginator(total, pageSize)) {
      const y = top + h - 84;
      button('ofeliya-collection-prev', left + MODAL.padX + 27, y, 54, '‹', () => {
        this.offset = Math.max(0, this.offset - pageSize);
        this.render();
      }, this.offset > 0);
      text(W / 2, y, `${1 + Math.floor(this.offset / pageSize)} / ${pageCount}`, 11).setOrigin(0.5);
      button('ofeliya-collection-next', left + w - MODAL.padX - 27, y, 54, '›', () => {
        this.offset += pageSize;
        this.render();
      }, this.offset + pageSize < total);
    }

    // ---- Internal dock -----------------------------------------------------
    const dock = createMetaDock(s, this.root, {
      x: W / 2,
      y: frame.dockTop,
      width: w - MODAL.padX * 2,
      active: 'collection',
      compact,
      onSelect: (target) => {
        if (target === 'collection') return;
        this.destroy();
        this.navigate(target);
      },
    });
    dock.setActive('collection');
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.tweens.killTweensOf(this.root);
    this.root.destroy();
    PlatformBridge.setBackHandler(null);
    this.dismissed();
  }
}
