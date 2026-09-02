// 建築選單的時代頁籤計算：純函式、零 Phaser 依賴，讓「每一棟建築都選得到」可被測試鎖定。
//
// 為什麼要分頁籤：可用的選擇鍵只有數字鍵 1..9 與 0，共 10 個。建築表一旦超過 10 棟，
// 第 11 棟就會沒有按鍵可綁而永遠選不到——而且是靜默的，畫面上完全沒有提示。
//
// M5-W3 起分組依據從「純索引每 10 棟一頁」改為「建築的解鎖人口門檻所屬的時代階段」
// （data/eras.json）。純索引分頁的頁號對玩家沒有意義，時代則同時是分類與進程提示：
// 玩家看到「小鎮 · 人口12」就知道那一整頁要等人口到 12。分組本身走 data/eras.ts 的
// groupBuildingsByEra，本檔只處理「頁籤索引 ↔ 建築清單 ↔ 數字鍵」這一段。

import type { BuildingDef, EraDef } from '../data/types';
import { groupBuildingsByEra, unlockPopulationOf } from '../data/eras';

/** 一個頁籤可綁的建築數＝可用數字鍵數（1..9 與 0）。 */
export const BUILDINGS_PER_TAB = 10;

/** 頁籤數＝時代階段數；階段表為空時仍回 1，避免除以零與「零個頁籤」的空畫面。 */
export function tabCount(eras: readonly EraDef[]): number {
  return Math.max(1, eras.length);
}

/** 把任意頁籤索引夾回合法範圍，並讓切換在頭尾循環（末頁再往後回到第一頁）。 */
export function wrapTab(tab: number, eras: readonly EraDef[]): number {
  const count = tabCount(eras);
  return ((tab % count) + count) % count;
}

/** 第 tab 個時代階段上的建築，依資料表原有順序；該階段沒有建築時回空陣列。 */
export function buildingsOnTab(
  defs: readonly BuildingDef[],
  eras: readonly EraDef[],
  tab: number,
): BuildingDef[] {
  if (eras.length === 0) return [];
  return groupBuildingsByEra(defs, eras)[wrapTab(tab, eras)].buildings;
}

/**
 * 頁籤文案：已達門檻只印階段名，未達則附上還缺的條件（「小鎮 · 人口12」）。
 * 未解鎖的階段仍可切過去看——看得到下一個時代有什麼，才知道現在為什麼要衝人口。
 */
export function eraTabLabel(era: EraDef, population: number): string {
  if (population >= era.minPopulation) return era.name;
  return `${era.name} · 人口${era.minPopulation}`;
}

/** 選了未解鎖建築時給說明列的提示；點格子與按數字鍵共用同一句話。 */
export function lockedBuildingNotice(def: BuildingDef): string {
  return `${def.name} 需人口 ${unlockPopulationOf(def)} 才能建造`;
}
