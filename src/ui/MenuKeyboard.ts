import Phaser from 'phaser';

type Control = {
  object: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text;
  label: () => string;
  activate: () => void;
};

/** Scene-local keyboard focus; actions are shared with pointer handlers, never emitted. */
export class MenuKeyboard {
  // Phaser 3.90 can revisit the manager queue before POST_STEP, including events
  // ignored while a DOM overlay was open. Remember those across scene restarts too.
  private static readonly seenEvents = new WeakSet<KeyboardEvent>();
  private controls: Control[] = [];
  private index = -1;
  private ring: Phaser.GameObjects.Graphics;
  private canvas: HTMLCanvasElement;
  private previousAttributes: (string | null)[];
  private destroyed = false;
  private readonly attributes = ['tabindex', 'aria-label', 'aria-keyshortcuts'];

  constructor(
    private scene: Phaser.Scene,
    private options: { blocked: () => boolean; escape: () => boolean },
  ) {
    this.ring = scene.add.graphics().setDepth(90).setName('ofeliya-menu-keyboard-focus');
    this.canvas = scene.game.canvas;
    this.previousAttributes = this.attributes.map(name => this.canvas.getAttribute(name));
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Меню OFELIYA. Tab — выбор, Enter или пробел — действие.');
    this.canvas.setAttribute('aria-keyshortcuts', 'Tab Shift+Tab ArrowUp ArrowDown Enter Space');
    // No global addCapture: native DOM dialogs must keep Tab/Space/Enter defaults.
    scene.input.keyboard?.on('keydown', this.onKey, this);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.render, this);
    this.canvas.addEventListener('blur', this.onBlur);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  add(object: Control['object'], label: Control['label'], activate: Control['activate']): void {
    this.controls.push({ object, label, activate });
  }

  private domOwnsFocus(event?: KeyboardEvent): boolean {
    // Check event.target too: a DOM close handler may already have restored canvas focus.
    const foreign = (target: EventTarget | null | undefined) =>
      target instanceof Element && target !== this.canvas && target !== document.body &&
      target !== document.documentElement;
    const overlayVisible = Array.from(document.querySelectorAll(
      '[role="dialog"], dialog[open], [data-ofeliya-video]',
    )).some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    return foreign(event?.target) || foreign(document.activeElement) || overlayVisible;
  }

  private available(control: Control): boolean {
    return control.object.active && control.object.visible && Boolean(control.object.input?.enabled);
  }

  private onKey(event: KeyboardEvent): void {
    if (MenuKeyboard.seenEvents.has(event)) return;
    MenuKeyboard.seenEvents.add(event);
    if (!this.scene.sys.isActive() || this.scene.scene.isActive('Game') || this.domOwnsFocus(event) ||
        event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.key === 'Escape') {
      if (!event.repeat && this.options.escape()) {
        event.preventDefault();
        this.canvas.focus({ preventScroll: true });
        this.render();
      }
      return;
    }
    if (this.options.blocked()) {
      // Phaser overlays have no native tab stops. Keep canvas focus for Escape,
      // without advancing/activating the menu behind them. DOM was excluded above.
      if (['Tab', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) event.preventDefault();
      return;
    }
    const backward = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
    const move = event.key === 'Tab' || event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const activate = event.key === 'Enter' || event.key === ' ';
    if (!move && !activate) return;
    if (activate && (this.index < 0 || !this.available(this.controls[this.index]))) return;
    event.preventDefault();
    if (event.repeat) return;
    this.canvas.focus({ preventScroll: true });
    if (move) {
      const direction = backward ? -1 : 1;
      let next = this.index < 0 ? (backward ? 0 : -1) : this.index;
      for (let i = 0; i < this.controls.length; i++) {
        next = (next + direction + this.controls.length) % this.controls.length;
        if (this.available(this.controls[next])) {
          this.index = next;
          break;
        }
      }
    } else {
      this.controls[this.index].activate();
    }
    this.render();
  }

  private onBlur = (): void => { this.ring.clear(); };

  private render(): void {
    this.ring.clear();
    const control = this.controls[this.index];
    if (!control || !this.available(control) || this.options.blocked() || this.domOwnsFocus() ||
        document.activeElement !== this.canvas) return;
    const bounds = control.object.getBounds();
    // The stroke stays outside the glyphs; its 2px reach fits the utility row's
    // minimum gap without moving text or changing any pointer hit areas.
    this.ring.lineStyle(2, 0xffe066, 1);
    this.ring.strokeRoundedRect(bounds.x - 1, bounds.y - 1,
      bounds.width + 2, bounds.height + 2, 3);
    const label = `${control.label()}. Tab — выбор, Enter или пробел — действие.`;
    if (this.canvas.getAttribute('aria-label') !== label) this.canvas.setAttribute('aria-label', label);
  }

  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
    this.scene.input.keyboard?.off('keydown', this.onKey, this);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.render, this);
    this.canvas.removeEventListener('blur', this.onBlur);
    this.attributes.forEach((name, i) => {
      const value = this.previousAttributes[i];
      if (value === null) this.canvas.removeAttribute(name);
      else this.canvas.setAttribute(name, value);
    });
    this.controls = [];
    this.ring.destroy();
  }
}
