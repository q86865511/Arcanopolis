import buildingsJson from '../../data/buildings.json';
import economyJson from '../../data/economy.json';
import populationJson from '../../data/population.json';
import resourcesJson from '../../data/resources.json';
import roadsJson from '../../data/roads.json';
import terrainEconomyJson from '../../data/terrain-economy.json';
import type { Command } from '../core/sim/commands';
import { Simulation } from '../core/sim/simulation';
import { createDefaultSystems } from '../core/sim/systemStack';
import { TICKS_PER_DAY, timeFromTick } from '../core/sim/time';
import { canBuildAt } from '../core/world/buildable';
import { applyStartingResources } from '../core/world/scenario';
import { createInitialState, getResource, type Building, type Citizen, type GameState } from '../core/world/state';
import {
  parseBuildingDefs,
  parseEconomyConfig,
  parsePopulationConfig,
  parseResourceDefs,
  parseRoadsConfig,
  parseTerrainEconomy,
} from '../data/loader';
import type { BuildingDef } from '../data/types';

declare const process: {
  argv: string[];
  stdout: { write(chunk: string): void };
};

const RESOURCE_DEFS = parseResourceDefs(resourcesJson);
const RESOURCE_IDS = new Set(RESOURCE_DEFS.map((def) => def.id));
const BUILDING_DEFS = parseBuildingDefs(buildingsJson, RESOURCE_IDS);
const POPULATION_CONFIG = parsePopulationConfig(populationJson);
const ECONOMY_CONFIG = parseEconomyConfig(economyJson);
const ROADS_CONFIG = parseRoadsConfig(roadsJson);
const TERRAIN_ECONOMY = parseTerrainEconomy(terrainEconomyJson);

const STRATEGY_INTERVAL_TICKS = 60;
const FOOD_RESERVE_DAYS = 2;
const WOOD_RESERVE = 500;
const FOOD_CHAIN = ['farm', 'mill', 'bakery'] as const;
const OTHER_CHAIN = ['lumber-camp', 'quarry', 'sawmill', 'mine', 'smelter', 'blacksmith'] as const;

/**
 * 一條食物鏈（農場＋磨坊＋麵包坊）大約養得起幾個人——由資料表推算，不寫死。
 *
 * 麵包坊滿編時每 tick 產 food，但居民只有上半日在工作地（下半日返家，見 movement），
 * 所以一天的有效產出約是 production.food × TICKS_PER_DAY/2；再乘 0.75 折掉通勤時間與
 * 整批交貨的空窗。除以每人每日食量就是這條鏈的承載人數。
 * 這個數字只用來決定「該蓋幾條鏈」，估得保守一點寧可多蓋，不會有正確性問題。
 */
const CITIZENS_PER_FOOD_CHAIN = Math.max(
  1,
  Math.floor(
    (((BUILDING_DEFS.find((def) => def.id === 'bakery')?.production.food ?? 0) * TICKS_PER_DAY) / 2) *
      0.75 /
      POPULATION_CONFIG.foodPerCitizenPerDay,
  ),
);

const STARTING_BUILDINGS: ReadonlyArray<readonly [string, number, number]> = [
  ['house', 0, 2],
  ['house', 3, 2],
  ['farm', 0, 4],
  ['mill', 2, 4],
  ['bakery', 4, 4],
  ['lumber-camp', 2, 0],
];

const STARTING_CITIZENS: ReadonlyArray<readonly [string, number]> = [
  ['citizen#0-0', 0],
  ['citizen#0-1', 0],
  ['citizen#0-2', 0],
  ['citizen#0-3', 0],
  ['citizen#0-4', 1],
  ['citizen#0-5', 1],
];

export interface BalanceOptions {
  seed?: number;
  days?: number;
  sampleEvery?: number;
  worldSize?: number;
}

export interface BalanceSample {
  tick: number;
  day: number;
  population: number;
  housingCapacity: number;
  resources: Record<string, number>;
  buildingCount: number;
}

export interface BalanceResult {
  finalState: GameState;
  samples: BalanceSample[];
  csv: string;
}

export interface BalanceWorld {
  state: GameState;
  simulation: Simulation;
}

function buildingDef(type: string): BuildingDef {
  const def = BUILDING_DEFS.find((candidate) => candidate.id === type);
  if (def === undefined) throw new Error(`balance: 找不到建築定義 "${type}"`);
  return def;
}

export function housingCapacity(state: GameState): number {
  return state.buildings.reduce((sum, building) => sum + buildingDef(building.type).housing, 0);
}

/** 住宅群的重心：搜尋錨點跟著城市長，而非釘死在世界中心。
 *  沒有住宅時（理論上不會發生，起始配置就帶兩間）退回世界中心。 */
