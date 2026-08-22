// M3-T3 R2：居民移動 system（src/core/systems/movement.ts）
// M3-T3 R3：整合（Simulation 掛 movement，home↔job 折返）
//
// 規格缺口說明（本檔撰寫時的處理方式，未於簡報明文規定的細節一律迴避，不臆測鎖定）：
// - R2(b) 沿 A* 路徑逐 waypoint 前進時，轉彎中繼點是否「貼齊整數座標」簡報未明講，
//   只有「抵達目標格（最終 home/job）」明訂要 snap。本檔測試刻意只用「同一列直線」情境
//   （見 (c) 與 R3）：路徑無轉彎，迴避這個未鎖定的細節，只驗證「最終有沒有正確抵達」，
//   不斷言轉彎中繼點的逐 tick 精確浮點值。
// - 逐 tick 位移量斷言一律用 toBeCloseTo（非 toBe），因 0.1 反覆浮點相加本身就有累積誤差，
//   只有「snap 後」的最終整數座標才用 toBe 做精確比對。
//
// M3-W2 重工補測（F1/F2/F3/F7 裁決）：上述「刻意迴避轉彎中繼點」的缺口已由檔尾
// 「M3-W2 重工回歸」describe 補上——步進模型已鎖定為「無跨 tick 記憶、單 tick 單軸、
// 座標正規化到 0.1 網格」，轉彎情境的逐 tick 不變式（不斜走／不越界／不穿牆／存檔等價）
// 因此可被斷言。原有斷言一條未改。
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
import { TICKS_PER_DAY } from '../../src/core/sim/time';

