// M3.9-W3 R2：移動系統在大地圖上的有界最佳努力前進（src/core/systems/movement.ts）
// M3.9-W3 R4：效能回歸護欄（中型地圖固定 tick 數耗時上限）
//
// 動機：movement.ts 目前對每個不同目標做全圖 distanceField（R1 已加上搜尋預算）。
// 但只加預算不夠——目標在預算範圍外時，若原地凍結，居民在大地圖上永遠到不了遠處的家/工作。
// 本檔鎖定「超出預算時從居民格做有界搜尋，仍能繞障礙抵達，且不得無限擺動」的行為契約，
// 並重新驗證 movement 既有不變式（不斜走／速度上限／不越界／抵達即停／存檔等價／不消耗 rng／
// 建築變動即時反映）在有界搜尋下仍然成立。
//
// 鎖定的 API 形狀（本檔測試假設，實作必須遵守；若與此不符請先與規格撰寫者確認，不要改測試）：
//   createMovementSystem(defs, bounds, options?: { searchBudget?: number }): System
// - options 與 searchBudget 皆可省略：省略時使用實作者自訂的預設預算（本檔不假設其數值，
//   只在需要「確定性地」逼出最佳努力路徑時才顯式帶入一個很小的 searchBudget，
//   避免測試結果隨實作者選的預設值不同而變動）。
// - searchBudget 語義比照 R1 的 distanceField maxNodes：每次搜尋工作量受此上限約束；在實際展開格中
//   選 Manhattan 距離最小、再依 (y,x) 決勝的中繼目標，並沿最佳路徑前進。只有所有展開格都沒有
//   更接近最終目標時才可原地不動。
import { describe, expect, it } from 'vitest';
import { createMovementSystem } from '../../src/core/systems/movement';
import { deserializeGameState, serializeGameState } from '../../src/core/save/save';
import { createInitialState } from '../../src/core/world/state';
import type { Building, Citizen } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import type { SimContext, System } from '../../src/core/sim/system';
import type { GameTime } from '../../src/core/sim/time';
import { createRng } from '../../src/core/sim/rng';
import { Simulation } from '../../src/core/sim/simulation';

function makeDefs(): BuildingDef[] {
  return [
    { id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: { wood: 5 }, production: {}, housing: 4, jobs: 0 },
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 1, h: 1 },
      cost: { wood: 10 },
      production: { wood: 2 },
      housing: 0,
      jobs: 2,
    },
  ];
}

function building(overrides: Partial<Building>): Building {
  return { id: 'h1', type: 'house', x: 0, y: 0, ...overrides };
}

function citizen(overrides: Partial<Citizen>): Citizen {
  return { id: 'c1', home: 'h1', job: 'j1', x: 0, y: 0, ...overrides };
}

function makeTime(tickOfDay: number): GameTime {
  return { tickOfDay, day: 1, season: 'spring', year: 1, totalDay: 1 };
}

