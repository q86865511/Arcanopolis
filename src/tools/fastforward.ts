// @ts-expect-error 專案未引入 @types/node，CLI 的 Node I/O 僅限此工具皮層。
import { readFileSync, writeFileSync } from 'node:fs';

import buildingsJson from '../../data/buildings.json';
import populationJson from '../../data/population.json';
import resourcesJson from '../../data/resources.json';
import { Simulation } from '../core/sim/simulation';
import type { System } from '../core/sim/system';
import { timeFromTick } from '../core/sim/time';
import { createJobsSystem } from '../core/systems/jobs';
import { createMovementSystem } from '../core/systems/movement';
import { createPopulationSystem } from '../core/systems/population';
import { createProductionSystem } from '../core/systems/production';
import { applyStartingResources } from '../core/world/scenario';
import {
  createInitialState,
  getResource,
  type Building,
  type GameState,
} from '../core/world/state';
import type { PopulationConfig } from '../data/types';
import { parseBuildingDefs, parsePopulationConfig, parseResourceDefs } from '../data/loader';

declare const process: {
  argv: string[];
  stdout: { write(chunk: string): void };
};

export interface BuildingSpec {
  type: string;
  count: number;
}

/** --grid 未指定時的預設值：--full-sim 情境下的方形地圖邊長（格） */
const DEFAULT_GRID_SIZE = 12;

export interface FastForwardArgs {
  seed: number;
  ticks: number;
  sampleEvery: number;
  out?: string;
  buildings?: BuildingSpec[];
  /** 啟用完整人口模擬情境（jobs+production+population+movement，人口從 0 成長） */
  fullSim?: boolean;
  /** --full-sim 下 movement 的方形地圖邊長，省略時預設 DEFAULT_GRID_SIZE */
  grid?: number;
  /** --full-sim 下取代預設 data/population.json 的人口常數表路徑 */
  populationConfigPath?: string;
}

export interface FastForwardOptions {
  seed: number;
  ticks: number;
  sampleEvery: number;
  buildings: Building[];
  fullSim?: boolean;
  grid?: number;
  populationConfig?: PopulationConfig;
}

export interface FastForwardResult {
  csv: string;
  finalState: GameState;
}

const resourceDefs = parseResourceDefs(resourcesJson);
const resourceIds = new Set(resourceDefs.map((definition) => definition.id));
const buildingDefs = parseBuildingDefs(buildingsJson, resourceIds);

function parseInteger(parameter: string, value: string | undefined): number {
  // 嚴格十進位：拒絕 0x10、1e3、"+5"、"007"、前後空白等 Number() 過寬接受的形式
  if (value === undefined || !/^-?(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`parseArgs: ${parameter} 必須是十進位整數，收到 ${String(value)}`);
  }
  return Number(value);
}

/** 解析 --buildings 的 "type:count,type:count" 格式（count 為正整數，總棟數上限防 OOM） */
const MAX_TOTAL_BUILDINGS = 100_000;

function parseBuildingSpecs(value: string): BuildingSpec[] {
  const specs: BuildingSpec[] = [];
  let total = 0;
  for (const segment of value.split(',')) {
    const match = /^([^:,\s]+):([1-9]\d*)$/.exec(segment);
    if (!match) {
      throw new Error(`parseArgs: --buildings 每段必須是 type:正整數，收到 ${segment}`);
    }
    const count = Number(match[2]);
    total += count;
    if (total > MAX_TOTAL_BUILDINGS) {
      throw new Error(`parseArgs: --buildings 總棟數上限 ${MAX_TOTAL_BUILDINGS}，收到 ${total}`);
    }
    specs.push({ type: match[1], count });
  }
  return specs;
}

/** 無值旗標（只出現、不接參數） */
const FLAG_PARAMS = new Set(['--full-sim']);
/** 有值參數（後面須接一個非 "--" 開頭的值） */
const VALUED_PARAMS = new Set([
  '--seed',
  '--ticks',
  '--sample-every',
  '--out',
  '--buildings',
  '--grid',
  '--population-config',
]);

