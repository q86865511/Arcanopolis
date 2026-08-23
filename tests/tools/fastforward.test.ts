// R1：CLI 參數解析（src/tools/fastforward.ts 的 parseArgs）
// R2：快轉核心 CSV 格式（src/tools/fastforward.ts 的 runFastForward）
// R3：正確性（lumber-camp 產量、finalState.tick）
// R4：決定論（同 opts 兩次呼叫 → csv 字串相同、finalState 深相等）
// R5（main/檔案寫出的 I/O 皮層）不在本檔測試範圍——由派工簡報明定排除，非 untestable。
import { describe, expect, it } from 'vitest';
import { expandBuildingSpecs, parseArgs, runFastForward } from '../../src/tools/fastforward';
import type { Building } from '../../src/core/world/state';
import { parseBuildingDefs, parseResourceDefs } from '../../src/data/loader';
import { TICKS_PER_DAY } from '../../src/core/sim/time';
import resourcesJson from '../../data/resources.json';
import buildingsJson from '../../data/buildings.json';

const resourceDefs = parseResourceDefs(resourcesJson);
const resourceIds = new Set(resourceDefs.map((r) => r.id));
const buildingDefs = parseBuildingDefs(buildingsJson, resourceIds);
const lumberCampDef = buildingDefs.find((b) => b.id === 'lumber-camp')!;

function lumberCampBuilding(): Building {
  return { id: 'lc-1', type: 'lumber-camp', x: 0, y: 0 };
}

/** house 無 jobs（housing:4），拿來對照 fullSim/非 fullSim 下 population 欄的不同語義 */
function houseBuilding(): Building {
  return { id: 'house-1', type: 'house', x: 0, y: 0 };
}

/** csv 資料列（不含 header）預期出現的 tick 值：0 起每 sampleEvery 一格＋最後一 tick 補列 */
function expectedSampleTicks(ticks: number, sampleEvery: number): number[] {
  const points: number[] = [];
  for (let t = 0; t <= ticks; t += sampleEvery) {
    points.push(t);
  }
  if (points[points.length - 1] !== ticks) {
    points.push(ticks);
  }
  return points;
}

function csvLines(csv: string): string[] {
  return csv.split(/\r?\n/).filter((line) => line.length > 0);
}