function makeDefs(): BuildingDef[] {
  return [
    {
      id: 'house',
      name: '民居',
      size: { w: 1, h: 1 },
      cost: { wood: 5 },
      production: {},
      housing: 4,
      jobs: 0,
    },
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

describe('createMovementSystem（R2）', () => {
  it('system.id 為 movement', () => {
    const sys = createMovementSystem(makeDefs(), { w: 5, h: 5 });
    expect(sys.id).toBe('movement');
  });

  describe('(a) 目標選擇', () => {
    it('上半日（tickOfDay < 300）且有工作 → 目標為 job 建築座標，朝其移動', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));

      sys.update(state, makeCtx(0));

      expect(state.citizens[0].x).toBeCloseTo(0.1, 9);
      expect(state.citizens[0].y).toBe(0);
    });

    it('上半日且 job === null → 目標為 home 建築座標', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: null, x: 4, y: 0 }));

      sys.update(state, makeCtx(0));

      expect(state.citizens[0].x).toBeCloseTo(3.9, 9);
      expect(state.citizens[0].y).toBe(0);
    });

    it('下半日（tickOfDay >= 300）→ 目標一律為 home 建築座標（即使有工作）', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 4, y: 0 }));

      sys.update(state, makeCtx(300));

      expect(state.citizens[0].x).toBeCloseTo(3.9, 9);
      expect(state.citizens[0].y).toBe(0);
    });

    it('邊界：tickOfDay = 299 仍屬上半日 → 目標為 job', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));

      sys.update(state, makeCtx(299));

      expect(state.citizens[0].x).toBeCloseTo(0.1, 9);
      expect(state.citizens[0].y).toBe(0);
    });

    it('邊界：tickOfDay = 300 屬下半日 → 目標為 home（已在 home 則不動）', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));

      sys.update(state, makeCtx(300));

      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 0, y: 0 });
    });

    it('home 指向不存在的建築 → 該 citizen 本 tick 不動（下半日目標為 home）', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'ghost-house', job: 'j1', x: 2, y: 0 }));

      sys.update(state, makeCtx(300));

      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'ghost-house', job: 'j1', x: 2, y: 0 });
    });

    it('job 指向不存在的建築 → 該 citizen 本 tick 不動（上半日目標為 job）', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'ghost-job', x: 2, y: 0 }));

      sys.update(state, makeCtx(0));

      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'ghost-job', x: 2, y: 0 });
    });
  });

  describe('(b) 移動速度與抵達', () => {
    it('速度 0.1 格/tick：連續 5 次 update 累積朝目標前進約 0.5', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));

      const ctx = makeCtx(0);
      for (let i = 0; i < 5; i++) sys.update(state, ctx);

      expect(state.citizens[0].x).toBeCloseTo(0.5, 9);
      expect(state.citizens[0].y).toBe(0);
    });

    it('已在目標格（座標與目標整數格完全相同）→ 不動', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 4, y: 0 }));

      sys.update(state, makeCtx(0));

      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 4, y: 0 });
    });

    it('與目標整數格距離 < 速度（0.1）→ 貼齊整數座標後停止，不過衝', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 3.95, y: 0 }));

      sys.update(state, makeCtx(0));

      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 4, y: 0 });
    });
  });

  describe('(c) 阻擋：建築 footprint 格 blocked，但 citizen 自己的目標格例外', () => {
    it('非目標建築擋在直線路徑上 → 繞路後仍能抵達目標（自己的目標格不因是建築而擋住終點）', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 2 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
      // 障礙物：與 home/job 皆無關的第三棟建築，擋在 (2,0) 直線正中央
      state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 2, y: 0 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));

      const ctx = makeCtx(0);
      // 繞路後最短距離 6 格（速度 0.1/tick 需 60 tick），給充分餘裕跑 70 tick 確保已抵達並 snap
      for (let i = 0; i < 70; i++) sys.update(state, ctx);

      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 4, y: 0 });
    });
  });

  describe('(d) 決定論', () => {
    it('同 state 跑兩次（各自獨立複本）深相等', () => {
      function buildState() {
        const state = createInitialState(1);
        state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
        state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
        state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));
        return state;
      }
      const sysA = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const sysB = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const stateA = buildState();
      const stateB = buildState();
      const ctxA = makeCtx(0);
      const ctxB = makeCtx(0);

      for (let i = 0; i < 15; i++) {
        sysA.update(stateA, ctxA);
        sysB.update(stateB, ctxB);
      }

      expect(stateA).toEqual(stateB);
    });

    it('不消耗 rng：呼叫即 throw 的假 rng 下仍正常執行並正確移動', () => {
      const sys = createMovementSystem(makeDefs(), { w: 5, h: 1 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 4, y: 0 }));
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
      expect(state.citizens[0].x).toBeCloseTo(0.1, 9);
    });
  });

  describe('(e) 無路可走', () => {
    it('citizen 被建築四面圍死 → 不 throw、原地不動', () => {
      const sys = createMovementSystem(makeDefs(), { w: 3, h: 3 });
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'h1', type: 'house', x: 1, y: 1 }));
      state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 0, y: 0 }));
      // 圍住 (1,1) 的四個相鄰格
      state.buildings.push(building({ id: 'w1', type: 'lumber-camp', x: 0, y: 1 }));
      state.buildings.push(building({ id: 'w2', type: 'lumber-camp', x: 2, y: 1 }));
      state.buildings.push(building({ id: 'w3', type: 'lumber-camp', x: 1, y: 0 }));
      state.buildings.push(building({ id: 'w4', type: 'lumber-camp', x: 1, y: 2 }));
      state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 1, y: 1 }));

      const ctx = makeCtx(0);
      expect(() => {
        for (let i = 0; i < 3; i++) sys.update(state, ctx);
      }).not.toThrow();

      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 1, y: 1 });
    });
  });
});

