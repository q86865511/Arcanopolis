// M2 的世界建立點：組出「一座空城 + 開局資源 + 掛好 system 的 Simulation」交給呈現層。
// render 對 state 一律唯讀（見 CLAUDE.md 架構鐵則 1）——本檔的 addResource 屬「建立 fixture」，
// 只在世界誕生的那一刻寫入；世界跑起來之後的一切變更都必須經 sim.enqueue 下指令。

import { Simulation } from '../core/sim/simulation';
import { createProductionSystem } from '../core/systems/production';
import { addResource, createInitialState, type GameState } from '../core/world/state';
import { TERRAIN_TEXTURES } from './assets';
import { BUILDING_DEFS, RESOURCE_DEFS } from './defs';

/** demo 地圖邊長（格）。 */
export const GRID_SIZE = 12;

const DEMO_SEED = 1;

/**
 * 開局資源：夠蓋十來棟起步建築、又不足以無腦鋪滿全圖——
 * 這樣「資源不足」的紅色預覽在試玩前幾分鐘內就看得到，是刻意的。
 */
const STARTING_RESOURCES: ReadonlyArray<readonly [string, number]> = [
  ['wood', 500],
  ['stone', 200],
  ['food', 100],
  ['gold', 100],
];

export interface DemoWorld {
  state: GameState;
  sim: Simulation;
}

const validResourceIds = new Set(RESOURCE_DEFS.map((def) => def.id));

export function createDemoWorld(): DemoWorld {
  const state = createInitialState(DEMO_SEED);
  for (const [id, amount] of STARTING_RESOURCES) {
    // 資料表改版留下幽靈 id 時要當場曝光，不能讓開局資源悄悄少一項（見 CLAUDE.md 資料驅動鐵則）
    if (!validResourceIds.has(id)) {
      throw new Error(`createDemoWorld: STARTING_RESOURCES 引用未知資源 id "${id}"`);
    }
    addResource(state, id, amount);
  }
  // 初始無建築：城市完全由玩家蓋出來
  const sim = new Simulation(state, [createProductionSystem(BUILDING_DEFS)], BUILDING_DEFS);
  return { state, sim };
}

/**
 * 地形選圖：決定性規則，不用 RNG——同一格永遠是同一張圖，重繪／重開都一致。
 * 主對角線鋪泥土示意道路，其餘草地兩版依格座標雜湊混排避免整片重複。
 */
export function terrainTextureAt(gx: number, gy: number): string {
  if (gx === gy) {
    return TERRAIN_TEXTURES.dirt;
  }
  return (gx * 31 + gy * 17) % 3 === 0 ? TERRAIN_TEXTURES.grassB : TERRAIN_TEXTURES.grassA;
}