function makeCtx(tickOfDay: number, seed = 1): SimContext {
  return { rng: createRng(seed), time: makeTime(tickOfDay) };
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** 逐 tick 不變式：座標恆在 bounds 內、單 tick 至多動一軸、每軸位移不超過速度 0.1（與
 *  movement.test.ts 的 assertStepInvariants 同義，本檔獨立成檔故不共用該模組）。 */
function assertStepInvariants(prev: Citizen, cur: Citizen, bounds: { w: number; h: number }): void {
  expect(cur.x).toBeGreaterThanOrEqual(0);
  expect(cur.y).toBeGreaterThanOrEqual(0);
  expect(cur.x).toBeLessThanOrEqual(bounds.w - 1);
  expect(cur.y).toBeLessThanOrEqual(bounds.h - 1);
  const movedX = cur.x !== prev.x;
  const movedY = cur.y !== prev.y;
  expect(movedX && movedY).toBe(false); // 不斜走
  expect(Math.abs(cur.x - prev.x)).toBeLessThanOrEqual(0.1 + 1e-9);
  expect(Math.abs(cur.y - prev.y)).toBeLessThanOrEqual(0.1 + 1e-9);
}

describe('R2 大地圖移動：目標超出搜尋預算仍須前進', () => {
  it('(a) 1000×1000 開闊地，目標遠超預算半徑 → 連跑多 tick 後與目標距離嚴格減少、且逐 tick 不遞增', () => {
    const bounds = { w: 1000, h: 1000 };
    const sys = createMovementSystem(makeDefs(), bounds, { searchBudget: 30 });
    const state = createInitialState(1);
    state.worldSize = 1000;
    state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 900, y: 900 }));
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));
    const target = { x: 900, y: 900 };
    const ctx = makeCtx(0);

    const distances: number[] = [manhattan(state.citizens[0], target)];
    let positionAfterThirtyTicks = { x: 0, y: 0 };
    for (let i = 0; i < 80; i++) {
      sys.update(state, ctx);
      distances.push(manhattan(state.citizens[0], target));
      if (i === 29) {
        positionAfterThirtyTicks = { x: state.citizens[0].x, y: state.citizens[0].y };
      }
    }

    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i - 1] + 1e-9);
    }
    expect(distances[distances.length - 1]).toBeLessThan(distances[0]);
    // (y,x) 決勝會選 y 較小的東向中繼格；若平手比較被放寬，會錯走成 (0,3)。
    expect(positionAfterThirtyTicks).toEqual({ x: 3, y: 0 });
  });

  it('(b) 200×200、home/job 直線中央只有 1×1 建築 → 必須繞過且抵達，不得兩格振盪', () => {
    const bounds = { w: 200, h: 200 };
    const sys = createMovementSystem(makeDefs(), bounds);
    const state = createInitialState(1);
    state.worldSize = 200;
    state.buildings.push(building({ id: 'h1', type: 'house', x: 85, y: 100 }));
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 115, y: 100 }));
    state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 100, y: 100 }));
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 85, y: 100 }));
    const ctx = makeCtx(0);

    let arrivalTick: number | null = null;
    let sawDetour = false;
    const positions: string[] = [];
    for (let tick = 1; tick <= 400; tick++) {
      const prev = { ...state.citizens[0] };
      sys.update(state, ctx);
      const cur = state.citizens[0];
      assertStepInvariants(prev, cur, bounds);
      expect(cur.x > 99 && cur.x < 101 && cur.y > 99 && cur.y < 101).toBe(false);
      if (cur.y !== 100) sawDetour = true;
      positions.push(`${cur.x},${cur.y}`);
      if (cur.x === 115 && cur.y === 100 && arrivalTick === null) arrivalTick = tick;
    }

    expect(sawDetour).toBe(true);
    expect(arrivalTick).not.toBeNull();
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 115, y: 100 });
    expect(new Set(positions.slice(-30)).size).toBe(1);
  });

  it('(c) 面對凹形障礙（U 形死巷，開口背對目標）：不得無限在兩格間反覆跳動', () => {
    const bounds = { w: 12, h: 6 };
    const sys = createMovementSystem(makeDefs(), bounds, { searchBudget: 30 });
    const state = createInitialState(1);
    state.worldSize = 12;
    // 牆：y=2 列 x=3..7 全牆，另外 (7,3) 單獨補一格牆，構成一個只能從 y=4 繞過的凹形障礙。
    let wallIdx = 0;
    for (let x = 3; x <= 7; x++) {
      state.buildings.push(building({ id: `wallTop${wallIdx++}`, type: 'lumber-camp', x, y: 2 }));
    }
    state.buildings.push(building({ id: 'wallStub', type: 'lumber-camp', x: 7, y: 3 }));
    state.buildings.push(building({ id: 'h1', type: 'house', x: 2, y: 3 }));
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 10, y: 3 }));
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 2, y: 3 }));
    const ctx = makeCtx(0);

    const positions: string[] = [];
    for (let i = 0; i < 150; i++) {
      const prev = { ...state.citizens[0] };
      sys.update(state, ctx);
      const cur = state.citizens[0];
      expect(() => cur).not.toThrow();
      assertStepInvariants(prev, cur, bounds);
      positions.push(`${cur.x},${cur.y}`);
    }

    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 10, y: 3 });
    // 尾段必須已抵達並靜止；這同時排除卡死在別處與兩格振盪。
    const tail = new Set(positions.slice(-30));
    expect(tail.size).toBe(1);
  });
});