export function parseArgs(argv: string[]): FastForwardArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  let index = 0;
  while (index < argv.length) {
    const parameter = argv[index];
    if (FLAG_PARAMS.has(parameter)) {
      if (flags.has(parameter)) {
        throw new Error(`parseArgs: ${parameter} 不可重複，收到 ${parameter}`);
      }
      flags.add(parameter);
      index += 1;
      continue;
    }
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

  const seed = parseInteger('--seed', values.get('--seed'));
  const ticks = parseInteger('--ticks', values.get('--ticks'));
  const sampleEvery = parseInteger('--sample-every', values.get('--sample-every'));

  if (ticks <= 0) {
    throw new Error(`parseArgs: --ticks 必須大於 0，收到 ${ticks}`);
  }
  if (sampleEvery <= 0) {
    throw new Error(`parseArgs: --sample-every 必須大於 0，收到 ${sampleEvery}`);
  }

  const out = values.get('--out');
  if (out !== undefined && out.length === 0) {
    throw new Error(`parseArgs: --out 不可為空字串，收到 ${out}`);
  }

  const populationConfigPath = values.get('--population-config');
  if (populationConfigPath !== undefined && !flags.has('--full-sim')) {
    throw new Error('parseArgs: --population-config 僅在 --full-sim 下有效');
  }

  const buildingsValue = values.get('--buildings');
  const args: FastForwardArgs = { seed, ticks, sampleEvery };
  if (out !== undefined) args.out = out;
  if (buildingsValue !== undefined) args.buildings = parseBuildingSpecs(buildingsValue);
  if (flags.has('--full-sim')) args.fullSim = true;
  const gridValue = values.get('--grid');
  if (gridValue !== undefined && !flags.has('--full-sim')) {
    throw new Error('parseArgs: --grid 僅在 --full-sim 下有效');
  }
  if (gridValue !== undefined) {
    const grid = parseInteger('--grid', gridValue);
    if (grid <= 0) {
      throw new Error(`parseArgs: --grid 必須大於 0，收到 ${grid}`);
    }
    args.grid = grid;
  }
  if (populationConfigPath !== undefined) args.populationConfigPath = populationConfigPath;
  return args;
}

function validateRunOptions(options: FastForwardOptions): void {
  if (!Number.isInteger(options.seed)) {
    throw new Error(`runFastForward: seed 必須是整數，收到 ${options.seed}`);
  }
  if (!Number.isInteger(options.ticks) || options.ticks < 0) {
    throw new Error(`runFastForward: ticks 必須是非負整數，收到 ${options.ticks}`);
  }
  if (!Number.isInteger(options.sampleEvery) || options.sampleEvery <= 0) {
    throw new Error(`runFastForward: sampleEvery 必須是正整數，收到 ${options.sampleEvery}`);
  }
  if (options.grid !== undefined && (!Number.isInteger(options.grid) || options.grid <= 0)) {
    throw new Error(`runFastForward: grid 必須是正整數，收到 ${options.grid}`);
  }
}

function csvRow(state: GameState): string {
  return [
    state.tick,
    timeFromTick(state.tick).totalDay,
    state.citizens.length,
    ...resourceDefs.map((definition) => getResource(state, definition.id)),
  ].join(',');
}

const defaultPopulationConfig = parsePopulationConfig(populationJson);