describe('Simulation 整合 movement（R3）：home↔job 折返', () => {
  it('上半日朝 job 前進、抵達後停住；推進至下半日後折返朝 home、最終抵達', () => {
    const defs = makeDefs();
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
    state.buildings.push(building({ id: 'camp1', type: 'lumber-camp', x: 4, y: 0 }));
    state.citizens.push({ id: 'c1', home: 'house1', job: 'camp1', x: 0, y: 0 });

    const sys: System = createMovementSystem(defs, { w: 5, h: 1 });
    const sim = new Simulation(state, [sys]);

    // 上半日跑 5 tick：x 應遞增朝 (4,0)
    sim.run(5);
    expect(state.citizens[0].x).toBeCloseTo(0.5, 9);
    expect(state.citizens[0].y).toBe(0);

    // 再跑到總 tick=50（仍在上半日內）：距離 4 格只需 40 tick，應已抵達並貼齊整數座標
    sim.run(45);
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'house1', job: 'camp1', x: 4, y: 0 });

    // 推進到總 tick=300（下半日邊界，含最後一個下半日 tick）：應開始朝 home 折返
    sim.run(250);
    expect(state.tick).toBe(300);
    expect(state.citizens[0].x).toBeCloseTo(3.9, 9);
    expect(state.citizens[0].y).toBe(0);

    // 繼續跑到總 tick=345：距離 3.9 格只需約 39 tick，應已折返抵達 home 並貼齊整數座標
    sim.run(45);
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'house1', job: 'camp1', x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// M3-W2 重工回歸：F1（快取不失效→穿牆）／F2（存檔還原後續跑不一致）／
// F3（斜走・抖動・越界）／F7（快取洩漏）。
// 共同前提：movement.update 是 (state, ctx.time) 的純函數，無跨 tick 記憶。
// ---------------------------------------------------------------------------

/** 逐 tick 不變式：座標恆在 bounds 內、單 tick 至多動一軸、每軸位移不超過速度 0.1。 */
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

/** 10×3 繞路地圖：home (0,0)、job (9,0)，可選在 (5,0) 放障礙 → 必須走 y=1 繞過。 */
function detourState(withObstacle: boolean) {
  const state = createInitialState(1);
  state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
  state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 9, y: 0 }));
  if (withObstacle) state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 5, y: 0 }));
  state.citizens.push(citizen({ home: 'h1', job: 'j1', x: 0, y: 0 }));
  return state;
}

