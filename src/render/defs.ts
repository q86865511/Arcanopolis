// 資料表在呈現層的單一入口：data\*.json 只在這裡解析一次。
// 為什麼要集中：Simulation（套用 placeBuilding）與 isAreaFree（判佔格）都吃 defs 陣列，
// 兩處若各自解析出不同的物件，size/cost 判定會在兩邊漂移；HUD 也需要同一份 name/cost 顯示。

import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';
import terrainEconomyJson from '../../data/terrain-economy.json';
import economyJson from '../../data/economy.json';
import populationJson from '../../data/population.json';
import roadsJson from '../../data/roads.json';
import erasJson from '../../data/eras.json';
import terrainJson from '../../data/terrain.json';
import { parseBuildingDefs, parseEconomyConfig, parseEraDefs, parsePopulationConfig, parseResourceDefs, parseRoadsConfig, parseTerrainDefs, parseTerrainEconomy } from '../data/loader';
import type { BuildingDef } from '../data/types';

export const RESOURCE_DEFS = parseResourceDefs(resourcesJson);

export const TERRAIN_DEFS = parseTerrainDefs(terrainJson);

export const TERRAIN_ECONOMY = parseTerrainEconomy(terrainEconomyJson);

export const ECONOMY_CONFIG = parseEconomyConfig(economyJson);

/** HUD 的人口診斷（resourceDiagnostics.ts）需要與 population system 同一份門檻常數。 */
export const POPULATION_CONFIG = parsePopulationConfig(populationJson);

export const ROADS_CONFIG = parseRoadsConfig(roadsJson);

/** 時代階段：建築選單頁籤的分組與命名來源。 */
export const ERA_DEFS = parseEraDefs(erasJson);

export const BUILDING_DEFS = parseBuildingDefs(
  buildingsJson,
  new Set(RESOURCE_DEFS.map((r) => r.id)),
);

const defsById = new Map(BUILDING_DEFS.map((def) => [def.id, def]));
const resourceNames = new Map(RESOURCE_DEFS.map((r) => [r.id, r.name]));
const terrainNames = new Map(TERRAIN_DEFS.map((t) => [t.id, t.name]));

export function buildingDef(type: string): BuildingDef | undefined {
  return defsById.get(type);
}

/** 查無 def 時退回 1×1：素材/資料表不同步時仍畫得出東西，不讓整個場景炸掉。 */
export function buildingSize(type: string): { w: number; h: number } {
  return defsById.get(type)?.size ?? { w: 1, h: 1 };
}

export function resourceName(id: string): string {
  return resourceNames.get(id) ?? id;
}

export function terrainName(id: string): string {
  return terrainNames.get(id) ?? id;
}
