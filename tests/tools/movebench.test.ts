// R1：CLI 參數解析（src/tools/movebench.ts 的 parseArgs）
// R2：量測世界的決定論與道路鋪設（buildBenchWorld）
// R3：量測本身跑得完且指標值域合理（runMoveBench）
// main／檔案寫出的 I/O 皮層不在本檔範圍——比照 tests/tools/fastforward.test.ts 的慣例排除。
import { describe, expect, it } from 'vitest';
import { buildBenchWorld, parseArgs, runMoveBench } from '../../src/tools/movebench';
import { hasRoad } from '../../src/core/world/roads';
import { footprintTiles } from '../../src/core/world/occupancy';
import { parseBuildingDefs, parseResourceDefs } from '../../src/data/loader';
import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';

const buildingDefs = parseBuildingDefs(
  buildingsJson,
  new Set(parseResourceDefs(resourcesJson).map((def) => def.id)),
);

describe('parseArgs（R1）', () => {
  it('全部省略 → 回傳文件化的預設值', () => {
    expect(parseArgs([])).toEqual({
      seed: 1,
      grid: 200,
      citizens: 40,
      buildings: 30,
      ticks: 300,
      roadDensities: [0],
    });
  });

  it('完整參數 → 逐項對應，--search-budget 與 --out 才出現在結果中', () => {
    const args = parseArgs([
      '--seed', '7',
      '--grid', '64',
      '--citizens', '12',
      '--buildings', '8',
      '--ticks', '50',
      '--road-density', '0.25',
      '--search-budget', '128',
      '--out', 'bench.csv',
    ]);
    expect(args).toEqual({
      seed: 7,
      grid: 64,
      citizens: 12,
      buildings: 8,
      ticks: 50,
      roadDensities: [0.25],
      searchBudget: 128,
      out: 'bench.csv',
    });
  });

  it('--road-density 可帶多值 → 依序回傳', () => {
    expect(parseArgs(['--road-density', '0,0.05,1']).roadDensities).toEqual([0, 0.05, 1]);
  });

  it('--citizens 0 合法（純建築世界），--buildings 0 不合法', () => {
    expect(parseArgs(['--citizens', '0']).citizens).toBe(0);
    expect(() => parseArgs(['--buildings', '0'])).toThrow(/buildings/);
  });

  it('非法值 → throw', () => {
    expect(() => parseArgs(['--road-density', '1.5'])).toThrow(/road-density/);
    expect(() => parseArgs(['--road-density', '-0.1'])).toThrow(/road-density/);
    expect(() => parseArgs(['--road-density', '.5'])).toThrow(/road-density/);
    expect(() => parseArgs(['--road-density', ''])).toThrow(/road-density/);
    expect(() => parseArgs(['--grid', '0'])).toThrow(/grid/);
    expect(() => parseArgs(['--ticks', '-3'])).toThrow(/ticks/);
    expect(() => parseArgs(['--citizens', '1e3'])).toThrow(/citizens/);
    expect(() => parseArgs(['--seed'])).toThrow(/seed/);
    expect(() => parseArgs(['--seed', '1', '--seed', '2'])).toThrow(/重複/);
    expect(() => parseArgs(['--nope', '1'])).toThrow(/不支援/);
    expect(() => parseArgs(['--out', ''])).toThrow(/out/);
  });
});

