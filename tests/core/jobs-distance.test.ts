// M3.9-W3 R3：職業指派系統的距離感知（src/core/systems/jobs.ts）
//
// 動機：現行 createJobsSystem 對每位待業居民一律指派「buildings 陣列裡第一個有空缺的」，
// 在大地圖上會把居民指派到走很久才到的地方（移動系統已在 R2 補上大地圖前進能力，
// 但指派本身若不管距離，玩家的城市擴大後通勤會離譜地遠）。
//
// 鎖定的距離度量（本檔測試假設，實作必須遵守；若與此不符請先與規格撰寫者確認，不要改測試）：
// - 度量：Manhattan 距離 |dx|+|dy|，量測 citizen 的 home 建築座標與候選建築座標之間的距離
//   （與 astar.ts 的啟發函式、movement.ts 在無阻擋時的實際步數一致，是本專案既有的距離慣例，
//   非任意選擇）。
// - 決選規則：在所有「有空缺」的建築中選 Manhattan 距離最小者；距離相同時取 buildings 陣列中
//   較早出現者（與現行「依 buildings 陣列序找第一個有空缺者」的既有慣例一致，只是先過濾/排序
//   改為「先比距離、同距離才比陣列序」）。
// - createJobsSystem(defs, maxCommuteDistance): System——距離所需的座標本就在 Building.x/y
//   與 citizen.home 可查得的 home 建築上，不需要改動 state schema。
//
// 本檔同時補回歸覆蓋（R3(d)）：既有 jobs 行為（job 懸空重設 null、home 懸空移除 citizen、
// 建築容量調降的超額釋放）在距離感知版本下仍必須成立——與 tests/core/jobs-system.test.ts
// 的對應案例同構，但重新在本檔的距離感知情境下驗證一次，不修改原檔。
import { describe, expect, it } from 'vitest';
import { createJobsSystem } from '../../src/core/systems/jobs';
import { createInitialState } from '../../src/core/world/state';
import type { Building, Citizen } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import type { SimContext } from '../../src/core/sim/system';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';

function makeDefs(): BuildingDef[] {
  return [
    { id: 'workshop', name: '工坊', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 0, jobs: 1 },
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 1, h: 1 },
      cost: {},
      production: { wood: 2 },
      housing: 0,
      jobs: 2,
    },
    { id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 4, jobs: 0 },
  ];
}

function makeCtx(seed = 1): SimContext {
  return { rng: createRng(seed), time: timeFromTick(1) };
}

function building(overrides: Partial<Building>): Building {
  return { id: 'b1', type: 'workshop', x: 0, y: 0, ...overrides };
}

function citizen(overrides: Partial<Citizen>): Citizen {
  return { id: 'c1', home: 'house1', job: null, x: 0, y: 0, ...overrides };
}

