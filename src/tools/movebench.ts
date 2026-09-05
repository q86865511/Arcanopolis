// 居民移動系統的效能基線量測工具（M6-W3「帶權尋路」前置）。
//
// 只掛 movement 一個 system，用固定 seed 造出可重現的世界，量四件事：
//   1. 純 movement 的耗時（總計與每 tick p95）——改演算法前後的比較基準；
//   2. 尋路工作量（searchCalls / 平均展開節點數）——比毫秒數更不受機器狀態影響；
//   3. frozenPct——「該走卻沒走」的居民-tick 比例，帶權尋路上線後必須維持 0；
//   4. arrivedPct——跑完時已站在目標格的居民比例，用來確認世界參數合理（不是全體塞車）。
//
// --road-density 搭配 --non-road-cost 使用：前者決定世界鋪多少路，後者是非道路格的步進成本 K
// （預設 3，比照 data/roads.json）。跑 --non-road-cost 1 即退回無權重的 BFS 行為，可與帶權版本對照。
//
// 本檔是 CLI 工具不是 core：允許使用 performance.now()（core 的決定論禁令不適用於量測皮層），
// 但世界建構本身仍是 (seed, 參數) 的純函數，同參數兩次跑必得同一個世界。

// @ts-expect-error 專案未引入 @types/node，CLI 的 Node I/O 僅限此工具皮層。
import { writeFileSync } from 'node:fs';

import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';
import { createRng } from '../core/sim/rng';
import { timeFromTick } from '../core/sim/time';
import {
  createMovementSystem,
  UPPER_HALF_END,
  type MovementStats,
} from '../core/systems/movement';
import { footprintTiles } from '../core/world/occupancy';
import { placeRoad } from '../core/world/roads';
import { createInitialState, type Building, type Citizen, type GameState } from '../core/world/state';
import { parseBuildingDefs, parseResourceDefs } from '../data/loader';

declare const process: {
  argv: string[];
  stdout: { write(chunk: string): void };
};

const RESOURCE_IDS = new Set(parseResourceDefs(resourcesJson).map((def) => def.id));
const BUILDING_DEFS = parseBuildingDefs(buildingsJson, RESOURCE_IDS);

/** bench 世界只用這兩種建築：住處與工作地。兩者都必須是 1×1（放置與鋪路都以單格處理）。 */
const HOME_TYPE = 'house';
const JOB_TYPE = 'lumber-camp';

/** 隨機找空格的嘗試次數上限：建築數逼近地圖容量時避免無止境重抽。 */
const MAX_PLACEMENT_ATTEMPTS = 10_000;

export interface MoveBenchArgs {
  seed: number;
  grid: number;
  citizens: number;
  buildings: number;
  ticks: number;
  /** 逐一量測的道路密度清單（--road-density 可用逗號帶多值） */
  roadDensities: number[];
  searchBudget?: number;
  /** 省略時沿用 DEFAULT_NON_ROAD_STEP_COST */
  nonRoadCost?: number;
  out?: string;
}

export interface MoveBenchOptions {
  seed: number;
  grid: number;
  citizens: number;
  buildings: number;
  ticks: number;
  roadDensity: number;
  /** 省略時沿用 movement 自己的預設預算 */
  searchBudget?: number;
  /** 非道路格的步進成本 K；省略時為 DEFAULT_NON_ROAD_STEP_COST，1 即無權重 */
  nonRoadCost?: number;
}

export interface MoveBenchResult {
  /** 所有 tick 的 movement.update 耗時總和（毫秒） */
  elapsedMs: number;
  /** 單 tick 耗時的 95 百分位（nearest-rank） */
  p95TickMs: number;
  /** 「更新前不在目標格」的居民-tick 中，更新後座標完全沒變的比例（0~1，目標 0） */
  frozenPct: number;
  searchCalls: number;
  avgSettledNodes: number;
  /** 跑完時站在當下目標格的居民比例（0~1） */
  arrivedPct: number;
}

export const CSV_HEADER =
  'density,elapsedMs,p95TickMs,frozenPct,searchCalls,avgSettledNodes,arrivedPct';

const DEFAULTS = {
  seed: 1,
  grid: 200,
  citizens: 40,
  buildings: 30,
  ticks: 300,
  roadDensities: [0],
} as const;