describe('R2(b) 有界搜尋下，movement 既有不變式仍成立', () => {
  it('抵達目標後貼齊整數座標並靜止（大地圖、明確小預算）', () => {
    const bounds = { w: 300, h: 1 };
    const sys = createMovementSystem(makeDefs(), bounds, { searchBudget: 50 });
    const state = createInitialState(1);
    state.worldSize = 300;
    state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 150, y: 0 }));
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));
    const ctx = makeCtx(0);

    // 距離 150 格、速度 0.1/tick，需 1500 tick 才會抵達；給充分餘裕跑 1600 tick。
    for (let i = 0; i < 1600; i++) sys.update(state, ctx);
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 150, y: 0 });

    // 抵達後續跑不再移動。
    for (let i = 0; i < 20; i++) {
      sys.update(state, ctx);
      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 150, y: 0 });
    }
  });

  it('繞路仍在有界搜尋下正確運作（預算足夠涵蓋繞路範圍時，結果與無界版本一致地抵達）', () => {
    const bounds = { w: 20, h: 3 };
    const sys = createMovementSystem(makeDefs(), bounds, { searchBudget: 500 }); // 20*3=60 格，預算充足
    const state = createInitialState(1);
    state.worldSize = 20;
    state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 19, y: 0 }));
    state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 10, y: 0 })); // 擋在直線正中央
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));
    const ctx = makeCtx(0);

    let sawDetour = false;
    for (let i = 0; i < 400; i++) {
      const prev = { ...state.citizens[0] };
      sys.update(state, ctx);
      const cur = state.citizens[0];
      assertStepInvariants(prev, cur, bounds);
      expect(cur.x > 9 && cur.x < 11 && cur.y > -1 && cur.y < 1).toBe(false); // 不穿越障礙格
      if (cur.y === 1) sawDetour = true;
    }
    expect(sawDetour).toBe(true);
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 19, y: 0 });
  });

  it('serialize→deserialize→續跑，與連續跑同一 state 深相等（大地圖、有界搜尋、含障礙繞路）', () => {
    const bounds = { w: 30, h: 3 };
    const defs = makeDefs();
    const opts = { searchBudget: 40 };

    function buildState() {
      const state = createInitialState(1);
      state.worldSize = 30;
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 29, y: 0 }));
      state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 15, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));
      return state;
    }

    const continuousState = buildState();
    new Simulation(continuousState, [createMovementSystem(defs, bounds, opts)]).run(120);

    const savedState = buildState();
    new Simulation(savedState, [createMovementSystem(defs, bounds, opts)]).run(5);
    const restored = deserializeGameState(serializeGameState(savedState));
    new Simulation(restored, [createMovementSystem(defs, bounds, opts)]).run(115);

    expect(restored.tick).toBe(120);
    expect(restored).toEqual(continuousState);
  });

  it('不消耗 rng：呼叫即 throw 的假 rng 下，有界搜尋仍正常執行並正確移動', () => {
    const bounds = { w: 500, h: 1 };
    const sys = createMovementSystem(makeDefs(), bounds, { searchBudget: 10 });
    const state = createInitialState(1);
    state.worldSize = 500;
    state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 400, y: 0 }));
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));

    const poisonedRng = {
      next: () => {
        throw new Error('movement system 不應呼叫 rng.next()');
      },
      nextInt: () => {
        throw new Error('movement system 不應呼叫 rng.nextInt()');
      },
      getState: () => 0,
      setState: () => {},
    };
    const ctx: SimContext = { rng: poisonedRng, time: makeTime(0) };

    expect(() => sys.update(state, ctx)).not.toThrow();
    expect(manhattan(state.citizens[0], { x: 400, y: 0 })).toBeLessThan(400);
  });

  it('跨格最佳努力成本平手時固定朝較小端點，釘住退化路徑方向', () => {
    const bounds = { w: 3, h: 3 };
    const sys = createMovementSystem(makeDefs(), bounds, { searchBudget: 1 });
    const state = createInitialState(1);
    state.worldSize = 3;
    state.buildings.push(building({ id: 'h1', type: 'house', x: 2, y: 2 }));
    // 半格目標模擬受損存檔；它讓跨格兩端的最佳努力成本精確平手，可直接觀察決勝方向。
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 0.5, y: 0 }));
    state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 0, y: 0 }));
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0.5, y: 1 }));

    sys.update(state, makeCtx(0));

    expect(state.citizens[0]).toMatchObject({ x: 0.4, y: 1 });
  });

  it('路徑中途蓋樓（建築佈局變動）→ 下一 tick 起即時反映，絕不穿越建築格（大地圖、有界搜尋）', () => {
    const bounds = { w: 100, h: 3 };
    const sys = createMovementSystem(makeDefs(), bounds, { searchBudget: 200 });
    const state = createInitialState(1);
    state.worldSize = 100;
    state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 90, y: 0 }));
    state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));
    const ctx = makeCtx(0);

    for (let i = 0; i < 5; i++) sys.update(state, ctx);
    // 玩家在路徑正中央蓋樓
    state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 45, y: 0 }));

    // 直線距離 90 + 繞過單格障礙的額外 2 格 = 92 格路徑長度，速度 0.1/tick 需 920 tick；
    // 已跑 5 tick，這裡再跑 950 tick（留充分餘裕）確保已抵達並貼齊整數座標。
    let sawDetourRow = false;
    for (let i = 0; i < 950; i++) {
      const prev = { ...state.citizens[0] };
      sys.update(state, ctx);
      const cur = state.citizens[0];
      assertStepInvariants(prev, cur, bounds);
      expect(cur.x > 44 && cur.x < 46 && cur.y > -1 && cur.y < 1).toBe(false);
      if (cur.y === 1) sawDetourRow = true;
    }
    expect(sawDetourRow).toBe(true);
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 90, y: 0 });
  });
});

