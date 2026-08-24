// M4.5-W2 整批產出：宣告 workTicks 的建築累積進度，滿一批才把產出一次入帳。
import { describe, expect, it } from 'vitest';
import { createProductionSystem } from '../../src/core/systems/production';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';
import type { SimContext } from '../../src/core/sim/system';
import { addResource, createInitialState, getResource, type GameState } from '../../src/core/world/state';
import type { BuildingDef, TerrainEconomy } from '../../src/data/types';
import { deserializeGameState, serializeGameState } from '../../src/core/save/save';

const WORK_TICKS = 10;

const DEFS: BuildingDef[] = [
  // 分批：一批 10 tick，滿載時每 tick 名目 3 → 一批 30
  { id: 'batched', name: '分批工坊', size: { w: 1, h: 1 }, cost: {}, production: { wood: 3 }, housing: 0, jobs: 2, workTicks: WORK_TICKS },
  // 不分批（省略 workTicks）：維持逐 tick 產出
  { id: 'continuous', name: '連續工坊', size: { w: 1, h: 1 }, cost: {}, production: { wood: 3 }, housing: 0, jobs: 2 },
  // 吃原料的分批工坊
  { id: 'refiner', name: '精煉坊', size: { w: 1, h: 1 }, cost: {}, production: { iron: 1 }, inputs: { wood: 2 }, housing: 0, jobs: 1, workTicks: WORK_TICKS },
  // 吃地形的分批工坊
  { id: 'digger', name: '採石坊', size: { w: 1, h: 1 }, cost: {}, production: { stone: 2 }, housing: 0, jobs: 1, workTicks: WORK_TICKS, terrain: { on: ['rock'], consumes: ['rock'] } },
];

const ECONOMY: TerrainEconomy = { forestWoodCapacity: 40, rockStoneCapacity: 40, forestRegrowDays: 5 };

function ctx(tick: number): SimContext {
  return { rng: createRng(1), time: timeFromTick(tick) };
}

function world(type: string, workers: number, x = 4, y = 4): GameState {
  const state = createInitialState(1);
  state.buildings.push({ id: 'b1', type, x, y });
  for (let i = 0; i < workers; i++) {
    state.citizens.push({ id: `w${i}`, home: 'h', job: 'b1', x, y });
  }
  return state;
}

function run(state: GameState, ticks: number, defs = DEFS, economy = ECONOMY): void {
  const sys = createProductionSystem(defs, economy);
  for (let tick = 1; tick <= ticks; tick++) sys.update(state, ctx(tick));
}

describe('整批產出', () => {
  it('滿編：未滿一批時資源池不動，滿一批才一次入帳', () => {
    const state = world('batched', 2);
    run(state, WORK_TICKS - 1);
    expect(getResource(state, 'wood')).toBe(0);
    run(state, 1);
    expect(getResource(state, 'wood')).toBe(3 * WORK_TICKS);
  });

  it('連續多批：每滿一批入帳一次，總量等於逐 tick 產出的總和', () => {
    const state = world('batched', 2);
    run(state, WORK_TICKS * 4);
    expect(getResource(state, 'wood')).toBe(3 * WORK_TICKS * 4);
  });

  it('半編：進度只走一半，一批要兩倍時間——平均產率與分批前相同', () => {
    const state = world('batched', 1); // 1/2 在職
    run(state, WORK_TICKS * 2 - 1);
    expect(getResource(state, 'wood')).toBe(0);
    run(state, 1);
    expect(getResource(state, 'wood')).toBe(3 * WORK_TICKS);
  });

  it('無人在崗：進度完全不走，永遠不產出', () => {
    const state = world('batched', 0);
    run(state, WORK_TICKS * 5);
    expect(getResource(state, 'wood')).toBe(0);
    expect(state.buildings[0].progress ?? 0).toBe(0);
  });

  it('省略 workTicks 的建築維持逐 tick 產出，不受分批影響', () => {
    const state = world('continuous', 2);
    run(state, 1);
    expect(getResource(state, 'wood')).toBe(3);
    run(state, 1);
    expect(getResource(state, 'wood')).toBe(6);
  });

  it('progress 存在 building 上並隨 tick 前進，滿批後歸零重來', () => {
    const state = world('batched', 2);
    run(state, 3);
    expect(state.buildings[0].progress).toBeCloseTo(3, 6);
    run(state, WORK_TICKS - 3);
    expect(state.buildings[0].progress).toBeCloseTo(0, 6);
  });

  it('原料逐 tick 扣：中斷時已投入的原料不會浪費在未完成的批次上', () => {
    const state = world('refiner', 1);
    addResource(state, 'wood', 2 * 4); // 只夠 4 tick 的料
    run(state, 4);
    expect(getResource(state, 'wood')).toBe(0);
    expect(state.buildings[0].progress).toBeCloseTo(4, 6);
    // 補料後接著做完同一批，總產出仍是完整一批
    addResource(state, 'wood', 2 * (WORK_TICKS - 4));
    run(state, WORK_TICKS - 4);
    expect(getResource(state, 'iron')).toBe(1 * WORK_TICKS);
  });

  it('原料不足時進度停住而不是產出半批', () => {
    const state = world('refiner', 1);
    addResource(state, 'wood', 2 * 3);
    run(state, WORK_TICKS * 2);
    expect(getResource(state, 'iron')).toBe(0);
    expect(state.buildings[0].progress).toBeCloseTo(3, 6);
  });

  it('地形採乾後結算未完成的進度：已挖出的資源不會卡在批次裡消失', () => {
    const state = world('digger', 1, 6, 6);
    // 腳下石礦只有 6 單位，採石坊每 tick 名目 2 → 3 tick 採乾，遠不足一批
    state.terrainOverrides['6,6'] = { type: 'rock', resource: 6 };
    run(state, WORK_TICKS);
    // 總量守恆：挖出多少就入帳多少，不多也不少
    expect(getResource(state, 'stone')).toBe(6);
    expect(state.buildings[0].progress).toBe(0);
  });

  it('結算過的進度不會重複入帳', () => {
    const state = world('digger', 1, 6, 6);
    state.terrainOverrides['6,6'] = { type: 'rock', resource: 6 };
    run(state, WORK_TICKS);
    const afterFlush = getResource(state, 'stone');
    run(state, WORK_TICKS * 3);
    expect(getResource(state, 'stone')).toBe(afterFlush);
  });

  it('決定論：同輸入跑兩次，資源與 progress 都完全相同', () => {
    const a = world('batched', 1);
    const b = world('batched', 1);
    run(a, 17);
    run(b, 17);
    expect(getResource(a, 'wood')).toBe(getResource(b, 'wood'));
    expect(a.buildings[0].progress).toBe(b.buildings[0].progress);
  });
});