function cityCentroid(state: GameState): { x: number; y: number } {
  const houses = state.buildings.filter((b) => buildingDef(b.type).housing > 0);
  const pool = houses.length > 0 ? houses : state.buildings;
  if (pool.length === 0) {
    const center = Math.floor(state.worldSize / 2);
    return { x: center, y: center };
  }
  return {
    x: Math.round(pool.reduce((sum, b) => sum + b.x, 0) / pool.length),
    y: Math.round(pool.reduce((sum, b) => sum + b.y, 0) / pool.length),
  };
}

/**
 * 從住宅重心向外逐圈搜尋；候選合法性一律由 core 的 canBuildAt 決定。
 *
 * 錨點必須是住宅重心而非世界中心：釘死在世界中心時，城市長大後新建築會離住宅越來越遠，
 * 最後落在可通勤半徑外變成永遠沒人上工的空殼（實測有三座採石場距住宅 23.7～33.7 格，
 * 上限是 24），而那些建築仍然吃掉了建造成本——曲線因此把「勞力到不了」誤報成「數值不平衡」。
 * 錨點跟著住宅走之後，通勤距離自然被壓在範圍內，不需要額外的距離過濾。
 */
function findBuildSite(state: GameState, def: BuildingDef): { x: number; y: number } | null {
  const centroid = cityCentroid(state);
  const maxRadius = Math.max(
    centroid.x,
    centroid.y,
    state.worldSize - 1 - centroid.x,
    state.worldSize - 1 - centroid.y,
  );
  for (let radius = 0; radius <= maxRadius; radius++) {
    const minX = Math.max(0, centroid.x - radius);
    const maxX = Math.min(state.worldSize - 1, centroid.x + radius);
    const minY = Math.max(0, centroid.y - radius);
    const maxY = Math.min(state.worldSize - 1, centroid.y + radius);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (Math.max(Math.abs(x - centroid.x), Math.abs(y - centroid.y)) !== radius) continue;
        if (!canBuildAt(state, def, x, y, BUILDING_DEFS)) continue;
        // 不與任何既有建築正交相鄰：保證每棟建築四周都留有可走的空格。
        //
        // 少了這條會把居民活活封在家裡——實測過一次：從住宅重心向外緊密螺旋擺放後，
        // 有居民的家四個正交鄰格全被建築佔滿，他永遠走不出那一格，被指派的工作
        // 到崗數恆為 0，磨坊因此只剩一半產能、全城慢性餓死。canBuildAt 只驗地形與
        // 佔格，不驗連通性，這層要在這裡自己補。
        if (
          state.buildings.some(
            (building) => Math.abs(building.x - x) + Math.abs(building.y - y) === 1,
          )
        ) {
          continue;
        }
        return { x, y };
      }
    }
  }
  return null;
}

function buildCommands(state: GameState, type: string): Command[] {
  const def = buildingDef(type);
  const site = findBuildSite(state, def);
  if (site === null) return [];

  const commands: Command[] = [];
  let requiredGold = def.cost.gold ?? 0;
  const hasMarket = state.buildings.some((building) => buildingDef(building.type).enablesTrade === true);
  for (const [resource, amount] of Object.entries(def.cost)) {
    if (resource === 'gold') continue;
    const deficit = Math.max(0, amount - getResource(state, resource));
    if (deficit === 0) continue;
    const resourceDef = RESOURCE_DEFS.find((candidate) => candidate.id === resource);
    if (!hasMarket || resourceDef?.basePrice === undefined || !Number.isInteger(deficit)) return [];
    requiredGold += deficit * resourceDef.basePrice * (1 + ECONOMY_CONFIG.marketBuyMarkup);
    commands.push({ type: 'trade', direction: 'buy', resource, amount: deficit });
  }
  if (getResource(state, 'gold') < requiredGold) return [];
  commands.push({ type: 'placeBuilding', buildingType: type, ...site });
  return commands;
}

/**
 * 依「目前棟數」由少到多嘗試 chain 內每個型別，回傳第一個蓋得成的指令。
 * 不能只挑棟數最少的硬蓋一個型別——通勤範圍內若沒有合法地形，findBuildSite
 * 會回 null，若不備援其他型別，策略會卡死在同一個蓋不出來的型別上，
 * 鏈上其餘型別永遠輪不到（見 M4.5 平衡實測：quarry 卡死時 lumber-camp/sawmill 也不會被試）。
 */
function buildFromChainAscending(state: GameState, chain: readonly string[]): Command[] {
  const sorted = [...chain].sort(
    (a, b) =>
      state.buildings.filter((building) => building.type === a).length -
      state.buildings.filter((building) => building.type === b).length,
  );
  for (const type of sorted) {
    const commands = buildCommands(state, type);
    if (commands.length > 0) return commands;
  }
  return [];
}