/** --non-road-cost 省略時的 K，與 data/roads.json 的 nonRoadStepCost 對齊。 */
const DEFAULT_NON_ROAD_STEP_COST = 3;

function parseInteger(parameter: string, value: string): number {
  // 嚴格十進位，比照 fastforward.ts：拒絕 0x10、1e3、"+5"、"007" 等 Number() 過寬接受的形式
  if (!/^-?(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`parseArgs: ${parameter} 必須是十進位整數，收到 ${value}`);
  }
  return Number(value);
}

function parsePositiveInteger(parameter: string, value: string): number {
  const parsed = parseInteger(parameter, value);
  if (parsed <= 0) {
    throw new Error(`parseArgs: ${parameter} 必須大於 0，收到 ${parsed}`);
  }
  return parsed;
}

function parseNonNegativeInteger(parameter: string, value: string): number {
  const parsed = parseInteger(parameter, value);
  if (parsed < 0) {
    throw new Error(`parseArgs: ${parameter} 不可為負，收到 ${parsed}`);
  }
  return parsed;
}

/** 解析 "0,0.05,1"：每段為 0~1 的十進位小數（不接受 .5、1.5、科學記號） */
function parseRoadDensities(value: string): number[] {
  const densities: number[] = [];
  for (const segment of value.split(',')) {
    if (!/^(0|1)(\.\d+)?$/.test(segment)) {
      throw new Error(`parseArgs: --road-density 每段必須是 0~1 的小數，收到 ${segment}`);
    }
    const density = Number(segment);
    if (density > 1) {
      throw new Error(`parseArgs: --road-density 每段必須是 0~1 的小數，收到 ${segment}`);
    }
    densities.push(density);
  }
  return densities;
}

const VALUED_PARAMS = new Set([
  '--seed',
  '--grid',
  '--citizens',
  '--buildings',
  '--ticks',
  '--road-density',
  '--search-budget',
  '--non-road-cost',
  '--out',
]);