describe('R4 效能回歸護欄（抓數量級退化，不是精確效能）', () => {
  it('200×200 中型地圖、40 位居民、30 棟建築，跑 300 tick 耗時 < 2000ms', () => {
    const bounds = { w: 200, h: 200 };
    const defs = makeDefs();
    const state = createInitialState(1);
    state.worldSize = 200;

    for (let i = 0; i < 20; i++) {
      state.buildings.push(
        building({ id: `house${i}`, type: 'house', x: (i * 9) % 200, y: Math.floor(i / 5) * 15 }),
      );
    }
    for (let i = 0; i < 10; i++) {
      state.buildings.push(
        building({
          id: `camp${i}`,
          type: 'lumber-camp',
          x: 199 - ((i * 11) % 190),
          y: 150 + (i % 5) * 8,
        }),
      );
    }
    for (let i = 0; i < 40; i++) {
      const home = state.buildings[i % 20];
      const job = state.buildings[20 + (i % 10)];
      state.citizens.push({ id: `c${i}`, home: home.id, job: job.id, x: home.x, y: home.y });
    }

    const sys: System = createMovementSystem(defs, bounds);
    const ctx = makeCtx(0);

    const start = Date.now();
    for (let i = 0; i < 300; i++) sys.update(state, ctx);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });
});
