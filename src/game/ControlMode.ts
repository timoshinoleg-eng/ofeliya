export type ControlMode = 'one-hand' | 'two-hand';

const KEY = 'ofeliya_control_mode_v1';

export function readControlMode(): ControlMode {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'two-hand' ? 'two-hand' : 'one-hand';
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
  return mode === 'one-hand' ? 'two-hand' : 'one-hand';
}

export function controlModeLabel(mode: ControlMode): string {
  return mode === 'one-hand' ? 'ОДНА РУКА' : 'ДВЕ РУКИ · TWIN-STICK';
}

export function controlModeDescription(mode: ControlMode): string {
  return mode === 'one-hand'
    ? 'текущее управление · касание в любом месте · автоатака'
    : 'слева движение · справа приоритет атаки · автоатака';
}
