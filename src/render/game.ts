// Phaser 遊戲實例的組裝點：設定與場景清單集中在這裡，main.ts 只負責呼叫。

import Phaser from 'phaser';
import { BootScene } from './BootScene';
import { CityScene } from './CityScene';

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

/** 深藍灰底色：與素材調色盤對比夠，地圖邊界一眼可辨。 */
export const BACKGROUND_COLOR = '#262b44';

export function createGame(parent: string | HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: BACKGROUND_COLOR,
    // 像素美術：關閉平滑並讓繪製對齊整數像素，配合整數倍縮放才不會糊
    pixelArt: true,
    roundPixels: true,
    scale: {
      // 固定畫布尺寸（不做非整數縮放），置中交給 ScaleManager
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, CityScene],
  });
}