describe('progress 的存檔往返（v5）', () => {
  it('未完成的進度存得起來也讀得回來，載入後接著做完同一批', () => {
    const state = world('batched', 2);
    run(state, 4);
    expect(state.buildings[0].progress).toBeCloseTo(4, 6);

    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.buildings[0].progress).toBeCloseTo(4, 6);

    // 從存檔續跑：再 WORK_TICKS-4 tick 就該交出完整一批，不是重頭累積
    run(restored, WORK_TICKS - 4);
    expect(getResource(restored, 'wood')).toBe(3 * WORK_TICKS);
  });

  it('v4 舊檔（建築無 progress 欄）可載入，進度視為 0', () => {
    const state = world('batched', 2);
    const raw = JSON.parse(serializeGameState(state)) as Record<string, unknown>;
    raw.schemaVersion = 4;
    for (const building of raw.buildings as Array<Record<string, unknown>>) {
      delete building.progress;
    }

    const restored = deserializeGameState(JSON.stringify(raw));
    expect(restored.schemaVersion).toBe(5);
    expect(restored.buildings[0].progress ?? 0).toBe(0);
    run(restored, WORK_TICKS);
    expect(getResource(restored, 'wood')).toBe(3 * WORK_TICKS);
  });

  it('progress 為負或非數值 → deserialize 拒收', () => {
    const state = world('batched', 2);
    for (const bad of [-1, 'x', Number.NaN]) {
      const raw = JSON.parse(serializeGameState(state)) as Record<string, unknown>;
      (raw.buildings as Array<Record<string, unknown>>)[0].progress = bad;
      expect(() => deserializeGameState(JSON.stringify(raw))).toThrow(/progress/);
    }
  });
});

describe('第二審發現的邊界（M4.5-W2 修正批）', () => {
  it('存檔帶進超出一批的 progress → 夾在一批，不會每 tick 重複出貨', () => {
    const state = world('batched', 2);
    // 手改存檔或資料表把 workTicks 調小後載入舊檔，都可能出現這種值
    state.buildings[0].progress = WORK_TICKS * 100;
    run(state, 5);
    // 夾住後最多結算一批；沒夾的話 5 tick 會出 5 批
    expect(getResource(state, 'wood')).toBeLessThanOrEqual(3 * WORK_TICKS);
  });

  it('progress 為負的存檔值不會反向扣資源', () => {
    const state = world('batched', 2);
    state.buildings[0].progress = -50;
    run(state, WORK_TICKS);
    expect(getResource(state, 'wood')).toBe(3 * WORK_TICKS);
  });

  it('地形採乾時即使同時缺原料、缺工人，未完成的進度一樣會結算', () => {
    const defs: BuildingDef[] = [
      {
        id: 'mixed',
        name: '混合坊',
        size: { w: 1, h: 1 },
        cost: {},
        production: { stone: 2 },
        inputs: { wood: 1 },
        housing: 0,
        jobs: 1,
        workTicks: 50,
        terrain: { on: ['rock'], consumes: ['rock'] },
      },
    ];
    const state = createInitialState(1);
    state.buildings.push({ id: 'b1', type: 'mixed', x: 6, y: 6 });
    state.citizens.push({ id: 'w', home: 'h', job: 'b1', x: 6, y: 6 });
    // 地形夠 2 tick、原料也剛好夠 2 tick：第 3 tick 時地形採乾且原料同時見底，
    // 舊條件要求 inputRatio > 0 才結算，這種同時斷炊的情形會讓已挖出的石材永遠卡在進度裡。
    state.terrainOverrides['6,6'] = { type: 'rock', resource: 4 };
    addResource(state, 'wood', 2);
    run(state, 100, defs);

    // 挖出多少就要入帳多少；卡在進度裡出不來等於資源被吃掉
    expect(getResource(state, 'stone')).toBeGreaterThan(0);
    expect(state.buildings[0].progress).toBe(0);
  });
});
