/**
 * TMA-адаптация платформы Telegram — контракт версионного гейтинга.
 *
 * Порт теста Фазы TMA (стек), суженный до того, что main ещё не пинит.
 * Остальное из теста стека в main уже покрыто эволюционировавшими
 * реализациями — переписывать их сюда как дубликаты нельзя:
 *
 *   стек: onViewportChanged (сырая подписка, unstable тоже доставляется)
 *   main: TelegramPlatform.subscribeViewportChange — тот же сигнал, но
 *     isStateStable:false игнорируется по дизайну (высота — moving target).
 *     Пинится в scripts/check-telegram-tma.mjs + check-muse-tma.mjs.
 *   стек: onSafeAreaChanged (отдельный метод)
 *   main: внутри subscribeViewportChange (safeAreaChanged +
 *     contentSafeAreaChanged при 8.0+). Пинится там же.
 *   стек: getSafeAreaInsets (только safeAreaInset)
 *   main: тот же метод, но мержит safe+content по максимуму сторон.
 *     Пинится в check-muse-tma.mjs ('safe/content insets merge by max').
 *   стек: setClosingConfirmation / onActivatedStateChange (методы адаптера)
 *   main: TelegramLifecycle + GameHostLifecycle (host-level, с владением
 *     паузой: чужая пауза не снимается; document.visibility — координация).
 *     Пинится в check-muse-tma.mjs; GameScene подключает через
 *     installGameHostLifecycle (create + SHUTDOWN + finish).
 *   стек: getThemeBgColor / normalizeHexColor / isDarkHexColor
 *   main: тема — TelegramTheme.installTelegramTheme (dark-only, живой
 *     themeChanged, restore); математика — darkThemeColor.
 *     Пинится в scripts/check-muse-theme.mjs.
 *   стек: resolveSafeAreaInsets (host целиком или fallback)
 *   main: ViewportManager.mergeSafeAreaInsets (максимум по сторонам —
 *     строже: частичные данные хоста не затирают CSS).
 *     Пинится в check-muse-tma.mjs.
 *   стек: main.ts applyTelegramThemeBackground (one-shot)
 *   main: installTelegramTheme() на верхнем уровне main.ts.
 *
 * Что пинит ЭТОТ тест (нового в main):
 *   - isTelegramVersionAtLeast — чистый компаратор, экспорт из
 *     TelegramPlatform (порт из стека; fallback в isVersionAtLeast);
 *   - TelegramPlatform.isVersionAtLeast — нативный helper первичен,
 *     при его броске — fallback на чистый компаратор (этот путь
 *     в существующих чеках не запинен).
 * Compiles the TS modules with tsc like the other node-side contract tests.
 * MAX/browser-путь не затрагивается.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-tma-adapt-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'module' }));
// Проект типизирует import.meta.env через vite/client; для изолированной
// компиляции подкладываем минимальный шим (исходники не трогаем).
writeFileSync(
  join(temp, 'import-meta-shim.d.ts'),
  'interface ImportMeta { readonly env: Record<string, string | undefined>; }\n'
);

const eq = (actual, expected, message) =>
  assert.equal(actual, expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/platform/TelegramPlatform.ts',
      'src/platform/TelegramLinks.ts',
      'src/platform/PlatformBridge.ts',
      join(temp, 'import-meta-shim.d.ts'),
      '--target', 'ES2020',
      '--module', 'es2020',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
    ],
    { stdio: 'inherit' }
  );

  // Node ESM требует расширения в относительных импортах — дописываем .js
  // в скомпилированном выводе (только temp, исходники не трогаем).
  for (const file of ['platform/TelegramPlatform.js', 'platform/TelegramLinks.js']) {
    const p = join(temp, file);
    const src = readFileSync(p, 'utf8').replace(/from '(\.[^']*)'/g, (m, spec) =>
      spec.endsWith('.js') ? m : `from '${spec}.js'`
    );
    writeFileSync(p, src);
  }

  const {
    TelegramPlatform,
    isTelegramVersionAtLeast,
  } = await import(pathToFileURL(join(temp, 'platform/TelegramPlatform.js')).href);

  // --- Версионный гейтинг (чистый компаратор, кейсы из теста стека) ---
  eq(isTelegramVersionAtLeast('8.0', '8.0'), true, '8.0 >= 8.0');
  eq(isTelegramVersionAtLeast('10.1', '8.0'), true, '10.1 >= 8.0');
  eq(isTelegramVersionAtLeast('7.10', '8.0'), false, '7.10 < 8.0');
  eq(isTelegramVersionAtLeast('7.9', '8.0'), false, '7.9 < 8.0');
  eq(isTelegramVersionAtLeast('6.2', '6.2'), true, '6.2 >= 6.2');
  eq(isTelegramVersionAtLeast('6.1', '6.2'), false, '6.1 < 6.2');
  eq(isTelegramVersionAtLeast('', '8.0'), false, 'empty < 8.0');
  eq(isTelegramVersionAtLeast('8', '8.0'), true, '8 >= 8.0 (short form)');
  eq(isTelegramVersionAtLeast('garbage', '8.0'), false, 'garbage < 8.0');
  // Адаптация к main: malformed-строка — false, как в inline-версии main
  // (стековский компаратор давал бы true на '8.' через Number('') === 0).
  eq(isTelegramVersionAtLeast('8.', '8.0'), false, 'malformed 8. < 8.0');

  const setFakeWebApp = (webApp) => {
    // isVerticalSwipesEnabled:false — чтобы конструктор не писал warn
    // о неприменённом swipe-lock (к гейтингу отношения не имеет).
    globalThis.window = { Telegram: { WebApp: { isVerticalSwipesEnabled: false, ...webApp } } };
  };

  // --- Нативный isVersionAtLeast предпочитается, падение — fallback на чистый ---
  setFakeWebApp({ version: '7.0', isVersionAtLeast: () => true });
  eq(new TelegramPlatform().isVersionAtLeast('8.0'), true, 'native isVersionAtLeast wins');
  setFakeWebApp({
    version: '8.0',
    isVersionAtLeast: () => { throw new Error('native broken'); },
  });
  eq(new TelegramPlatform().isVersionAtLeast('8.0'), true, 'native throw → pure fallback');
  setFakeWebApp({ version: '7.0' });
  eq(new TelegramPlatform().isVersionAtLeast('8.0'), false, 'pure fallback 7.0 < 8.0');
  setFakeWebApp({ version: '8.0' });
  eq(new TelegramPlatform().isVersionAtLeast('6.2'), true, 'pure fallback 8.0 >= 6.2');

  console.log('tma-adaptation: ok');
} finally {
  delete globalThis.window;
  rmSync(temp, { recursive: true, force: true });
}
