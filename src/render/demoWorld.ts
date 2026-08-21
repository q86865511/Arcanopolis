// M2 展示用的假世界：呈現層在真正的存檔／建造流程接上之前的資料來源。
// 只「產生」state，不修改它——render 層對 core 狀態一律唯讀（見 CLAUDE.md 架構鐵則 1）。
// T3 接上真實 state 後，把 CityScene 的資料來源換掉即可，其餘渲染程式不動。

import { createInitialState, type GameState } from '../core/world/state';
import { TERRAIN_TEXTURES } from './assets';

/** demo 地圖邊長（格）。 */
export const GRID_SIZE = 12;

const DEMO_SEED = 1;

const DEMO_BUILDINGS: ReadonlyArray<{ type: string; x: number; y: number }> = [
  { type: 'lumber-camp', x: 2, y: 2 },
  { type: 'quarry', x: 5, y: 3 },
  { type: 'farm', x: 3, y: 5 },
  { type: 'house', x: 6, y: 6 },
];

export function createDemoState(): GameState {
  const state = createInitialState(DEMO_SEED);
  state.buildings = DEMO_BUILDINGS.map((b, index) => ({
    id: `demo-${index + 1}`,
    type: b.type,
    x: b.x,
    y: b.y,
  }));
  return state;
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
