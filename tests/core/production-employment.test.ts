// M3-T2 R2：production system 依在職率調整產出（src/core/systems/production.ts）
// createProductionSystem 簽名不變；對每棟建築，產出乘以
// def.jobs === 0 ? 1 : (在職人數 / def.jobs)（在職人數上限 def.jobs）。
// 既有 tests/core/production.test.ts 的 fixtures 全為 jobs:0，必須保持全綠（回歸即契約），
// 本檔只補 jobs>0 情境，不重複既有測試。
import { describe, expect, it } from 'vitest';
import { createProductionSystem } from '../../src/core/systems/production';
import { createInitialState, getResource } from '../../src/core/world/state';
import type { Building, Citizen } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import type { SimContext } from '../../src/core/sim/system';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';

function makeDefs(): BuildingDef[] {
  return [
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 2, h: 2 },
      cost: {},
      production: { wood: 8 },
      housing: 0,
      jobs: 4,
    },
    {
      id: 'quarry',
      name: '採石場',
      size: { w: 2, h: 2 },
      cost: {},
      production: { stone: 6 },
      housing: 0,
      jobs: 2,
    },
  ];
}

function makeCtx(seed = 1): SimContext {
  return { rng: createRng(seed), time: timeFromTick(1) };
}

function building(overrides: Partial<Building>): Building {
  return { id: 'lc1', type: 'lumber-camp', x: 0, y: 0, ...overrides };
}

function citizen(overrides: Partial<Citizen>): Citizen {
  return { id: 'c1', home: 'house1', job: null, x: 0, y: 0, ...overrides };
}

describe('createProductionSystem 依在職率調整產出（R2）', () => {
  it('jobs>0 且 0 在職 → 產出為 0', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    // 無任何 citizen 在此建築工作

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(0);
  });

  it('在職人數為 jobs 的一部分 → 產出等比例縮減（jobs:4、在職:1 → 1/4 產出）', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1', job: 'lc1' }));

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(2); // 8 * (1/4)
  });

  it('在職人數等於 jobs（全職）→ 產出全額', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(
      citizen({ id: 'c1', job: 'lc1' }),
      citizen({ id: 'c2', job: 'lc1' }),
      citizen({ id: 'c3', job: 'lc1' }),
      citizen({ id: 'c4', job: 'lc1' }),
    );

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(8);
  });

  it('在職人數超過 jobs（異常資料）→ 產出比例上限為 1，不超額', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(
      citizen({ id: 'c1', job: 'lc1' }),
      citizen({ id: 'c2', job: 'lc1' }),
      citizen({ id: 'c3', job: 'lc1' }),
      citizen({ id: 'c4', job: 'lc1' }),
      citizen({ id: 'c5', job: 'lc1' }),
    );

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(8);
  });

  it('job===null 或指向其他建築的 citizen 不計入在職人數', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(
      citizen({ id: 'idle', job: null }),
      citizen({ id: 'elsewhere', job: 'quarry1' }),
      citizen({ id: 'employed', job: 'lc1' }),
    );

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(2); // 8 * (1/4)，僅 1 位在職
  });

  it('多棟建築各自依自己的在職率計算，互不干擾', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.buildings.push({ id: 'q1', type: 'quarry', x: 5, y: 5 });
    // lumber-camp：2/4 在職；quarry：2/2 在職（全職）
    state.citizens.push(
      citizen({ id: 'c1', job: 'lc1' }),
      citizen({ id: 'c2', job: 'lc1' }),
      // quarry 在 (5,5)，工人得站在那裡才算到崗
      citizen({ id: 'c3', job: 'q1', x: 5, y: 5 }),
      citizen({ id: 'c4', job: 'q1', x: 5, y: 5 }),
    );

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(4); // 8 * (2/4)
    expect(getResource(state, 'stone')).toBe(6); // 6 * (2/2)
  });

  it('連續多 tick，在職率不變時每 tick 依相同比例累加', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1', job: 'lc1' }));

    sys.update(state, makeCtx());
    sys.update(state, makeCtx());
    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(6); // 2 * 3 tick
  });
});