function buyFoodWithSurplusWood(state: GameState, targetFood: number): Command[] {
  if (!state.buildings.some((building) => buildingDef(building.type).enablesTrade === true)) return [];
  const foodDef = RESOURCE_DEFS.find((def) => def.id === 'food');
  const woodDef = RESOURCE_DEFS.find((def) => def.id === 'wood');
  if (foodDef?.basePrice === undefined || woodDef?.basePrice === undefined) return [];

  const desiredFood = Math.max(0, Math.ceil(targetFood - getResource(state, 'food')));
  if (desiredFood === 0) return [];
  const foodBuyPrice = foodDef.basePrice * (1 + ECONOMY_CONFIG.marketBuyMarkup);
  const saleableWood = Math.max(0, Math.floor(getResource(state, 'wood') - WOOD_RESERVE));
  const buyingPower = getResource(state, 'gold') + saleableWood * woodDef.basePrice;
  const foodAmount = Math.min(desiredFood, Math.floor(buyingPower / foodBuyPrice));
  if (foodAmount <= 0) return [];

  const goldShortfall = Math.max(0, foodAmount * foodBuyPrice - getResource(state, 'gold'));
  const woodAmount = Math.ceil(goldShortfall / woodDef.basePrice);
  return [
    ...(woodAmount > 0
      ? [{ type: 'trade', direction: 'sell', resource: 'wood', amount: woodAmount } as const]
      : []),
    { type: 'trade', direction: 'buy', resource: 'food', amount: foodAmount },
  ];
}

/**
 * 腳本化典型玩家：只讀當前狀態，固定節奏、固定優先序、固定座標掃描，不保留外部記憶。
 */
export function playerStrategy(state: GameState): Command[] {
  if (state.tick % STRATEGY_INTERVAL_TICKS !== 0) return [];

  if (state.citizens.length >= housingCapacity(state)) {
    return buildCommands(state, 'house');
  }

  // 勞力預算：已存在的職缺總數不得超過人口。
  //
  // 這是這個策略最重要的一條規則。jobs system 依「離家最近」指派且先搶先贏，不會為了
  // 更重要的產業把已上工的人挪走——所以多開一個養不起的職缺，代價不是那棟建築閒置，
  // 而是把勞力從既有產線稀釋掉。實測過兩種錯法：職缺開太多時，農場與磨坊吃光工人、
  // 麵包坊掛零，穀物與麵粉堆到數千而糧食是 0，全城餓死；反之若完全不開新職缺，
  // 城市就不會成長。因此以「還有沒有沒工作的人」當唯一的開工閘門。
  const totalJobSlots = state.buildings.reduce((sum, building) => sum + buildingDef(building.type).jobs, 0);
  const spareLabour = state.citizens.length - totalJobSlots;

  const foodReserve =
    Math.max(1, state.citizens.length) * POPULATION_CONFIG.foodPerCitizenPerDay * FOOD_RESERVE_DAYS;
  const foodShort = getResource(state, 'food') < foodReserve;

  if (foodShort) {
    // 糧食吃緊且還有閒置勞力 → 補食物鏈最短的一環；沒有閒置勞力就只能花錢應急，
    // 再加蓋只會稀釋現有產線，讓情況更糟。
    if (spareLabour > 0) {
      const commands = buildFromChainAscending(state, FOOD_CHAIN);
      if (commands.length > 0) return commands;
    }
    return buyFoodWithSurplusWood(state, foodReserve);
  }

  if (spareLabour <= 0) return [];

  // 食物鏈優先吃掉閒置勞力：鏈的條數要跟著人口長，三段的棟數也要彼此不落後，
  // 兩者都達標才輪到其他產業。只看「三段是否等長」是不夠的——1/1/1 也是等長，
  // 但人口漲上去之後那一條鏈就餵不飽了。
  const targetChains = Math.max(1, Math.ceil(state.citizens.length / CITIZENS_PER_FOOD_CHAIN));
  const foodCounts = FOOD_CHAIN.map(
    (type) => state.buildings.filter((building) => building.type === type).length,
  );
  if (Math.min(...foodCounts) < targetChains) {
    const commands = buildFromChainAscending(state, FOOD_CHAIN);
    if (commands.length > 0) return commands;
  }

  if (!state.buildings.some((building) => building.type === 'market')) {
    const commands = buildCommands(state, 'market');
    if (commands.length > 0) return commands;
  }

  return buildFromChainAscending(state, OTHER_CHAIN);
}

