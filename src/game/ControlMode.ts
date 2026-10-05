export type ControlMode = 'one-hand' | 'two-hand' | 'dual-move';

export interface ControlModeCopy {
  label: string;
  description: string;
}

/**
 * Full control-mode copy: label plus a one-line explanation of the layout.
 * Used by the single-selector menu layout and by challenge/duel detail lines.
 */
export const CONTROL_MODE_COPY: Record<ControlMode, ControlModeCopy> = {
  'one-hand': {
    label: 'ОДНА РУКА',
    description: 'текущее управление · касание в любом месте · автоатака',
  },
  'two-hand': {
    label: 'ДВЕ РУКИ · ПРИЦЕЛ',
    description: 'слева движение · справа приоритет атаки · автоатака',
  },
  'dual-move': {
    label: 'ДВЕ РУКИ · ДВИЖЕНИЕ',
    description: 'оба стика двигают · автоатака',
  },
};

/**
 * Compact control-mode copy for the split-selector menu layout.
 * Deliberately shorter than {@link CONTROL_MODE_COPY}: the label drops the
 * layout suffix and the description states only the control difference.
 * These strings are NOT interchangeable with the full variants.
 */
export const CONTROL_MODE_COPY_COMPACT: Record<ControlMode, ControlModeCopy> = {
  'one-hand': {
    label: 'ОДНА РУКА',
    description: 'АВТОАТАКА · одно касание',
  },
  'two-hand': {
    label: 'ДВЕ РУКИ',
    description: 'ПРИЦЕЛ · справа атака',
  },
  'dual-move': {
    label: 'ДВА СТИКА',
    description: 'оба стика · автоатака',
  },
};

/** Ultra-short hint shown instead of a description on very short viewports. */
export const CONTROL_MODE_COPY_TINY: Record<ControlMode, string> = {
  'one-hand': 'автоатака',
  'two-hand': 'прицел',
  'dual-move': 'автоатака',
};

const KEY = 'ofeliya_control_mode_v1';

export function readControlMode(): ControlMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'two-hand' || raw === 'dual-move') return raw;
    return 'one-hand';
  } catch {
    return 'one-hand';
  }
}

export function writeControlMode(mode: ControlMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode/storage restrictions: keep registry selection for this session */
  }
}

export function nextControlMode(mode: ControlMode): ControlMode {
  if (mode === 'one-hand') return 'two-hand';
  if (mode === 'two-hand') return 'dual-move';
  return 'one-hand';
}

export function controlModeLabel(mode: ControlMode): string {
  return CONTROL_MODE_COPY[mode].label;
}

export function controlModeDescription(mode: ControlMode): string {
  return CONTROL_MODE_COPY[mode].description;
}

export function controlModeCompactLabel(mode: ControlMode): string {
  return CONTROL_MODE_COPY_COMPACT[mode].label;
}

export function controlModeCompactDescription(mode: ControlMode): string {
  return CONTROL_MODE_COPY_COMPACT[mode].description;
}

export function controlModeTinyHint(mode: ControlMode): string {
  return CONTROL_MODE_COPY_TINY[mode];
}