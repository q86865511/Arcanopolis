// 時代階段的純函數：core 的放置驗證與 render 的建築選單共用同一套「解鎖」語義。
// 不依賴 Phaser，也不依賴 state 結構，只吃數字，方便測試與 headless 執行。

import type { BuildingDef, EraDef } from './types';

/** 建築的解鎖人口門檻；資料表省略時視為 0（開局可建）。 */
export function unlockPopulationOf(def: BuildingDef): number {
  return def.unlockAtPopulation ?? 0;
}

/** 人口 ≥ 門檻即解鎖；人口之後掉回門檻以下不影響已放置的建築（呼叫端只在放置時檢查）。 */
export function isBuildingUnlocked(def: BuildingDef, population: number): boolean {
  return population >= unlockPopulationOf(def);
}

/**
 * 建築所屬階段＝minPopulation ≤ 解鎖門檻的最高階段。
 * eras 依 parseEraDefs 保證第一階為 0 且遞增，所以一定找得到。
 */
export function eraOfBuilding(def: BuildingDef, eras: readonly EraDef[]): EraDef {
  const threshold = unlockPopulationOf(def);
  let matched = eras[0];
  for (const era of eras) {
    if (era.minPopulation <= threshold) matched = era;
  }
  return matched;
}

/** 目前人口所在的階段（同上規則，以人口代替門檻）。 */
export function currentEra(population: number, eras: readonly EraDef[]): EraDef {
  let matched = eras[0];
  for (const era of eras) {
    if (era.minPopulation <= population) matched = era;
  }
  return matched;
}

/** 依 eras 順序把建築分組；每一階都有一組（可能為空），保留 defs 原有順序。 */
export function groupBuildingsByEra(
  defs: readonly BuildingDef[],
  eras: readonly EraDef[],
): { era: EraDef; buildings: BuildingDef[] }[] {
  const groups = eras.map((era) => ({ era, buildings: [] as BuildingDef[] }));
  for (const def of defs) {
    const era = eraOfBuilding(def, eras);
    groups[eras.indexOf(era)].buildings.push(def);
  }
  return groups;
}