export function parseArgs(argv: string[]): MoveBenchArgs {
  const values = new Map<string, string>();

  let index = 0;
  while (index < argv.length) {
    const parameter = argv[index];
    if (!VALUED_PARAMS.has(parameter)) {
      throw new Error(`parseArgs: 不支援的參數，收到 ${parameter}`);
    }
    if (values.has(parameter)) {
      throw new Error(`parseArgs: ${parameter} 不可重複，收到 ${parameter}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`parseArgs: ${parameter} 缺少值，收到 ${String(value)}`);
    }
    values.set(parameter, value);
    index += 2;
  }

  const seedValue = values.get('--seed');
  const gridValue = values.get('--grid');
  const citizensValue = values.get('--citizens');
  const buildingsValue = values.get('--buildings');
  const ticksValue = values.get('--ticks');
  const densityValue = values.get('--road-density');
  const searchBudgetValue = values.get('--search-budget');
  const nonRoadCostValue = values.get('--non-road-cost');
  const out = values.get('--out');

  if (out !== undefined && out.length === 0) {
    throw new Error(`parseArgs: --out 不可為空字串，收到 ${out}`);
  }

  const args: MoveBenchArgs = {
    seed: seedValue === undefined ? DEFAULTS.seed : parseInteger('--seed', seedValue),
    grid: gridValue === undefined ? DEFAULTS.grid : parsePositiveInteger('--grid', gridValue),
    citizens:
      citizensValue === undefined
        ? DEFAULTS.citizens
        : parseNonNegativeInteger('--citizens', citizensValue),
    buildings:
      buildingsValue === undefined
        ? DEFAULTS.buildings
        : parsePositiveInteger('--buildings', buildingsValue),
    ticks: ticksValue === undefined ? DEFAULTS.ticks : parsePositiveInteger('--ticks', ticksValue),
    roadDensities:
      densityValue === undefined ? [...DEFAULTS.roadDensities] : parseRoadDensities(densityValue),
  };
  if (searchBudgetValue !== undefined) {
    args.searchBudget = parsePositiveInteger('--search-budget', searchBudgetValue);
  }
  if (nonRoadCostValue !== undefined) {
    args.nonRoadCost = parsePositiveInteger('--non-road-cost', nonRoadCostValue);
  }
  if (out !== undefined) args.out = out;
  return args;
}

function benchDef(type: string) {
  const def = BUILDING_DEFS.find((candidate) => candidate.id === type);
  if (def === undefined) {
    throw new Error(`movebench: data/buildings.json 缺少 bench 需要的建築 "${type}"`);
  }
  if (def.size.w !== 1 || def.size.h !== 1) {
    throw new Error(`movebench: bench 建築 "${type}" 必須是 1×1，收到 ${def.size.w}×${def.size.h}`);
  }
  return def;
}

/**
 * 造出量測用世界：隨機（決定論）散佈住處與工作地，居民從自家出發，其餘空格依 roadDensity 鋪路。
 * 同 (seed, grid, citizens, buildings, roadDensity) 兩次呼叫必得深相等的 state。
 */
export function buildBenchWorld(
  seed: number,
  grid: number,
  citizens: number,
  buildings: number,
  roadDensity: number,
): GameState {
  if (!Number.isInteger(seed)) {
    throw new Error(`buildBenchWorld: seed 必須是整數，收到 ${seed}`);
  }
  if (!Number.isInteger(grid) || grid <= 0) {
    throw new Error(`buildBenchWorld: grid 必須是正整數，收到 ${grid}`);
  }
  if (!Number.isInteger(citizens) || citizens < 0) {
    throw new Error(`buildBenchWorld: citizens 必須是非負整數，收到 ${citizens}`);
  }
  if (!Number.isInteger(buildings) || buildings <= 0) {
    throw new Error(`buildBenchWorld: buildings 必須是正整數，收到 ${buildings}`);
  }
  if (buildings > grid * grid) {
    throw new Error(`buildBenchWorld: buildings（${buildings}）超出 grid=${grid} 的容量`);
  }
  if (citizens > 0 && buildings < 2) {
    throw new Error('buildBenchWorld: citizens > 0 時 buildings 至少要 2（住處與工作地各一）');
  }
  if (!Number.isFinite(roadDensity) || roadDensity < 0 || roadDensity > 1) {
    throw new Error(`buildBenchWorld: roadDensity 必須落在 0~1，收到 ${roadDensity}`);
  }

  const homeDef = benchDef(HOME_TYPE);
  const jobDef = benchDef(JOB_TYPE);
  const state = createInitialState(seed);
  state.worldSize = grid;

  // 建築格與居民/道路共用同一份佔用表；bench 建築皆 1×1，footprintTiles 只為防日後換型別時失準。
  const occupied = new Set<number>();
  const homes: Building[] = [];
  const jobs: Building[] = [];
  const homeCount = Math.ceil(buildings / 2);
  const rng = createRng(seed);

  for (let i = 0; i < buildings; i++) {
    const def = i < homeCount ? homeDef : jobDef;
    let x = -1;
    let y = -1;
    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
      const candidateX = rng.nextInt(0, grid - 1);
      const candidateY = rng.nextInt(0, grid - 1);
      if (occupied.has(candidateY * grid + candidateX)) continue;
      x = candidateX;
      y = candidateY;
      break;
    }
    if (x < 0) {
      throw new Error(
        `buildBenchWorld: 第 ${i + 1} 棟建築在 ${MAX_PLACEMENT_ATTEMPTS} 次嘗試內找不到空格（grid=${grid}, buildings=${buildings}）`,
      );
    }
    const building: Building = { id: `${def.id}-${i}`, type: def.id, x, y };
    for (const tile of footprintTiles(x, y, def.size.w, def.size.h)) {
      occupied.add(tile.y * grid + tile.x);
    }
    (def === homeDef ? homes : jobs).push(building);
    state.buildings.push(building);
  }

  for (let i = 0; i < citizens; i++) {
    const home = homes[i % homes.length];
    const job = jobs[i % jobs.length];
    const citizen: Citizen = { id: `c${i}`, home: home.id, job: job.id, x: home.x, y: home.y };
    state.citizens.push(citizen);
  }

  // density 0 時每格都不會中選，直接略過整輪抽樣（結果與跑完迴圈相同，只是省時間）。
  if (roadDensity > 0) {
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        if (occupied.has(y * grid + x)) continue;
        if (rng.next() < roadDensity) placeRoad(state, x, y);
      }
    }
  }

  return state;
}

/** nearest-rank 百分位；空樣本回 0 */
function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function runMoveBench(options: MoveBenchOptions): MoveBenchResult {
  if (!Number.isInteger(options.ticks) || options.ticks <= 0) {
    throw new Error(`runMoveBench: ticks 必須是正整數，收到 ${options.ticks}`);
  }
  const state = buildBenchWorld(
    options.seed,
    options.grid,
    options.citizens,
    options.buildings,
    options.roadDensity,
  );

  const stats: MovementStats = { searchCalls: 0, settledNodes: 0 };
  const roads = { nonRoadStepCost: options.nonRoadCost ?? DEFAULT_NON_ROAD_STEP_COST };
  const system = createMovementSystem(
    BUILDING_DEFS,
    { w: options.grid, h: options.grid },
    options.searchBudget === undefined
      ? { stats, roads }
      : { searchBudget: options.searchBudget, stats, roads },
  );
  // movement 不消耗 rng，但 SimContext 必須帶一個。
  const rng = createRng(options.seed);
  const buildingsById = new Map(state.buildings.map((building) => [building.id, building]));

  const targetOf = (citizen: Citizen, tickOfDay: number): Building | undefined => {
    const targetId =
      tickOfDay < UPPER_HALF_END && citizen.job !== null ? citizen.job : citizen.home;
    return buildingsById.get(targetId);
  };
  const atTarget = (citizen: Citizen, tickOfDay: number): boolean => {
    const target = targetOf(citizen, tickOfDay);
    return target !== undefined && citizen.x === target.x && citizen.y === target.y;
  };

  const tickTimes: number[] = [];
  let pendingCitizenTicks = 0;
  let frozenCitizenTicks = 0;
  let lastTickOfDay = 0;

  for (let tick = 0; tick < options.ticks; tick++) {
    const time = timeFromTick(tick);
    lastTickOfDay = time.tickOfDay;
    // 「該走」以更新前的狀態判定：本 tick 開始時就已站在目標格的居民不列入 frozen 分母。
    const pending = state.citizens.map((citizen) => !atTarget(citizen, time.tickOfDay));
    const before = state.citizens.map((citizen) => ({ x: citizen.x, y: citizen.y }));

    const startedAt = performance.now();
    system.update(state, { rng, time });
    tickTimes.push(performance.now() - startedAt);

    for (let i = 0; i < state.citizens.length; i++) {
      if (!pending[i]) continue;
      pendingCitizenTicks += 1;
      const citizen = state.citizens[i];
      if (citizen.x === before[i].x && citizen.y === before[i].y) frozenCitizenTicks += 1;
    }
  }

  const arrived = state.citizens.filter((citizen) => atTarget(citizen, lastTickOfDay)).length;
  return {
    elapsedMs: tickTimes.reduce((sum, value) => sum + value, 0),
    p95TickMs: percentile(tickTimes, 0.95),
    frozenPct: pendingCitizenTicks === 0 ? 0 : frozenCitizenTicks / pendingCitizenTicks,
    searchCalls: stats.searchCalls,
    avgSettledNodes: stats.searchCalls === 0 ? 0 : stats.settledNodes / stats.searchCalls,
    arrivedPct: state.citizens.length === 0 ? 0 : arrived / state.citizens.length,
  };
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function formatCsvRow(density: number, result: MoveBenchResult): string {
  return [
    density,
    round(result.elapsedMs, 3),
    round(result.p95TickMs, 4),
    round(result.frozenPct, 6),
    result.searchCalls,
    round(result.avgSettledNodes, 2),
    round(result.arrivedPct, 4),
  ].join(',');
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const rows = [CSV_HEADER];
  for (const density of args.roadDensities) {
    const result = runMoveBench({
      seed: args.seed,
      grid: args.grid,
      citizens: args.citizens,
      buildings: args.buildings,
      ticks: args.ticks,
      roadDensity: density,
      searchBudget: args.searchBudget,
      nonRoadCost: args.nonRoadCost,
    });
    rows.push(formatCsvRow(density, result));
  }

  const csv = `${rows.join('\n')}\n`;
  process.stdout.write(csv);
  if (args.out !== undefined) writeFileSync(args.out, csv, 'utf8');
}

const entryPath = process.argv[1]?.replaceAll('\\', '/').toLowerCase();
const modulePath = decodeURIComponent(new URL(import.meta.url).pathname).toLowerCase();
if (entryPath !== undefined && (modulePath === entryPath || modulePath === `/${entryPath}`)) {
  main();
}