describe('M3-W2 重工回歸（F1/F2/F3/F7）', () => {
  it('F1 路徑中途蓋樓 → 下一 tick 起繞路，絕不穿越建築格', () => {
    const bounds = { w: 10, h: 3 };
    const sys = createMovementSystem(makeDefs(), bounds);
    const state = detourState(false);
    const ctx = makeCtx(0);

    // 先沿直線走 5 tick（此時舊實作已快取整條直線路徑）
    for (let i = 0; i < 5; i++) sys.update(state, ctx);
    expect(state.citizens[0].x).toBeCloseTo(0.5, 9);
    expect(state.citizens[0].y).toBe(0);

    // 玩家在路徑正中央蓋樓
    state.buildings.push(building({ id: 'ob1', type: 'lumber-camp', x: 5, y: 0 }));

    let sawDetourRow = false;
    for (let i = 0; i < 200; i++) {
      const prev = { ...state.citizens[0] };
      sys.update(state, ctx);
      const cur = state.citizens[0];
      assertStepInvariants(prev, cur, bounds);
      // 穿牆偵測：(5,0) 這格（含其半格鄰域）任何時刻都不得被佔據
      expect(cur.x > 4 && cur.x < 6 && cur.y > -1 && cur.y < 1).toBe(false);
      if (cur.y === 1) sawDetourRow = true;
    }

    expect(sawDetourRow).toBe(true); // 確實繞了 y=1 那一列
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 9, y: 0 });
  });

  it('F2 serialize→deserialize→續跑 N tick，與連續跑同一 state 深相等', () => {
    const bounds = { w: 10, h: 3 };
    const defs = makeDefs();

    // (a) 連續跑 120 tick
    const continuousState = detourState(true);
    new Simulation(continuousState, [createMovementSystem(defs, bounds)]).run(120);

    // (b) 跑 5 tick → 存檔 → 全新 Simulation ＋全新 movement system 還原 → 再跑 115 tick
    const savedState = detourState(true);
    new Simulation(savedState, [createMovementSystem(defs, bounds)]).run(5);
    const restored = deserializeGameState(serializeGameState(savedState));
    new Simulation(restored, [createMovementSystem(defs, bounds)]).run(115);

    expect(restored.tick).toBe(120);
    expect(restored).toEqual(continuousState);
  });

  it('F2 任一存檔時點皆等價（tick 1~40 全數比對），且路徑處於轉彎中也一致', () => {
    const bounds = { w: 10, h: 3 };
    const defs = makeDefs();
    const total = 90;

    const continuousState = detourState(true);
    new Simulation(continuousState, [createMovementSystem(defs, bounds)]).run(total);

    for (let saveAt = 1; saveAt <= 40; saveAt++) {
      const s = detourState(true);
      new Simulation(s, [createMovementSystem(defs, bounds)]).run(saveAt);
      const restored = deserializeGameState(serializeGameState(s));
      new Simulation(restored, [createMovementSystem(defs, bounds)]).run(total - saveAt);
      expect({ saveAt, citizens: restored.citizens }).toEqual({
        saveAt,
        citizens: continuousState.citizens,
      });
    }
  });

  it('F3 抵達目標後連續多 tick 完全靜止（無 ±0.1 抖動、無回跳）', () => {
    const bounds = { w: 10, h: 3 };
    const sys = createMovementSystem(makeDefs(), bounds);
    const state = detourState(true);
    const ctx = makeCtx(0);

    for (let i = 0; i < 200; i++) sys.update(state, ctx);
    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 9, y: 0 });

    for (let i = 0; i < 50; i++) {
      sys.update(state, ctx);
      expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 9, y: 0 });
    }
  });

  it('F3 目標在跨格途中翻轉 → 就地折返、單軸移動、不抖動', () => {
    const bounds = { w: 5, h: 6 };
    const sys = createMovementSystem(makeDefs(), bounds);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'h1', type: 'house', x: 3, y: 5 }));
    state.citizens.push(citizen({ home: 'h1', job: null, x: 3, y: 0 }));
    const ctx = makeCtx(0);

    // 失業 → 朝 home 前進 15 tick，停在格與格之間（y = 1.5）
    for (let i = 0; i < 15; i++) sys.update(state, ctx);
    expect(state.citizens[0].x).toBe(3);
    expect(state.citizens[0].y).toBeCloseTo(1.5, 9);

    // 途中被指派工作，工作建築就在正上方 → 目標翻轉，必須就地折返
    state.buildings.push(building({ id: 'j1', type: 'lumber-camp', x: 3, y: 0 }));
    state.citizens[0].job = 'j1';

    for (let i = 0; i < 15; i++) {
      const prev = { ...state.citizens[0] };
      sys.update(state, ctx);
      const cur = state.citizens[0];
      assertStepInvariants(prev, cur, bounds);
      expect(cur.x).toBe(3); // 全程不偏離該欄（不斜走）
      expect(cur.y).toBeLessThan(prev.y); // 折返後單調朝上，不來回跳
    }

    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: 'j1', x: 3, y: 0 });
  });

  it('F3 目標為 x=0 的邊界格 → 座標不會走成負數，抵達後停住', () => {
    const bounds = { w: 5, h: 1 };
    const sys = createMovementSystem(makeDefs(), bounds);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'h1', type: 'house', x: 0, y: 0 }));
    state.citizens.push(citizen({ home: 'h1', job: null, x: 2, y: 0 }));
    const ctx = makeCtx(0);

    for (let i = 0; i < 40; i++) {
      const prev = { ...state.citizens[0] };
      sys.update(state, ctx);
      assertStepInvariants(prev, state.citizens[0], bounds);
    }

    expect(state.citizens[0]).toEqual({ id: 'c1', home: 'h1', job: null, x: 0, y: 0 });
  });

  it('F7 居民中途被移除（餓死/清理）不影響其他居民，且無以 id 為鍵的殘留狀態', () => {
    const bounds = { w: 10, h: 3 };
    const sys = createMovementSystem(makeDefs(), bounds);
    const state = detourState(true);
    state.citizens.push(citizen({ id: 'c2', home: 'h1', job: 'j1', x: 0, y: 1 }));
    const ctx = makeCtx(0);

    for (let i = 0; i < 20; i++) sys.update(state, ctx);
    // c1 死亡後，同 id 的新居民不得沿用任何舊進度：由目前座標重新決策即可
    state.citizens.splice(0, 1);
    state.citizens.push(citizen({ id: 'c1', home: 'h1', job: 'j1', x: 0, y: 0 }));

    const reference = createMovementSystem(makeDefs(), bounds);
    const fresh = detourState(true);
    fresh.citizens[0] = { ...state.citizens[1] };

    for (let i = 0; i < 30; i++) {
      sys.update(state, ctx);
      reference.update(fresh, ctx);
    }
    // 用過的 system 與全新 system 對同一居民給出完全相同的軌跡（＝無跨 tick 記憶）
    expect(state.citizens[1]).toEqual(fresh.citizens[0]);
  });
});
