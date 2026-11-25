/**
 * The subset of TextMetrics canvas-txt reads. Structurally satisfied by the
 * DOM TextMetrics as well as node-canvas and skia-canvas metrics objects.
 */
interface TextMetricsLike {
    width: number;
    actualBoundingBoxAscent: number;
    actualBoundingBoxDescent: number;
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
}
/**
 * Minimal structural interface over a 2D context. Satisfied by
 * CanvasRenderingContext2D, OffscreenCanvasRenderingContext2D, node-canvas
 * and skia-canvas contexts — no casts needed.
 */
interface TextContext {
    font: string;
    textAlign: 'center' | 'end' | 'left' | 'right' | 'start';
    textBaseline: 'alphabetic' | 'bottom' | 'hanging' | 'ideographic' | 'middle' | 'top';
    fillText(text: string, x: number, y: number): void;
    measureText(text: string): TextMetricsLike;
    direction?: 'ltr' | 'rtl' | 'inherit';
    letterSpacing?: string;
    fillStyle?: unknown;
    strokeStyle?: unknown;
    lineWidth?: number;
    strokeText?(text: string, x: number, y: number): void;
    strokeRect?(x: number, y: number, w: number, h: number): void;
    beginPath?(): void;
    moveTo?(x: number, y: number): void;
    lineTo?(x: number, y: number): void;
    stroke?(): void;
    setLineDash?(segments: number[]): void;
    globalAlpha?: number;
}
interface TextStyle {
    /** Font family, e.g. `'Arial'` or `"'Fira Sans', sans-serif"`. Default `'Arial'` */
    font?: string;
    /** Font size in px. Default `14` */
    fontSize?: number;
    /** Same as css font-weight, e.g. `'bold'`, `100` */
    fontWeight?: string | number;
    /** Same as css font-style, e.g. `'italic'` */
    fontStyle?: string;
    /** Same as css font-variant, e.g. `'small-caps'` */
    fontVariant?: string;
    /** Line height in px. Defaults to the font's natural line height */
    lineHeight?: number;
    /** Same as css letter-spacing, e.g. `'2px'`. Applied where the context supports it */
    letterSpacing?: string;
    /** Text direction. Applied where the context supports it */
    direction?: 'ltr' | 'rtl' | 'inherit';
    /** Horizontal alignment inside the box. Default `'center'` */
    align?: 'left' | 'center' | 'right';
    /** Vertical alignment inside the box. Default `'middle'` */
    vAlign?: 'top' | 'middle' | 'bottom';
    /** Stretch soft-wrapped lines to the full box width. Default `false` */
    justify?: boolean;
    /**
     * What happens to lines that don't fit the box height:
     * `'visible'` keeps them, `'hidden'` clips them, `'ellipsis'` clips and
     * appends `…` to the last visible line. Default `'visible'`
     */
    overflow?: 'visible' | 'hidden' | 'ellipsis';
    /** Hard cap on the number of lines, independent of box height */
    maxLines?: number;
    /**
     * Reuse segment widths from a module-level per-font cache shared across
     * calls (fast; call `clearMeasurementCache()` after loading web fonts).
     * Set `false` to measure exactly per call with no shared state.
     * Default `true`
     */
    cache?: boolean;
}
interface LayoutConfig extends TextStyle {
    /** Width of the text box. Required */
    width: number;
    /** Height of the text box — used by vAlign and overflow */
    height?: number;
}
interface DrawStyle {
    /** Fill style for the text. Defaults to the context's current fillStyle */
    fill?: string | object;
    /** When set, the text is also stroked with this style */
    stroke?: string | object;
    /** Line width used for the stroke. Default `1` */
    strokeWidth?: number;
}
interface DrawTextConfig extends LayoutConfig {
    x: number;
    y: number;
    height: number;
    /** Draw the box and alignment guides */
    debug?: boolean;
    style?: DrawStyle;
}
interface LayoutWord {
    text: string;
    /** Left edge relative to the box's left edge */
    x: number;
}
interface LayoutLine {
    text: string;
    /** Left edge relative to the box's left edge (alignment applied) */
    x: number;
    /** Alphabetic-baseline y relative to the box's top edge */
    y: number;
    width: number;
    /** Word positions for justified lines; null when the line isn't justified */
    words: LayoutWord[] | null;
}
interface TextLayout {
    lines: LayoutLine[];
    /** Width of the widest line (box width for justified layouts) */
    width: number;
    /** Total height of the laid-out text block */
    height: number;
    lineHeight: number;
    /** Resolved CSS font shorthand used for this layout */
    font: string;
    letterSpacing?: string;
    direction?: 'ltr' | 'rtl' | 'inherit';
    /** True when overflow/maxLines dropped content */
    clipped: boolean;
}