describe('parseArgs（R1）', () => {
  it('合法完整參數（含 --out）→ 回傳對應欄位', () => {
    const result = parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--out', 'out.csv']);
    expect(result).toEqual({ seed: 1, ticks: 100, sampleEvery: 10, out: 'out.csv' });
  });

  it('省略 --out → out 為 undefined', () => {
    const result = parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10']);
    expect(result.out).toBeUndefined();
    expect(result).toEqual({ seed: 1, ticks: 100, sampleEvery: 10 });
  });

  it('缺 --seed → throw，訊息含 seed', () => {
    expect(() => parseArgs(['--ticks', '100', '--sample-every', '10'])).toThrow(/seed/);
  });

  it('缺 --ticks → throw，訊息含 ticks', () => {
    expect(() => parseArgs(['--seed', '1', '--sample-every', '10'])).toThrow(/ticks/);
  });

  it('缺 --sample-every → throw，訊息含 sample-every 或 sampleEvery', () => {
    expect(() => parseArgs(['--seed', '1', '--ticks', '100'])).toThrow(/sample-?every/i);
  });

  it('--seed 非整數（小數/非數字字串）→ throw', () => {
    expect(() => parseArgs(['--seed', '1.5', '--ticks', '100', '--sample-every', '10'])).toThrow();
    expect(() => parseArgs(['--seed', 'abc', '--ticks', '100', '--sample-every', '10'])).toThrow();
  });

  it('--ticks 非整數 → throw', () => {
    expect(() => parseArgs(['--seed', '1', '--ticks', '10.5', '--sample-every', '10'])).toThrow();
    expect(() => parseArgs(['--seed', '1', '--ticks', 'xyz', '--sample-every', '10'])).toThrow();
  });

  it('--sample-every 非整數 → throw', () => {
    expect(() => parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '2.2'])).toThrow();
  });

  it('--ticks <= 0 → throw', () => {
    expect(() => parseArgs(['--seed', '1', '--ticks', '0', '--sample-every', '10'])).toThrow();
    expect(() => parseArgs(['--seed', '1', '--ticks', '-5', '--sample-every', '10'])).toThrow();
  });

  it('--sample-every <= 0 → throw', () => {
    expect(() => parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '0'])).toThrow();
    expect(() => parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '-1'])).toThrow();
  });

  it('數值採嚴格十進位：0x10、1e3、007、+5、含空白 → 一律 throw', () => {
    for (const bad of ['0x10', '1e3', '007', '+5', ' 7 ']) {
      expect(() => parseArgs(['--seed', bad, '--ticks', '100', '--sample-every', '10'])).toThrow(/seed/);
    }
  });

  it('--buildings 解析 type:count 逗號分隔格式', () => {
    const result = parseArgs([
      '--seed', '1', '--ticks', '100', '--sample-every', '10',
      '--buildings', 'lumber-camp:3,farm:2',
    ]);
    expect(result.buildings).toEqual([
      { type: 'lumber-camp', count: 3 },
      { type: 'farm', count: 2 },
    ]);
  });

  it('--buildings 省略時欄位不存在；格式非法（缺冒號/count 非正整數）→ throw', () => {
    const result = parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10']);
    expect(result.buildings).toBeUndefined();
    expect(() =>
      parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--buildings', 'lumber-camp']),
    ).toThrow(/buildings/);
    expect(() =>
      parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--buildings', 'farm:0']),
    ).toThrow(/buildings/);
  });

  it('--buildings 總棟數超過上限 → throw（防 OOM）', () => {
    expect(() =>
      parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--buildings', 'farm:100001']),
    ).toThrow(/buildings 總棟數上限/);
  });

  it('--full-sim 為無值旗標 → 解析為 fullSim: true，省略時 fullSim 為 undefined', () => {
    const withFlag = parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--full-sim']);
    expect(withFlag.fullSim).toBe(true);

    const withoutFlag = parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10']);
    expect(withoutFlag.fullSim).toBeUndefined();
  });

  it('--full-sim 可與其他有值參數混合出現在任意位置', () => {
    const result = parseArgs([
      '--full-sim', '--seed', '1', '--ticks', '100', '--sample-every', '10', '--grid', '20',
    ]);
    expect(result).toEqual({ seed: 1, ticks: 100, sampleEvery: 10, fullSim: true, grid: 20 });
  });

  it('--full-sim 重複 → throw', () => {
    expect(() =>
      parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--full-sim', '--full-sim']),
    ).toThrow(/full-sim/);
  });

  it('--grid 解析為正整數；省略時欄位不存在；非正整數 → throw', () => {
    const result = parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--full-sim', '--grid', '16']);
    expect(result.grid).toBe(16);

    const omitted = parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10']);
    expect(omitted.grid).toBeUndefined();

    expect(() =>
      parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--full-sim', '--grid', '0']),
    ).toThrow(/grid/);
    expect(() =>
      parseArgs(['--seed', '1', '--ticks', '100', '--sample-every', '10', '--full-sim', '--grid', '-1']),
    ).toThrow(/grid/);
  });

  it('--population-config 需搭配 --full-sim，否則 throw；搭配時解析為路徑字串', () => {
    const result = parseArgs([
      '--seed', '1', '--ticks', '100', '--sample-every', '10', '--full-sim',
      '--population-config', 'my-config.json',
    ]);
    expect(result.populationConfigPath).toBe('my-config.json');

    expect(() =>
      parseArgs([
        '--seed', '1', '--ticks', '100', '--sample-every', '10',
        '--population-config', 'my-config.json',
      ]),
    ).toThrow(/full-sim/);
  });

  it('expandBuildingSpecs 展開數量正確且未知 type → throw', () => {
    const buildings = expandBuildingSpecs([{ type: 'lumber-camp', count: 2 }, { type: 'farm', count: 1 }]);
    expect(buildings).toHaveLength(3);
    expect(buildings.filter((b) => b.type === 'lumber-camp')).toHaveLength(2);
    expect(new Set(buildings.map((b) => b.id)).size).toBe(3);
    expect(() => expandBuildingSpecs([{ type: 'no-such-type', count: 1 }])).toThrow(/no-such-type/);
  });
});

