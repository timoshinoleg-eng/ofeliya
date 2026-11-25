import Phaser from 'phaser';

export type MenuKeyboardControl = {
  id?: string;
  object: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text;
  label: () => string;
  activate: () => void;
  onFocus?: () => void;
  keyboardAvailable?: boolean;
};

export type MenuKeyboardScope = {
  setControls: (controls: MenuKeyboardControl[]) => void;
  focus: (id: string) => boolean;
  destroy: () => void;
};

type Scope = {
  controls: MenuKeyboardControl[];
  index: number;
  blocked: () => boolean;
  escape: () => boolean;
  active: boolean;
};

/** Scene-local keyboard focus; actions are shared with pointer handlers, never emitted. */
export class MenuKeyboard {
  // Phaser 3.90 can revisit the manager queue before POST_STEP, including events
  // ignored while a DOM overlay was open. Remember those across scene restarts too.
  private static readonly seenEvents = new WeakSet<KeyboardEvent>();
  private readonly base: Scope;
  private readonly scopes: Scope[] = [];
  private ring: Phaser.GameObjects.Graphics;
  private canvas: HTMLCanvasElement;
  private previousAttributes: (string | null)[];
  private destroyed = false;
  private readonly attributes = ['tabindex', 'aria-label', 'aria-keyshortcuts'];

  constructor(
    private scene: Phaser.Scene,
    private options: { blocked: () => boolean; escape: () => boolean },
  ) {
    this.base = { controls: [], index: -1, blocked: options.blocked, escape: options.escape, active: true };
    this.scopes.push(this.base);
    this.ring = scene.add.graphics().setDepth(90).setName('ofeliya-menu-keyboard-focus');
    this.canvas = scene.game.canvas;
    this.previousAttributes = this.attributes.map(name => this.canvas.getAttribute(name));
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Меню OFELIYA. Tab — выбор, Enter или пробел — действие.');
    this.canvas.setAttribute('aria-keyshortcuts', 'Tab Shift+Tab ArrowUp ArrowDown Enter Space Escape');
    // No global addCapture: native DOM dialogs must keep Tab/Space/Enter defaults.
    scene.input.keyboard?.on('keydown', this.onKey, this);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.render, this);
    this.canvas.addEventListener('blur', this.onBlur);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  add(object: MenuKeyboardControl['object'], label: MenuKeyboardControl['label'], activate: MenuKeyboardControl['activate']): void {
    this.base.controls.push({ object, label, activate });
  }

  createScope(options: { blocked?: () => boolean; escape: () => boolean }): MenuKeyboardScope {
    const scope: Scope = {
      controls: [], index: -1, blocked: options.blocked ?? (() => false), escape: options.escape, active: true,
    };
    this.scopes.push(scope);
    return {
      setControls: (controls) => {
        if (!scope.active || this.destroyed) return;
        const focusedId = scope.controls[scope.index]?.id;
        scope.controls = [...controls];
        scope.index = focusedId === undefined ? -1 : controls.findIndex(control => control.id === focusedId);
      },
      focus: (id) => {
        if (!scope.active || this.destroyed || this.currentScope() !== scope) return false;
        const index = scope.controls.findIndex(control => control.id === id && this.available(control));
        if (index < 0) return false;
        scope.index = index;
        this.canvas.focus({ preventScroll: true });
        scope.controls[index].onFocus?.();
        this.render();
        return true;
      },
      destroy: () => {
        if (!scope.active) return;
        scope.active = false;
        scope.controls = [];
        const index = this.scopes.indexOf(scope);
        if (index > 0) this.scopes.splice(index, 1);
        if (!this.destroyed) this.render();
      },
    };
  }

  private currentScope(): Scope {
    return this.scopes[this.scopes.length - 1] ?? this.base;
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

  private available(control: MenuKeyboardControl): boolean {
    return control.object.active && control.object.visible &&
      (control.keyboardAvailable === true || Boolean(control.object.input?.enabled));
  }

  private onKey(event: KeyboardEvent): void {
    if (MenuKeyboard.seenEvents.has(event)) return;
    MenuKeyboard.seenEvents.add(event);
    if (!this.scene.sys.isActive() || this.scene.scene.isActive('Game') || this.domOwnsFocus(event) ||
        event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const scope = this.currentScope();
    if (event.key === 'Escape') {
      if (!event.repeat && scope.escape()) {
        event.preventDefault();
        this.canvas.focus({ preventScroll: true });
        this.render();
      }
      return;
    }
    if (scope.blocked()) {
      // Phaser overlays have no native tab stops. Keep canvas focus for Escape,
      // without advancing/activating the menu behind them. DOM was excluded above.
      if (['Tab', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) event.preventDefault();
      return;
    }
    const backward = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);
    const move = event.key === 'Tab' || event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const activate = event.key === 'Enter' || event.key === ' ';
    if (!move && !activate) return;
    if (activate && (scope.index < 0 || !this.available(scope.controls[scope.index]))) return;
    event.preventDefault();
    if (event.repeat) return;
    this.canvas.focus({ preventScroll: true });
    if (move) {
      const direction = backward ? -1 : 1;
      let next = scope.index < 0 ? (backward ? 0 : -1) : scope.index;
      for (let i = 0; i < scope.controls.length; i++) {
        next = (next + direction + scope.controls.length) % scope.controls.length;
        if (this.available(scope.controls[next])) {
          scope.index = next;
          scope.controls[next].onFocus?.();
          break;
        }
      }
    } else {
      scope.controls[scope.index].activate();
    }
    this.render();
  }

  private onBlur = (): void => { this.ring.clear(); };

  private render(): void {
    this.ring.clear();
    const scope = this.currentScope();
    const control = scope.controls[scope.index];
    if (!control || !this.available(control) || scope.blocked() || this.domOwnsFocus() ||
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
    for (const scope of this.scopes) {
      scope.active = false;
      scope.controls = [];
    }
    this.scopes.length = 0;
    this.ring.destroy();
  }
}