interface DrawLayoutOptions {
    /** Left edge of the text box on the canvas */
    x: number;
    /** Top edge of the text box on the canvas */
    y: number;
    style?: DrawStyle;
}
/**
 * Paint a layout produced by `layoutText` at (x, y). The layout can be
 * painted repeatedly (animation frames, fill + stroke passes) without
 * re-measuring. Context state is restored afterwards.
 */
declare function drawTextLayout(ctx: TextContext, layout: TextLayout, { x, y, style }: DrawLayoutOptions): void;
/**
 * Lay out and draw text inside the box described by config. Convenience
 * wrapper around `layoutText` + `drawTextLayout` — for repeated drawing of
 * the same text, lay out once and paint the layout instead.
 */
declare function drawText(ctx: TextContext, text: string, config: DrawTextConfig): {
    height: number;
    width: number;
    lines: string[];
};

/**
 * Lay text out inside a box without drawing anything. Pure with respect to
 * the context: every context property it touches is restored before
 * returning. The result can be painted any number of times with
 * `drawTextLayout`, cached across frames, hit-tested, or inspected.
 *
 * Layouts and segment widths are memoized in module-level caches by default
 * (see `clearMeasurementCache`); returned layouts are frozen. Pass
 * `cache: false` to measure exactly, per call, with no shared state — those
 * results are not frozen.
 */
declare function layoutText(ctx: TextContext, text: string, config: LayoutConfig): TextLayout;

/**
 * Drop every cached measurement and memoized result. Call this after
 * `document.fonts` finishes loading (or any time a font file arrives) so
 * widths are re-measured with the real font instead of its fallback.
 */
declare function clearMeasurementCache(): void;

type MeasureTextConfig = Omit<LayoutConfig, 'height' | 'overflow' | 'align' | 'vAlign'>;
/**
 * Lays out the text exactly like drawText would — same wrapping, same line
 * height — without drawing anything. Useful for sizing a canvas before
 * rendering.
 */
declare function measureText(ctx: TextContext, text: string, config: MeasureTextConfig): {
    lines: string[];
    width: number;
    height: number;
};
interface SplitTextProps {
    ctx: TextContext;
    text: string;
    width: number;
    /** @deprecated v5 justifies at paint time; this flag is ignored */
    justify?: boolean;
    /** Set `false` to bypass the module-level width cache. Default `true` */
    cache?: boolean;
}
/**
 * Split text into wrapped lines using the context's current font.
 * Kept for v4 compatibility — prefer `layoutText`, which also gives you
 * positions and metrics.
 */
declare function splitText({ ctx, text, width, cache, }: SplitTextProps): string[];
interface GetTextHeightProps {
    ctx: TextContext;
    text: string;
    style: string;
}
/**
 * Height of `text` rendered with the given CSS font string. Uses the font's
 * real line box where the environment exposes it, falling back to the inked
 * bounding box of `text`.
 */
declare function getTextHeight({ ctx, text, style }: GetTextHeightProps): number;

export { type DrawTextConfig as CanvasTextConfig, type DrawLayoutOptions, type DrawStyle, type DrawTextConfig, type LayoutConfig, type LayoutLine, type LayoutWord, type MeasureTextConfig, type SplitTextProps, type TextContext, type TextLayout, type TextMetricsLike, type TextStyle, clearMeasurementCache, drawText, drawTextLayout, getTextHeight, layoutText, measureText, splitText };