describe('runFastForward：CSV 格式（R2）', () => {
  it('header 為 tick,totalDay,population, 接 resources.json 順序的資源 id', () => {
    const { csv } = runFastForward({ seed: 1, ticks: 30, sampleEvery: 10, buildings: [] });
    const [header] = csvLines(csv);
    const expectedHeader = ['tick', 'totalDay', 'population', ...resourceDefs.map((r) => r.id)].join(',');
    expect(header).toBe(expectedHeader);
  });

  it('資料列的 tick 值＝0 起每 sampleEvery 一列＋最後一 tick 補列（ticks 非取樣點時）', () => {
    const ticks = 25;
    const sampleEvery = 10;
    const { csv } = runFastForward({ seed: 1, ticks, sampleEvery, buildings: [] });
    const [, ...rows] = csvLines(csv);
    const tickColumn = rows.map((row) => Number(row.split(',')[0]));
    expect(tickColumn).toEqual(expectedSampleTicks(ticks, sampleEvery));
  });

  it('ticks 恰為 sampleEvery 倍數時不重複補最後一列', () => {
    const ticks = 30;
    const sampleEvery = 10;
    const { csv } = runFastForward({ seed: 1, ticks, sampleEvery, buildings: [] });
    const [, ...rows] = csvLines(csv);
    const tickColumn = rows.map((row) => Number(row.split(',')[0]));
    expect(tickColumn).toEqual([0, 10, 20, 30]);
  });

  it('每列欄位數與 header 相同、全為有限數字', () => {
    const { csv } = runFastForward({
      seed: 1,
      ticks: 40,
      sampleEvery: 15,
      buildings: [lumberCampBuilding()],
    });
    const [header, ...rows] = csvLines(csv);
    const columnCount = header.split(',').length;
    for (const row of rows) {
      const fields = row.split(',');
      expect(fields).toHaveLength(columnCount);
      for (const field of fields) {
        expect(Number.isFinite(Number(field))).toBe(true);
      }
    }
  });

  it('tick 0 那列資源全 0', () => {
    const { csv } = runFastForward({
      seed: 1,
      ticks: 20,
      sampleEvery: 5,
      buildings: [lumberCampBuilding()],
    });
    const [header, firstRow] = csvLines(csv);
    const columns = header.split(',');
    const fields = firstRow.split(',');
    expect(fields[0]).toBe('0');
    for (const resourceDef of resourceDefs) {
      const idx = columns.indexOf(resourceDef.id);
      expect(Number(fields[idx])).toBe(0);
    }
  });
});

describe('runFastForward：正確性（R3）', () => {
  it('單一 lumber-camp → wood 欄隨列嚴格遞增，最後一列 wood ＝ 每 tick 產量 × ticks，finalState.tick ＝ ticks', () => {
    const ticks = 50;
    const sampleEvery = 7;
    const { csv, finalState } = runFastForward({
      seed: 1,
      ticks,
      sampleEvery,
      buildings: [lumberCampBuilding()],
    });
    const [header, ...rows] = csvLines(csv);
    const columns = header.split(',');
    const woodIdx = columns.indexOf('wood');

    const woodValues = rows.map((row) => Number(row.split(',')[woodIdx]));
    for (let i = 1; i < woodValues.length; i++) {
      expect(woodValues[i]).toBeGreaterThan(woodValues[i - 1]);
    }

    const expectedFinalWood = lumberCampDef.production.wood * ticks;
    expect(woodValues[woodValues.length - 1]).toBe(expectedFinalWood);
    expect(finalState.tick).toBe(ticks);
  });
});

