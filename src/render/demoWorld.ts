import populationJson from '../../data/population.json';
import { parsePopulationConfig } from '../data/loader';
import { Simulation } from '../core/sim/simulation';
import { createJobsSystem } from '../core/systems/jobs';
import { createMovementSystem } from '../core/systems/movement';
import { createPopulationSystem } from '../core/systems/population';
import { createProductionSystem } from '../core/systems/production';
import { createRegrowthSystem } from '../core/systems/regrowth';
import { createTaxSystem } from '../core/systems/tax';
import { canBuildAt } from '../core/world/buildable';
import { applyStartingResources } from '../core/world/scenario';
import { createInitialState, type Building, type Citizen, type GameState } from '../core/world/state';
import { BUILDING_DEFS, ECONOMY_CONFIG, RESOURCE_DEFS, TERRAIN_ECONOMY } from './defs';

const DEMO_SEED = 1;

export interface DemoWorld {
  state: GameState;
  sim: Simulation;
  startCenter: { x: number; y: number };
}

const validResourceIds = new Set(RESOURCE_DEFS.map((def) => def.id));
const validBuildingTypes = new Set(BUILDING_DEFS.map((def) => def.id));
const POPULATION_CONFIG = parsePopulationConfig(populationJson);

/** 相對於搜尋 anchor 的固定配置；相對位置本身不重疊，合法性全部交給 core。 */
const STARTING_BUILDINGS: ReadonlyArray<readonly [string, number, number]> = [
  ['house', 0, 2],
  ['house', 3, 2],
  // 食物鏈依序放在伐木場之前：既有 jobs system 距離相同時按陣列序指派，六名居民會先填滿三段鏈。
  ['farm', 0, 4],
  ['mill', 2, 4],
  ['bakery', 4, 4],
  ['lumber-camp', 2, 0],
];

// 農場、磨坊、麵包坊各需 2 名工人；6 人是三段食物鏈能同時滿編運轉的最低人口。
const STARTING_CITIZENS: ReadonlyArray<readonly [string, number]> = [
  ['citizen#0-0', 0],
  ['citizen#0-1', 0],
  ['citizen#0-2', 0],
  ['citizen#0-3', 0],
  ['citizen#0-4', 1],
  ['citizen#0-5', 1],
];

/**
 * 從世界中心以 Chebyshev 環由內向外搜尋；每圈固定採上、右、下、左的順時針順序。
 * 所有候選都交給 core canBuildAt，故真實地形、near 條件、footprint 與邊界使用同一判準。
 */
function findStartingAnchor(state: GameState): { x: number; y: number } {
  const layoutWidth = Math.max(...STARTING_BUILDINGS.map(([, dx]) => dx + 1));
  const layoutHeight = Math.max(...STARTING_BUILDINGS.map(([, , dy]) => dy + 1));
  const centerX = Math.floor((state.worldSize - layoutWidth) / 2);
  const centerY = Math.floor((state.worldSize - layoutHeight) / 2);

  const fits = (x: number, y: number): boolean =>
    STARTING_BUILDINGS.every(([type, dx, dy]) => {
      const def = BUILDING_DEFS.find((candidate) => candidate.id === type);
      if (def === undefined) throw new Error(`createDemoWorld: 找不到起始建築定義 "${type}"`);
      return canBuildAt(state, def, x + dx, y + dy, BUILDING_DEFS);
    });

  for (let radius = 0; radius < state.worldSize; radius++) {
    if (radius === 0) {
      if (fits(centerX, centerY)) return { x: centerX, y: centerY };
      continue;
    }
    const left = centerX - radius;
    const right = centerX + radius;
    const top = centerY - radius;
    const bottom = centerY + radius;
    for (let x = left; x <= right; x++) if (fits(x, top)) return { x, y: top };
    for (let y = top + 1; y <= bottom; y++) if (fits(right, y)) return { x: right, y };
    for (let x = right - 1; x >= left; x--) if (fits(x, bottom)) return { x, y: bottom };
    for (let y = bottom - 1; y > top; y--) if (fits(left, y)) return { x: left, y };
  }
  throw new Error(`createDemoWorld: worldSize=${state.worldSize} 找不到可放置全部起始建築的區域`);
}

/**
 * 依既有 state 組出 Simulation。存檔載入與開新局共用同一份系統組裝——
 * 兩邊各自 new 一次的話，日後加系統只改了一邊，載入的存檔會少跑某個系統而行為悄悄不同。
 */
export function createSimulationFor(state: GameState): Simulation {
  return new Simulation(
    state,
    [
      createJobsSystem(BUILDING_DEFS, POPULATION_CONFIG.maxCommuteDistance),
      createProductionSystem(BUILDING_DEFS, TERRAIN_ECONOMY),
      createPopulationSystem(BUILDING_DEFS, POPULATION_CONFIG),
      // 稅收排在人口之後：同一日界先結算餓死/成長，再依「結算後」的就業人數課稅。
      createTaxSystem(ECONOMY_CONFIG),
      createRegrowthSystem(TERRAIN_ECONOMY),
      createMovementSystem(BUILDING_DEFS, { w: state.worldSize, h: state.worldSize }),
    ],
    BUILDING_DEFS,
    { resourceDefs: RESOURCE_DEFS, economy: ECONOMY_CONFIG },
  );
}

export function createDemoWorld(worldSize?: number): DemoWorld {
  const state = createInitialState(DEMO_SEED);
  if (worldSize !== undefined) {
    if (!Number.isInteger(worldSize) || worldSize < 10 || worldSize > 2000) {
      throw new Error(`createDemoWorld: worldSize 必須是 10~2000 的整數，收到 ${String(worldSize)}`);
    }
    state.worldSize = worldSize;
  }
  applyStartingResources(state, validResourceIds);

  const anchor = findStartingAnchor(state);
  for (const [type, dx, dy] of STARTING_BUILDINGS) {
    if (!validBuildingTypes.has(type)) {
      throw new Error(`createDemoWorld: STARTING_BUILDINGS 使用未知 type "${type}"`);
    }
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    const building: Building = { id: `${type}@${x},${y}#0`, type, x, y };
    state.buildings.push(building);
  }

  for (const [id, homeIndex] of STARTING_CITIZENS) {
    const home = state.buildings[homeIndex];
    if (home === undefined) throw new Error(`createDemoWorld: homeIndex=${homeIndex} 不存在`);
    const citizen: Citizen = { id, home: home.id, job: null, x: home.x, y: home.y };
    state.citizens.push(citizen);
  }

  const sim = createSimulationFor(state);

  return {
    state,
    sim,
    startCenter: {
      x: anchor.x + (Math.max(...STARTING_BUILDINGS.map(([, dx]) => dx)) + 1) / 2,
      y: anchor.y + (Math.max(...STARTING_BUILDINGS.map(([, , dy]) => dy)) + 1) / 2,
    },
  };
}
