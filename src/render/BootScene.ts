// Boot 場景：唯一負責載入素材的地方，載完立刻切到 CityScene，本身不畫任何遊戲內容。
// 新素材一律加進 assets.ts 的 GAME_TEXTURES，不要在其他場景零星 load。

import Phaser from 'phaser';
import { GAME_TEXTURES } from './assets';
import { CITY_SCENE_KEY } from './CityScene';

export const BOOT_SCENE_KEY = 'boot';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(BOOT_SCENE_KEY);
  }

  preload(): void {
    for (const { key, url } of GAME_TEXTURES) {
      this.load.image(key, url);
    }
  }

  create(): void {
    this.scene.start(CITY_SCENE_KEY);
  }
}
