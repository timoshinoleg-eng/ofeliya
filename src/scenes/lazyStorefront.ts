import type Phaser from 'phaser';

/**
 * P-07: ленивая загрузка StorefrontScene.
 *
 * Сцена витрины и вся платёжная цепочка исключены из boot-списка сцен main.ts.
 * Модуль-уровневый кеш промиса гарантирует одну загрузку чанка и отсутствие
 * гонки double-add при быстрых повторных тапах (R-02): все входы делят один
 * промис, а повторная регистрация защищена проверкой scene.get().
 */

type StorefrontSceneModule = typeof import('./StorefrontScene');

let storefrontModulePromise: Promise<StorefrontSceneModule> | null = null;

export function loadStorefrontScene(): Promise<StorefrontSceneModule> {
  storefrontModulePromise ??= import('./StorefrontScene');
  return storefrontModulePromise;
}

/** Загрузить (при необходимости) зарегистрировать и запустить витрину. */
export function startStorefrontLazy(scene: Phaser.Scene): void {
  void loadStorefrontScene()
    .then(({ StorefrontScene }) => {
      if (!scene.scene.get('Storefront')) scene.scene.add('Storefront', StorefrontScene);
      scene.scene.start('Storefront');
    })
    .catch(() => undefined);
}
