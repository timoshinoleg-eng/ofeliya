/**
 * SkinArt — DiceBear-рендер скинов-штаммов (Фаза 5).
 *
 * @dicebear/core (MIT) + @dicebear/shapes (код MIT, дизайн CC0 1.0):
 * детерминированный SVG по seed+палитре (стиль 'shapes' — абстрактная
 * геометрия, ложится на вирусную эстетику; мультяшные наборы осознанно
 * не взяты). В бандл идёт только рантайм createAvatar + один стиль.
 *
 * SVG → текстура Phaser: запекаем через scene.load.svg в 56×bakeFactor
 * (та же математика, что у процедурного арта — см. ArtMetrics:
 * ключи 'skin-tex-*' дают artSourceFactor() = bakeFactor()).
 */
import Phaser from 'phaser';
import { createAvatar } from '@dicebear/core';
import * as shapes from '@dicebear/shapes';
import { DEFAULT_SKIN_ID, SkinDef, skinAvatarOptions, skinTextureKey } from './SkinCatalog';
import { artSourceFactor } from '../ArtMetrics';

/** Чистая (без Phaser): SVG скина. Детерминирована опциями каталога. */
export function renderSkinSvg(def: SkinDef): string {
  return createAvatar(shapes, skinAvatarOptions(def)).toString();
}

/** Data URL для загрузки в Phaser. */
export function skinSvgDataUrl(def: SkinDef): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSkinSvg(def))}`;
}

/**
 * Запечь текстуру скина (56 логических px × bakeFactor). Дефолтный скин —
 * каноничный 'virus-player', запекать нечего. Никогда не висит:
 * резолвится и при ошибке загрузки.
 */
export function ensureSkinTexture(scene: Phaser.Scene, def: SkinDef): Promise<void> {
  const key = skinTextureKey(def.id);
  if (def.id === DEFAULT_SKIN_ID || scene.textures.exists(key)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      // Пост-ревью (патч №11): снимаем ОБА слушателя. Раньше once('loaderror')
      // висел после успеха (утечка), а глобальный loaderror чужого файла
      // мог резолвить чужой промис раньше времени.
      scene.load.off(`filecomplete-svg-${key}`, onComplete);
      scene.load.off('loaderror', onError);
      resolve();
    };
    const onComplete = (): void => {
      done();
    };
    const onError = (file?: { key?: unknown }): void => {
      // Событие loaderror — глобальное для очереди; реагируем только на свой файл.
      if (file?.key === key) done();
    };
    scene.load.once(`filecomplete-svg-${key}`, onComplete);
    scene.load.once('loaderror', onError);
    const factor = artSourceFactor(key);
    scene.load.svg(key, skinSvgDataUrl(def), { width: 56 * factor, height: 56 * factor });
    scene.load.start();
  });
}
