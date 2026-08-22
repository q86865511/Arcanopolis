// 開局情境常數：起始資源與其套用邏輯。demoWorld（呈現層）與 fastforward（CLI 快轉）的
// --full-sim 情境都要「玩家一開局手上有多少資源」，抽到這裡共用一份真相來源，避免兩處各自
// 硬寫、日後改了一邊忘了改另一邊，導致平衡 CLI 跑出的曲線不再代表實際遊戲開局（見 M3-W3 審查 F6）。

import { addResource, type GameState } from './state';

/**
 * 開局資源：夠蓋十來棟起步建築、又不足以無腦鋪滿全圖——
 * 這樣「資源不足」的紅色預覽在試玩前幾分鐘內就看得到，是刻意的。
 */
export const STARTING_RESOURCES: Readonly<Record<string, number>> = {
  wood: 500,
  stone: 200,
  food: 100,
  gold: 100,
};

/**
 * 把 STARTING_RESOURCES 寫入 state。resourceIds 為呼叫端資料表目前定義的資源 id 集合——
 * 資料表改版留下幽靈 id 時要當場曝光，不能讓開局資源悄悄少一項（見 CLAUDE.md 資料驅動鐵則）。
 */
export function applyStartingResources(state: GameState, resourceIds: ReadonlySet<string>): void {
  for (const [id, amount] of Object.entries(STARTING_RESOURCES)) {
    if (!resourceIds.has(id)) {
      throw new Error(`applyStartingResources: STARTING_RESOURCES 引用未知資源 id "${id}"`);
    }
    addResource(state, id, amount);
  }
}
