// @ts-expect-error 專案未引入 @types/node，CLI 的 Node I/O 僅限此工具皮層。
import { writeFileSync } from 'node:fs';

import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';
import { Simulation } from '../core/sim/simulation';
import { timeFromTick } from '../core/sim/time';
import { createProductionSystem } from '../core/systems/production';
import {
  createInitialState,
  getResource,
  type Building,
  type GameState,
} from '../core/world/state';
import { parseBuildingDefs, parseResourceDefs } from '../data/loader';

declare const process: {
  argv: string[];
  stdout: { write(chunk: string): void };
};

export interface BuildingSpec {
  type: string;
  count: number;
}

export interface FastForwardArgs {
  seed: number;
  ticks: number;
  sampleEvery: number;
  out?: string;
  buildings?: BuildingSpec[];
}

export interface FastForwardOptions {
  seed: number;
  ticks: number;
  sampleEvery: number;
  buildings: Building[];
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

export function parseArgs(argv: string[]): FastForwardArgs {
  const values = new Map<string, string>();
  const supported = new Set(['--seed', '--ticks', '--sample-every', '--out', '--buildings']);

  for (let index = 0; index < argv.length; index += 2) {
    const parameter = argv[index];
    if (!supported.has(parameter)) {
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

  const buildingsValue = values.get('--buildings');
  const args: FastForwardArgs = { seed, ticks, sampleEvery };
  if (out !== undefined) args.out = out;
  if (buildingsValue !== undefined) args.buildings = parseBuildingSpecs(buildingsValue);
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
}

function csvRow(state: GameState): string {
  return [
    state.tick,
    timeFromTick(state.tick).totalDay,
    ...resourceDefs.map((definition) => getResource(state, definition.id)),
  ].join(',');
}

export function runFastForward(options: FastForwardOptions): FastForwardResult {
  validateRunOptions(options);

  const state = createInitialState(options.seed);
  state.buildings = options.buildings.map((building) => ({ ...building }));
  const simulation = new Simulation(state, [createProductionSystem(buildingDefs)]);
  const rows = [['tick', 'totalDay', ...resourceDefs.map((definition) => definition.id)].join(','), csvRow(state)];

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

/** 把 --buildings 的 type:count 規格展開成 Building 實體；未知 type 在跑模擬前就擋下 */
export function expandBuildingSpecs(specs: BuildingSpec[]): Building[] {
  const buildings: Building[] = [];
  for (const spec of specs) {
    if (!buildingDefs.some((def) => def.id === spec.type)) {
      throw new Error(
        `expandBuildingSpecs: 未知建築 type "${spec.type}"（可用：${buildingDefs.map((d) => d.id).join(', ')}）`,
      );
    }
    for (let i = 0; i < spec.count; i++) {
      buildings.push({ id: `${spec.type}-${buildings.length}`, type: spec.type, x: buildings.length, y: 0 });
    }
  }
  return buildings;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const { csv } = runFastForward({
    seed: args.seed,
    ticks: args.ticks,
    sampleEvery: args.sampleEvery,
    buildings: args.buildings === undefined ? [] : expandBuildingSpecs(args.buildings),
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
