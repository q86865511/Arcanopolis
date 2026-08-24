import buildingsJson from '../../data/buildings.json';
import economyJson from '../../data/economy.json';
import populationJson from '../../data/population.json';
import resourcesJson from '../../data/resources.json';
import terrainEconomyJson from '../../data/terrain-economy.json';
import type { Command } from '../core/sim/commands';
import { Simulation } from '../core/sim/simulation';
import { TICKS_PER_DAY, timeFromTick } from '../core/sim/time';
import { createJobsSystem } from '../core/systems/jobs';
import { createMovementSystem } from '../core/systems/movement';
import { createPopulationSystem } from '../core/systems/population';
import { createProductionSystem } from '../core/systems/production';
import { createRegrowthSystem } from '../core/systems/regrowth';
import { createTaxSystem } from '../core/systems/tax';
import { canBuildAt } from '../core/world/buildable';
import { applyStartingResources } from '../core/world/scenario';
import { createInitialState, getResource, type Building, type Citizen, type GameState } from '../core/world/state';
import {
  parseBuildingDefs,
  parseEconomyConfig,
  parsePopulationConfig,
  parseResourceDefs,
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
const TERRAIN_ECONOMY = parseTerrainEconomy(terrainEconomyJson);

const STRATEGY_INTERVAL_TICKS = 60;
const FOOD_RESERVE_DAYS = 2;
const WOOD_RESERVE = 500;
const FOOD_CHAIN = ['farm', 'mill', 'bakery'] as const;
const OTHER_CHAIN = ['lumber-camp', 'quarry', 'sawmill', 'mine', 'smelter', 'blacksmith'] as const;
const FOOD_CHAIN_WORKERS = FOOD_CHAIN.reduce(
  (sum, type) => sum + (BUILDING_DEFS.find((def) => def.id === type)?.jobs ?? 0),
  0,
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

/** 固定從世界中心向外逐圈搜尋；候選合法性一律由 core 決定。 */
function findBuildSite(state: GameState, def: BuildingDef): { x: number; y: number } | null {
  const center = Math.floor(state.worldSize / 2);
  const maxRadius = Math.max(center, state.worldSize - 1 - center);
  for (let radius = 0; radius <= maxRadius; radius++) {
    const minX = Math.max(0, center - radius);
    const maxX = Math.min(state.worldSize - 1, center + radius);
    const minY = Math.max(0, center - radius);
    const maxY = Math.min(state.worldSize - 1, center + radius);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (Math.max(Math.abs(x - center), Math.abs(y - center)) !== radius) continue;
        if (canBuildAt(state, def, x, y, BUILDING_DEFS)) return { x, y };
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

function shortestChainBuilding(state: GameState, chain: readonly string[]): string {
  let selected = chain[0];
  let selectedCount = Infinity;
  for (const type of chain) {
    const count = state.buildings.filter((building) => building.type === type).length;
    if (count < selectedCount) {
      selected = type;
      selectedCount = count;
    }
  }
  return selected;
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

  const foodReserve =
    Math.max(1, state.citizens.length) * POPULATION_CONFIG.foodPerCitizenPerDay * FOOD_RESERVE_DAYS;
  if (getResource(state, 'food') < foodReserve) {
    const shortest = shortestChainBuilding(state, FOOD_CHAIN);
    const shortestCount = state.buildings.filter((building) => building.type === shortest).length;
    const staffedChainLimit = Math.max(1, Math.ceil(state.citizens.length / FOOD_CHAIN_WORKERS));
    return shortestCount >= staffedChainLimit
      ? buyFoodWithSurplusWood(state, foodReserve)
      : buildCommands(state, shortest);
  }

  if (!state.buildings.some((building) => building.type === 'market')) {
    const commands = buildCommands(state, 'market');
    if (commands.length > 0) return commands;
  }

  return buildCommands(state, shortestChainBuilding(state, OTHER_CHAIN));
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

  const systems = [
    createJobsSystem(BUILDING_DEFS, POPULATION_CONFIG.maxCommuteDistance),
    createProductionSystem(BUILDING_DEFS, TERRAIN_ECONOMY),
    createPopulationSystem(BUILDING_DEFS, POPULATION_CONFIG),
    createTaxSystem(ECONOMY_CONFIG),
    createRegrowthSystem(TERRAIN_ECONOMY),
    createMovementSystem(BUILDING_DEFS, { w: state.worldSize, h: state.worldSize }),
  ];
  const simulation = new Simulation(state, systems, BUILDING_DEFS, {
    resourceDefs: RESOURCE_DEFS,
    economy: ECONOMY_CONFIG,
  });
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
