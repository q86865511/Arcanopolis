// M2 的世界建立點：組出「一座空城 + 開局資源 + 掛好 system 的 Simulation」交給呈現層。
// render 對 state 一律唯讀（見 CLAUDE.md 架構鐵則 1）——本檔對 state 的直接寫入（開局資源／
// 建築／居民）屬「建立 fixture」，只在世界誕生的那一刻發生；世界跑起來之後的一切變更都必須
// 經 sim.enqueue 下指令。

import populationJson from '../../data/population.json';
import { parsePopulationConfig } from '../data/loader';
import { Simulation } from '../core/sim/simulation';
import { createJobsSystem } from '../core/systems/jobs';
import { createMovementSystem } from '../core/systems/movement';
import { createPopulationSystem } from '../core/systems/population';
import { createProductionSystem } from '../core/systems/production';
import { applyStartingResources } from '../core/world/scenario';
import { createInitialState, type Building, type Citizen, type GameState } from '../core/world/state';
import { TERRAIN_TEXTURES } from './assets';
import { BUILDING_DEFS, RESOURCE_DEFS } from './defs';

/** demo 地圖邊長（格）。 */
export const GRID_SIZE = 12;

const DEMO_SEED = 1;

export interface DemoWorld {
  state: GameState;
  sim: Simulation;
}

const validResourceIds = new Set(RESOURCE_DEFS.map((def) => def.id));
const validBuildingTypes = new Set(BUILDING_DEFS.map((def) => def.id));

const POPULATION_CONFIG = parsePopulationConfig(populationJson);

/**
 * 開局建築：讓玩家一進場就看得到人口成長與居民走動，不必自己先蓋房子。
 * 直接寫入 state.buildings 屬 fixture 慣例（見上方檔頭說明），id 沿用 placeBuilding 指令的
 * 命名慣例（`${type}@${x},${y}#${tick}`）以利辨識，tick 固定為 0（世界誕生於 tick 0）。
 */
const STARTING_BUILDINGS: ReadonlyArray<readonly [string, number, number]> = [
  ['house', 4, 4],
  ['house', 7, 4],
  ['farm', 5, 6],
  ['lumber-camp', 6, 2],
];

/**
 * 開局居民：讓玩家一進場（首個日界 tick 600 之前）就看得到人口，不必空等 60 秒
 * （SIM_TICK_MS=100）人口才從 0 開始成長。分別安置在兩棟起始 house，job 待 jobs system
 * 首個 tick 自動指派。id 比照 population system 的成長命名慣例 `citizen#<tick>-<序號>`，
 * tick 固定為 0（與 STARTING_BUILDINGS 同理，世界誕生於 tick 0）。
 */
const STARTING_CITIZENS: ReadonlyArray<readonly [string, string, number, number]> = [
  ['citizen#0-0', 'house@4,4#0', 4, 4],
  ['citizen#0-1', 'house@7,4#0', 7, 4],
];

export function createDemoWorld(): DemoWorld {
  const state = createInitialState(DEMO_SEED);
  applyStartingResources(state, validResourceIds);

  for (const [type, x, y] of STARTING_BUILDINGS) {
    // 資料表改版把建築 type 改名/移除時要當場曝光，不能讓開局建築悄悄變成不存在的 def
    // （見 CLAUDE.md 資料驅動鐵則；否則要等 production system 在第一個 tick 才會炸開，
    // 錯誤點離真正的成因——這份 fixture 常數——很遠）
    if (!validBuildingTypes.has(type)) {
      throw new Error(`createDemoWorld: STARTING_BUILDINGS 引用未知建築 type "${type}"`);
    }
    const building: Building = { id: `${type}@${x},${y}#0`, type, x, y };
    state.buildings.push(building);
  }

  const validHomeIds = new Set(state.buildings.map((b) => b.id));
  for (const [id, home, x, y] of STARTING_CITIZENS) {
    if (!validHomeIds.has(home)) {
      throw new Error(`createDemoWorld: STARTING_CITIZENS 引用未知建築 id "${home}"`);
    }
    const citizen: Citizen = { id, home, job: null, x, y };
    state.citizens.push(citizen);
  }

  const sim = new Simulation(
    state,
    [
      createJobsSystem(BUILDING_DEFS),
      createProductionSystem(BUILDING_DEFS),
      createPopulationSystem(BUILDING_DEFS, POPULATION_CONFIG),
      createMovementSystem(BUILDING_DEFS, { w: GRID_SIZE, h: GRID_SIZE }),
    ],
    BUILDING_DEFS,
  );
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
