// Phaser 遊戲實例的組裝點：設定與場景清單集中在這裡，main.ts 只負責呼叫。

import Phaser from 'phaser';
import { BootScene } from './BootScene';
import { CityScene } from './CityScene';

/**
 * 初始（後備）畫布尺寸。scale.mode = RESIZE 時實際尺寸一律由 parent 元素決定，
 * 這兩個值只在 parent 還量不到尺寸的開機瞬間當後備值。
 */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 540;

/** 深藍灰底色：與素材調色盤對比夠，地圖邊界一眼可辨。
 *  RESIZE 模式下視窗大於世界時，世界四周留的也是這個底色（不是黑框）。 */
export const BACKGROUND_COLOR = '#262b44';

/** 除錯掛勾掛在 window 上的屬性名：dev-only，供 Playwright／瀏覽器主控台等外部探針
 *  讀取場景內部狀態（sprite 可見性、攝影機 bounds 等）做視覺驗收用，本 repo 目前無固定消費者，
 *  是臨時掛探針時的既有掛點（見 M3.5 審查 F5）。 */
export const DEBUG_GAME_KEY = '__arcanopolisGame';

export function createGame(parent: string | HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: BACKGROUND_COLOR,
    // 像素美術：關閉平滑並讓繪製對齊整數像素，配合整數倍縮放才不會糊
    pixelArt: true,
    roundPixels: true,
    scale: {
      // 填滿 parent：螢幕越大看到越多地圖，像素維持 1:1 不被拉伸放糊
      // （固定畫布 + CENTER_BOTH 的舊設定在 2K 螢幕只會是中間一塊小方框，四周全黑）。
      mode: Phaser.Scale.RESIZE,
      // RESIZE 下畫布恆等於 parent 尺寸，沒有多餘空間可置中；再置中只會多推一次位移。
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    scene: [BootScene, CityScene],
  });

  // 只在 vite dev 掛上：截圖／探針腳本要讀場景內部狀態（sprite 可見性等）做視覺驗收；
  // production build 走不到這裡，不留全域參照。
  if (isDevBuild()) {
    (window as unknown as Record<string, unknown>)[DEBUG_GAME_KEY] = game;
  }
  return game;
}

/** vite 注入的 import.meta.env 沒有型別宣告（本專案未引入 vite/client），就地窄化即可。 */
function isDevBuild(): boolean {
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
}