export function runFastForward(options: FastForwardOptions): FastForwardResult {
  validateRunOptions(options);

  const state = createInitialState(options.seed);
  state.buildings = options.buildings.map((building) => ({ ...building }));

  let systems: System[];
  if (options.fullSim) {
    // 完整人口模擬情境：citizens 從 0 開始，靠 population system 逐日成長並經 jobs system
    // 指派工作；movement 需要地圖邊界（方形，邊長 --grid，預設 DEFAULT_GRID_SIZE）。
    state.citizens = [];
    applyStartingResources(state, resourceIds);
    const grid = options.grid ?? DEFAULT_GRID_SIZE;
    const populationConfig = options.populationConfig ?? defaultPopulationConfig;
    systems = [
      createJobsSystem(buildingDefs),
      createProductionSystem(buildingDefs),
      createPopulationSystem(buildingDefs, populationConfig),
      createMovementSystem(buildingDefs, { w: grid, h: grid }),
    ];
  } else {
    // 滿編就業情境：M3 起產出按在職率計算，快轉工具給每棟建築直接配滿工人，
    // 曲線代表「理想產能」；真實人口成長曲線由 --full-sim 情境另跑（T5）。
    // home 借用工作建築本身——僅為滿足存檔引用存在性，快轉情境不模擬住房。
    state.citizens = state.buildings.flatMap((building) => {
      const def = buildingDefs.find((d) => d.id === building.type);
      return Array.from({ length: def?.jobs ?? 0 }, (_, i) => ({
        id: `${building.id}-worker-${i}`,
        home: building.id,
        job: building.id,
        x: building.x,
        y: building.y,
      }));
    });
    systems = [createProductionSystem(buildingDefs)];
  }

  const simulation = new Simulation(state, systems, buildingDefs);
  const rows = [
    ['tick', 'totalDay', 'population', ...resourceDefs.map((definition) => definition.id)].join(','),
    csvRow(state),
  ];

  for (let sampleTick = options.sampleEvery; sampleTick <= options.ticks; sampleTick += options.sampleEvery) {
    simulation.run(sampleTick - state.tick);
    rows.push(csvRow(state));
  }
  if (state.tick !== options.ticks) {
    simulation.run(options.ticks - state.tick);
    rows.push(csvRow(state));
  }

  return { csv: `${rows.join('\n')}\n`, finalState: state };
}

/**
 * 把 --buildings 的 type:count 規格展開成 Building 實體；未知 type 在跑模擬前就擋下。
 * 佈局依 grid 換行（x=i%grid、y=floor(i/grid)）而非排成單一長列——--full-sim 的 movement
 * bounds 是 grid×grid，排成一列會讓超出 grid 棟數之後的建築落在界外，被指派過去的居民永遠
 * 走不到（見 M3-W3 審查 F4）。棟數超出 grid*grid 容量時直接 throw，不要靜默生出界外建築。
 */
export function expandBuildingSpecs(specs: BuildingSpec[], grid: number = DEFAULT_GRID_SIZE): Building[] {
  const capacity = grid * grid;
  const buildings: Building[] = [];
  for (const spec of specs) {
    if (!buildingDefs.some((def) => def.id === spec.type)) {
      throw new Error(
        `expandBuildingSpecs: 未知建築 type "${spec.type}"（可用：${buildingDefs.map((d) => d.id).join(', ')}）`,
      );
    }
    for (let i = 0; i < spec.count; i++) {
      const index = buildings.length;
      if (index >= capacity) {
        throw new Error(
          `expandBuildingSpecs: 建築總數超出 grid=${grid} 容量（${capacity}），第 ${index + 1} 棟已超額`,
        );
      }
      buildings.push({
        id: `${spec.type}-${index}`,
        type: spec.type,
        x: index % grid,
        y: Math.floor(index / grid),
      });
    }
  }
  return buildings;
}

/** --population-config 讀檔＋解析：包一層 try/catch，讓錯誤訊息指名旗標與路徑，
 *  不要讓使用者看到裸的 node:fs 堆疊或 JSON.parse 的 SyntaxError（見 M3-W3 審查 F7）。 */
function loadPopulationConfig(path: string): PopulationConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `main: --population-config 讀取檔案失敗（路徑 "${path}"）：${(error as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `main: --population-config 的 JSON 格式錯誤（路徑 "${path}"）：${(error as Error).message}`,
    );
  }
  return parsePopulationConfig(parsed);
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const populationConfig =
    args.populationConfigPath === undefined ? undefined : loadPopulationConfig(args.populationConfigPath);
  const { csv } = runFastForward({
    seed: args.seed,
    ticks: args.ticks,
    sampleEvery: args.sampleEvery,
    buildings: args.buildings === undefined ? [] : expandBuildingSpecs(args.buildings, args.grid),
    fullSim: args.fullSim,
    grid: args.grid,
    populationConfig,
  });

  if (args.out === undefined) {
    process.stdout.write(csv);
    return;
  }
  writeFileSync(args.out, csv, 'utf8');
}

const entryPath = process.argv[1]?.replaceAll('\\', '/').toLowerCase();
const modulePath = decodeURIComponent(new URL(import.meta.url).pathname).toLowerCase();
if (entryPath !== undefined && (modulePath === entryPath || modulePath === `/${entryPath}`)) {
  main();
}
