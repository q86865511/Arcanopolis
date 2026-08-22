// 攝影機邊界純算式：依「世界包圍盒」與「當前可視範圍」算出攝影機 bounds（取大＋置中，逐軸判定）。
// 抽離自 CityScene 是為了能在不碰 Phaser 的情況下做單元測試（見 M3.5 審查 S4）。
//
// 為什麼要「取大並置中」而非直接用世界包圍盒：Phaser 的 clampX/clampY 在 bounds 比可視範圍窄時，
// 會把 bounds 的左／上緣釘在畫面左／上緣（不是置中），2K 全螢幕下整張地圖會擠到左上角、
// 右下角空一大片。把 bounds 撐到至少一個畫面大並置中，clamp 的唯一合法位置就變成
// 「世界中心對齊畫面中心」，同時仍擋住把地圖拖出畫面。
//
// 是逐軸判定：某一軸世界已經 >= 可視範圍時，該軸維持世界原值（不擴張、不置中位移）；
// 只有世界比可視範圍窄的軸才會被撐大並置中。

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** @param world 世界包圍盒（世界座標）。@param viewportW/H 當前可視範圍（畫面尺寸／zoom）。 */
export function computeCameraBounds(world: Rect, viewportW: number, viewportH: number): Rect {
  const w = Math.max(world.w, viewportW);
  const h = Math.max(world.h, viewportH);
  const x = world.x + world.w / 2 - w / 2;
  const y = world.y + world.h / 2 - h / 2;
  return { x, y, w, h };
}