function findStartingAnchor(state: GameState): { x: number; y: number } {
  const layoutWidth = Math.max(...STARTING_BUILDINGS.map(([, dx]) => dx + 1));
  const layoutHeight = Math.max(...STARTING_BUILDINGS.map(([, , dy]) => dy + 1));
  const centerX = Math.floor((state.worldSize - layoutWidth) / 2);
  const centerY = Math.floor((state.worldSize - layoutHeight) / 2);
  const fits = (x: number, y: number): boolean =>
    STARTING_BUILDINGS.every(([type, dx, dy]) =>
      canBuildAt(state, buildingDef(type), x + dx, y + dy, BUILDING_DEFS),
    );

  for (let radius = 0; radius < state.worldSize; radius++) {
    const minX = centerX - radius;
    const maxX = centerX + radius;
    const minY = centerY - radius;
    const maxY = centerY + radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) !== radius) continue;
        if (fits(x, y)) return { x, y };
      }
    }
  }
  throw new Error(`createBalanceWorld: worldSize=${state.worldSize} 找不到起始建築區域`);
}

export function createBalanceWorld(seed = 1, worldSize?: number): BalanceWorld {
  const state = createInitialState(seed);
  if (worldSize !== undefined) {
    if (!Number.isInteger(worldSize) || worldSize < 10 || worldSize > 2000) {
      throw new Error(`createBalanceWorld: worldSize 必須是 10~2000 的整數，收到 ${String(worldSize)}`);
    }
    state.worldSize = worldSize;
  }
  applyStartingResources(state, RESOURCE_IDS);

  const anchor = findStartingAnchor(state);
  for (const [type, dx, dy] of STARTING_BUILDINGS) {
    const x = anchor.x + dx;
    const y = anchor.y + dy;
    const building: Building = { id: `${type}@${x},${y}#0`, type, x, y };
    state.buildings.push(building);
  }
  for (const [id, homeIndex] of STARTING_CITIZENS) {
    const home = state.buildings[homeIndex];
    if (home === undefined) throw new Error(`createBalanceWorld: homeIndex=${homeIndex} 不存在`);
    const citizen: Citizen = { id, home: home.id, job: null, x: home.x, y: home.y };
    state.citizens.push(citizen);
  }

  const systems = createDefaultSystems({
    buildingDefs: BUILDING_DEFS,
    terrainEconomy: TERRAIN_ECONOMY,
    populationConfig: POPULATION_CONFIG,
    economyConfig: ECONOMY_CONFIG,
    bounds: { w: state.worldSize, h: state.worldSize },
  });
  const simulation = new Simulation(
    state,
    systems,
    BUILDING_DEFS,
    {
      resourceDefs: RESOURCE_DEFS,
      economy: ECONOMY_CONFIG,
    },
    ROADS_CONFIG,
  );
  return { state, simulation };
}

function sampleState(state: GameState): BalanceSample {
  const resources: Record<string, number> = {};
  for (const def of RESOURCE_DEFS) resources[def.id] = getResource(state, def.id);
  return {
    tick: state.tick,
    day: timeFromTick(state.tick).totalDay,
    population: state.citizens.length,
    housingCapacity: housingCapacity(state),
    resources,
    buildingCount: state.buildings.length,
  };
}

function sampleCsv(sample: BalanceSample): string {
  return [
    sample.tick,
    sample.day,
    sample.population,
    sample.housingCapacity,
    ...RESOURCE_DEFS.map((def) => sample.resources[def.id]),
    sample.buildingCount,
  ].join(',');
}

export function runBalanceSimulation(options: BalanceOptions = {}): BalanceResult {
  const seed = options.seed ?? 1;
  const days = options.days ?? 30;
  const sampleEvery = options.sampleEvery ?? TICKS_PER_DAY;
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`runBalanceSimulation: days 必須是正整數，收到 ${String(days)}`);
  }
  if (!Number.isInteger(sampleEvery) || sampleEvery <= 0) {
    throw new Error(`runBalanceSimulation: sampleEvery 必須是正整數，收到 ${String(sampleEvery)}`);
  }

  const { state, simulation } = createBalanceWorld(seed, options.worldSize);
  const targetTick = days * TICKS_PER_DAY;
  const samples = [sampleState(state)];
  for (let nextSample = sampleEvery; state.tick < targetTick; nextSample += sampleEvery) {
    const stopTick = Math.min(nextSample, targetTick);
    while (state.tick < stopTick) {
      for (const command of playerStrategy(state)) simulation.enqueue(command);
      simulation.tick();
    }
    samples.push(sampleState(state));
  }

  const header = [
    'tick',
    'day',
    'population',
    'housingCapacity',
    ...RESOURCE_DEFS.map((def) => def.id),
    'buildingCount',
  ].join(',');
  const csv = `${[header, ...samples.map(sampleCsv)].join('\n')}\n`;
  return { finalState: state, samples, csv };
}

export function main(): void {
  process.stdout.write(runBalanceSimulation().csv);
}

const entryPath = process.argv[1]?.replaceAll('\\', '/').toLowerCase();
const modulePath = decodeURIComponent(new URL(import.meta.url).pathname).toLowerCase();
if (entryPath !== undefined && (modulePath === entryPath || modulePath === `/${entryPath}`)) {
  main();
}
