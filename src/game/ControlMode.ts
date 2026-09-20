export type ControlMode = 'one-hand' | 'two-hand' | 'dual-move';

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
  if (mode === 'one-hand') return 'ОДНА РУКА';
  if (mode === 'two-hand') return 'ДВЕ РУКИ · TWIN-STICK';
  return 'ДВЕ РУКИ · ДВИЖЕНИЕ';
}

export function controlModeDescription(mode: ControlMode): string {
  if (mode === 'one-hand') return 'текущее управление · касание в любом месте · автоатака';
  if (mode === 'two-hand') return 'слева движение · справа приоритет атаки · автоатака';
  return 'оба стика двигают · автоатака';
}