describe('createJobsSystem 距離感知指派（R3）', () => {
  describe('(a) 兩棟同型建築一近一遠 → 指派到近的', () => {
    it('遠的建築在 buildings 陣列中排在近的前面，仍選近的（證明是真的比距離，不是陣列序）', () => {
      const sys = createJobsSystem(makeDefs());
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      // 陣列序：wsFar 先於 wsNear，若仍走舊「陣列序優先」邏輯會誤判為 wsFar
      state.buildings.push(building({ id: 'wsFar', type: 'workshop', x: 10, y: 0 })); // 距離 10
      state.buildings.push(building({ id: 'wsNear', type: 'workshop', x: 2, y: 0 })); // 距離 2
      state.citizens.push(citizen({ id: 'c1', home: 'house1' }));

      sys.update(state, makeCtx());

      expect(state.citizens[0].job).toBe('wsNear');
    });

    it('Manhattan 距離而非直線距離：對角較近但曼哈頓較遠的建築不會被誤選', () => {
      const sys = createJobsSystem(makeDefs());
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      // wsA: (3,3) Manhattan=6, Euclid≈4.24；wsB: (4,0) Manhattan=4, Euclid=4
      // 若誤用歐式距離會選 wsA（歐式較近）；Manhattan 距離下 wsB 更近，應選 wsB。
      state.buildings.push(building({ id: 'wsA', type: 'workshop', x: 3, y: 3 }));
      state.buildings.push(building({ id: 'wsB', type: 'workshop', x: 4, y: 0 }));
      state.citizens.push(citizen({ id: 'c1', home: 'house1' }));

      sys.update(state, makeCtx());

      expect(state.citizens[0].job).toBe('wsB');
    });
  });

  describe('(b) 近的滿了才去遠的', () => {
    it('近的建築容量已滿 → 新待業者指派到次近的建築', () => {
      const sys = createJobsSystem(makeDefs());
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'wsNear', type: 'workshop', x: 2, y: 0 })); // jobs:1，已被佔滿
      state.buildings.push(building({ id: 'wsFar', type: 'workshop', x: 10, y: 0 }));
      state.citizens.push(citizen({ id: 'occupied', home: 'house1', job: 'wsNear' }));
      state.citizens.push(citizen({ id: 'c1', home: 'house1' }));

      sys.update(state, makeCtx());

      expect(state.citizens[1].job).toBe('wsFar');
    });
  });

  describe('平手決勝：距離相同時取 buildings 陣列較早出現者', () => {
    it('兩棟建築與 home 距離相同 → 指派到陣列序較早者', () => {
      const sys = createJobsSystem(makeDefs());
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'wsFirst', type: 'workshop', x: 5, y: 0 })); // 距離 5，陣列序較早
      state.buildings.push(building({ id: 'wsSecond', type: 'workshop', x: 0, y: 5 })); // 距離 5
      state.citizens.push(citizen({ id: 'c1', home: 'house1' }));

      sys.update(state, makeCtx());

      expect(state.citizens[0].job).toBe('wsFirst');
    });
  });

  describe('(c) 決定論：同 state 跑兩次結果深相等', () => {
    it('多名居民、多棟建築、含平手情境 → 兩次獨立執行結果完全相同', () => {
      function buildState() {
        const state = createInitialState(1);
        state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
        state.buildings.push(building({ id: 'house2', type: 'house', x: 20, y: 20 }));
        state.buildings.push(building({ id: 'wsA', type: 'workshop', x: 5, y: 0 }));
        state.buildings.push(building({ id: 'wsB', type: 'workshop', x: 0, y: 5 }));
        state.buildings.push(building({ id: 'lcFar', type: 'lumber-camp', x: 15, y: 15 }));
        state.citizens.push(citizen({ id: 'c1', home: 'house1' }));
        state.citizens.push(citizen({ id: 'c2', home: 'house1' }));
        state.citizens.push(citizen({ id: 'c3', home: 'house2' }));
        return state;
      }
      const stateA = buildState();
      const stateB = buildState();

      createJobsSystem(makeDefs()).update(stateA, makeCtx());
      createJobsSystem(makeDefs()).update(stateB, makeCtx());

      expect(stateA).toEqual(stateB);
    });

    it('不消耗 rng：呼叫即 throw 的假 rng 下仍正常執行並依距離正確指派', () => {
      const sys = createJobsSystem(makeDefs());
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'wsFar', type: 'workshop', x: 10, y: 0 }));
      state.buildings.push(building({ id: 'wsNear', type: 'workshop', x: 1, y: 0 }));
      state.citizens.push(citizen({ id: 'c1', home: 'house1' }));

      const poisonedRng = {
        next: () => {
          throw new Error('jobs system 不應呼叫 rng.next()');
        },
        nextInt: () => {
          throw new Error('jobs system 不應呼叫 rng.nextInt()');
        },
        getState: () => 0,
        setState: () => {},
      };
      const ctx: SimContext = { rng: poisonedRng, time: timeFromTick(1) };

      expect(() => sys.update(state, ctx)).not.toThrow();
      expect(state.citizens[0].job).toBe('wsNear');
    });
  });

  describe('(d) 既有行為不得退步（距離感知版本下重新驗證）', () => {
    it('job 指向不存在的建築 → 重設後在同一 tick 內依距離重新指派到最近的有空缺建築', () => {
      const sys = createJobsSystem(makeDefs());
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'wsFar', type: 'workshop', x: 10, y: 0 }));
      state.buildings.push(building({ id: 'wsNear', type: 'workshop', x: 1, y: 0 }));
      state.citizens.push(citizen({ id: 'c1', home: 'house1', job: 'demolished-building' }));

      sys.update(state, makeCtx());

      expect(state.citizens[0].job).toBe('wsNear');
    });

    it('home 指向不存在的建築 → citizen 整個從陣列移除，其他 citizen 不受影響', () => {
      const sys = createJobsSystem(makeDefs());
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'ws1', type: 'workshop', x: 1, y: 0 }));
      state.citizens.push(citizen({ id: 'homeless', home: 'demolished-house' }));
      state.citizens.push(citizen({ id: 'housed', home: 'house1' }));

      sys.update(state, makeCtx());

      expect(state.citizens.map((c) => c.id)).toEqual(['housed']);
      expect(state.citizens[0].job).toBe('ws1');
    });

    it('建築 jobs 容量調降（2→1）→ 依 citizens 陣列序保留前 def.jobs 名，其餘釋放為 null', () => {
      const reducedDefs: BuildingDef[] = [{ ...makeDefs()[1], jobs: 1 }]; // lumber-camp: 2→1
      const sys = createJobsSystem(reducedDefs);
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'house1', type: 'house', x: 0, y: 0 }));
      state.buildings.push(building({ id: 'lc1', type: 'lumber-camp', x: 3, y: 0 }));
      state.citizens.push(citizen({ id: 'c1', home: 'house1', job: 'lc1' }));
      state.citizens.push(citizen({ id: 'c2', home: 'house1', job: 'lc1' }));

      sys.update(state, makeCtx());

      expect(state.citizens[0].job).toBe('lc1');
      expect(state.citizens[1].job).toBe(null);
    });
  });
});