describe('buildBenchWorld（R2）', () => {
  it('同 seed 與參數兩次呼叫 → 深相等', () => {
    const a = buildBenchWorld(3, 40, 10, 8, 0.3);
    const b = buildBenchWorld(3, 40, 10, 8, 0.3);
    expect(a).toEqual(b);
  });

  it('不同 seed → 建築佈局不同（確認真的有用到 rng）', () => {
    const a = buildBenchWorld(1, 40, 10, 8, 0);
    const b = buildBenchWorld(2, 40, 10, 8, 0);
    expect(a.buildings).not.toEqual(b.buildings);
  });

  it('建築互不重疊，居民從自家格出發、job 指向存在的建築', () => {
    const grid = 30;
    const state = buildBenchWorld(5, grid, 12, 10, 0);
    const occupied = new Set<number>();
    for (const building of state.buildings) {
      const def = buildingDefs.find((candidate) => candidate.id === building.type)!;
      for (const tile of footprintTiles(building.x, building.y, def.size.w, def.size.h)) {
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x).toBeLessThan(grid);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(grid);
        const index = tile.y * grid + tile.x;
        expect(occupied.has(index)).toBe(false);
        occupied.add(index);
      }
    }

    expect(state.citizens).toHaveLength(12);
    const byId = new Map(state.buildings.map((building) => [building.id, building]));
    for (const citizen of state.citizens) {
      const home = byId.get(citizen.home);
      expect(home).toBeDefined();
      expect(citizen.x).toBe(home!.x);
      expect(citizen.y).toBe(home!.y);
      expect(byId.get(citizen.job!)).toBeDefined();
      expect(citizen.job).not.toBe(citizen.home);
    }
  });

  it('roadDensity 1 → 所有非建築格都有路，建築格一格都沒有', () => {
    const grid = 20;
    const state = buildBenchWorld(9, grid, 6, 6, 1);
    const occupied = new Set<number>();
    for (const building of state.buildings) {
      const def = buildingDefs.find((candidate) => candidate.id === building.type)!;
      for (const tile of footprintTiles(building.x, building.y, def.size.w, def.size.h)) {
        occupied.add(tile.y * grid + tile.x);
      }
    }
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        expect(hasRoad(state, x, y)).toBe(!occupied.has(y * grid + x));
      }
    }
  });

  it('roadDensity 0 → 完全沒有道路', () => {
    expect(Object.keys(buildBenchWorld(9, 20, 6, 6, 0).roads)).toHaveLength(0);
  });

  it('參數不合法 → throw', () => {
    expect(() => buildBenchWorld(1, 0, 4, 4, 0)).toThrow(/grid/);
    expect(() => buildBenchWorld(1, 10, -1, 4, 0)).toThrow(/citizens/);
    expect(() => buildBenchWorld(1, 10, 4, 0, 0)).toThrow(/buildings/);
    expect(() => buildBenchWorld(1, 2, 4, 5, 0)).toThrow(/容量/);
    expect(() => buildBenchWorld(1, 10, 4, 1, 0)).toThrow(/至少/);
    expect(() => buildBenchWorld(1, 10, 4, 4, 1.2)).toThrow(/roadDensity/);
  });
});

describe('runMoveBench（R3）', () => {
  it('小參數跑完 → 六個欄位齊全且值域合理', () => {
    const result = runMoveBench({
      seed: 1,
      grid: 30,
      citizens: 10,
      buildings: 10,
      ticks: 20,
      roadDensity: 0,
    });

    expect(Object.keys(result).sort()).toEqual(
      ['arrivedPct', 'avgSettledNodes', 'elapsedMs', 'frozenPct', 'p95TickMs', 'searchCalls'].sort(),
    );
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.p95TickMs).toBeGreaterThanOrEqual(0);
    expect(result.p95TickMs).toBeLessThanOrEqual(result.elapsedMs);
    expect(result.frozenPct).toBeGreaterThanOrEqual(0);
    expect(result.frozenPct).toBeLessThanOrEqual(1);
    expect(result.arrivedPct).toBeGreaterThanOrEqual(0);
    expect(result.arrivedPct).toBeLessThanOrEqual(1);
    expect(result.searchCalls).toBeGreaterThan(0);
    expect(result.avgSettledNodes).toBeGreaterThan(0);
  });

  it('ticks 非正整數 → throw', () => {
    expect(() =>
      runMoveBench({ seed: 1, grid: 30, citizens: 4, buildings: 4, ticks: 0, roadDensity: 0 }),
    ).toThrow(/ticks/);
  });
});