describe('runFastForward：決定論（R4）', () => {
  it('同 opts 呼叫兩次 → csv 字串完全相同、finalState 深相等', () => {
    const opts = { seed: 999, ticks: 63, sampleEvery: 9, buildings: [lumberCampBuilding()] };
    const first = runFastForward(opts);
    const second = runFastForward(opts);

    expect(second.csv).toBe(first.csv);
    expect(second.finalState).toEqual(first.finalState);
  });
});

describe('runFastForward：fullSim 分支（F5，M3-W3 審查裁決）', () => {
  it('(a) fullSim 下 population 欄隨日成長；同建築非 fullSim 下 population 欄恆為工人數（house 無 jobs → 恆 0）', () => {
    // house 只提供住房、無 jobs：非 fullSim 情境「population = 工人數」語義下應恆為 0，
    // 與 fullSim 情境「population = citizens.length，從 0 隨日界成長」形成對照。
    const fullSim = runFastForward({
      seed: 1,
      ticks: TICKS_PER_DAY,
      sampleEvery: TICKS_PER_DAY,
      buildings: [houseBuilding()],
      fullSim: true,
    });
    const [, ...fullSimRows] = csvLines(fullSim.csv);
    const fullSimPopulation = fullSimRows.map((row) => Number(row.split(',')[2]));
    expect(fullSimPopulation).toEqual([0, 1]); // tick0：世界剛建立；tick600（首個日界）：糧食/住房皆足額，成長 1 人
    expect(fullSim.finalState.citizens.length).toBe(1);

    const notFullSim = runFastForward({
      seed: 1,
      ticks: TICKS_PER_DAY,
      sampleEvery: TICKS_PER_DAY,
      buildings: [houseBuilding()],
    });
    const [, ...notFullSimRows] = csvLines(notFullSim.csv);
    const notFullSimPopulation = notFullSimRows.map((row) => Number(row.split(',')[2]));
    expect(notFullSimPopulation).toEqual([0, 0]);
  });

  it('(b) populationConfig 覆寫生效：growthPerDay 調大 → 同 ticks 下人口成長更多', () => {
    const base = runFastForward({
      seed: 1,
      ticks: TICKS_PER_DAY,
      sampleEvery: TICKS_PER_DAY,
      buildings: [houseBuilding()],
      fullSim: true,
    });

    const overridden = runFastForward({
      seed: 1,
      ticks: TICKS_PER_DAY,
      sampleEvery: TICKS_PER_DAY,
      buildings: [houseBuilding()],
      fullSim: true,
      populationConfig: {
        foodPerCitizenPerDay: 1,
        growthPerDay: 3,
        growthFoodReserveDays: 1,
        starvationDeathsPerDay: 1,
        maxCommuteDistance: 24,
      },
    });

    expect(base.finalState.citizens.length).toBe(1);
    expect(overridden.finalState.citizens.length).toBe(3); // min(growthPerDay=3, housing 4 空位) = 3
    expect(overridden.finalState.citizens.length).not.toBe(base.finalState.citizens.length);
  });

  it('(c) fullSim 下起始資源正確出現在第一列（wood500/stone200/food100/gold150，即使 buildings 為空）', () => {
    const { csv } = runFastForward({ seed: 1, ticks: 10, sampleEvery: 10, buildings: [], fullSim: true });
    const [header, firstRow] = csvLines(csv);
    const columns = header.split(',');
    const fields = firstRow.split(',');
    expect(fields[0]).toBe('0');

    const expected: Record<string, number> = { wood: 500, stone: 200, food: 100, gold: 150 };
    for (const [id, amount] of Object.entries(expected)) {
      const idx = columns.indexOf(id);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(Number(fields[idx])).toBe(amount);
    }
  });
});
