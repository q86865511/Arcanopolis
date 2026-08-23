// 建築選單的分頁計算：純函式、零 Phaser 依賴，讓「每一棟建築都選得到」可被測試鎖定。
//
// 為什麼需要分頁：可用的選擇鍵只有數字鍵 1..9 與 0，共 10 個。建築表一旦超過 10 棟，
// 第 11 棟就會沒有按鍵可綁而永遠選不到——而且是靜默的，畫面上完全沒有提示。
// 分頁把「鍵數」與「建築數」解耦，資料表再長都不會有選不到的建築。

import type { BuildingDef } from '../data/types';

/** 一頁可綁的建築數＝可用數字鍵數（1..9 與 0） */
export const BUILDINGS_PER_PAGE = 10;

export function pageCount(totalBuildings: number): number {
  if (totalBuildings <= 0) return 1;
  return Math.ceil(totalBuildings / BUILDINGS_PER_PAGE);
}

/** 把任意頁碼夾回合法範圍，並讓翻頁在頭尾循環（末頁再往後回到第一頁）。 */
export function wrapPage(page: number, totalBuildings: number): number {
  const count = pageCount(totalBuildings);
  return ((page % count) + count) % count;
}

/** 第 page 頁（0 起算）上的建築，依資料表順序；最後一頁不足 10 棟時只回傳實際數量。 */
export function buildingsOnPage(defs: readonly BuildingDef[], page: number): BuildingDef[] {
  const safePage = wrapPage(page, defs.length);
  const start = safePage * BUILDINGS_PER_PAGE;
  return defs.slice(start, start + BUILDINGS_PER_PAGE);
}
