// R4：生產 system（src/core/systems/production.ts）
import { describe, expect, it } from 'vitest';
import { createProductionSystem } from '../../src/core/systems/production';
import { createInitialState, getResource } from '../../src/core/world/state';
import type { Building } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import type { SimContext } from '../../src/core/sim/system';
import { Simulation } from '../../src/core/sim/simulation';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';

function makeDefs(): BuildingDef[] {
  return [
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 2, h: 2 },
      cost: { wood: 10 },
      production: { wood: 2 },
      housing: 0,
      jobs: 0,
    },
    {
      id: 'quarry',
      name: '採石場',
      size: { w: 2, h: 2 },
      cost: { wood: 15 },
      production: { stone: 3 },
      housing: 0,
      jobs: 0,
    },
    {
      id: 'house',
      name: '民居',
      size: { w: 1, h: 1 },
      cost: { wood: 5 },
      production: {},
      housing: 0,
      jobs: 0,
    },
  ];
}

function makeCtx(seed = 1): SimContext {
  return { rng: createRng(seed), time: timeFromTick(1) };
}

function building(overrides: Partial<Building>): Building {
  return { id: 'b1', type: 'lumber-camp', x: 0, y: 0, ...overrides };
}

describe('createProductionSystem（R4）', () => {
  it('system.id 為 production', () => {
    const sys = createProductionSystem(makeDefs());
    expect(sys.id).toBe('production');
  });

  it('每 tick 依 building.type 對應 def 的 production 用 addResource 累加資源', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(2);
  });

  it('多棟不同 type 的建築分別依各自 def 累加', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.buildings.push(building({ id: 'q1', type: 'quarry' }));

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(2);
    expect(getResource(state, 'stone')).toBe(3);
  });

  it('同 type 多棟建築產量疊加', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.buildings.push(building({ id: 'lc2', type: 'lumber-camp' }));

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(4);
  });

  it('無 production 的建築（house）不影響任何資源', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'h1', type: 'house' }));

    sys.update(state, makeCtx());

    expect(state.resources).toEqual({});
  });

  it('連續多 tick 累加（透過 Simulation 執行 3 次）', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    const sim = new Simulation(state, [sys]);

    sim.run(3);

    expect(getResource(state, 'wood')).toBe(6);
  });

  it('state.buildings 出現 defs 沒有的 type → throw', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'x1', type: 'unknown-type' }));

    expect(() => sys.update(state, makeCtx())).toThrow();
  });

  it('未知 type 為 fail-fast：拋錯前不得有任何資源入帳（無半套用撕裂）', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.buildings.push(building({ id: 'x1', type: 'unknown-type' }));

    expect(() => sys.update(state, makeCtx())).toThrow();
    expect(getResource(state, 'wood')).toBe(0);
  });

  it('不消耗 rng：呼叫即 throw 的假 rng 下仍正常執行並正確累加', () => {
    const sys = createProductionSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));

    const poisonedRng = {
      next: () => {
        throw new Error('production system 不應呼叫 rng.next()');
      },
      nextInt: () => {
        throw new Error('production system 不應呼叫 rng.nextInt()');
      },
      getState: () => 0,
      setState: () => {},
    };
    const ctx: SimContext = { rng: poisonedRng, time: timeFromTick(1) };

    expect(() => sys.update(state, ctx)).not.toThrow();
    expect(getResource(state, 'wood')).toBe(2);
  });

  it('決定論：相同初始建築配置，兩個不同 seed 的 Simulation 各跑 3 tick，結果資源深相等', () => {
    const defs = makeDefs();
    function build(seed: number) {
      const state = createInitialState(seed);
      state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
      state.buildings.push(building({ id: 'q1', type: 'quarry' }));
      const sim = new Simulation(state, [createProductionSystem(defs)]);
      return { state, sim };
    }

    const a = build(1);
    const b = build(999);
    a.sim.run(3);
    b.sim.run(3);

    expect(a.state.resources).toEqual(b.state.resources);
  });

  it('資源名與 Object.prototype 成員同名（如 constructor）也正確累加（own-property）', () => {
    const defs: BuildingDef[] = [
      {
        id: 'weird-camp',
        name: '怪異營地',
        size: { w: 1, h: 1 },
        cost: {},
        production: { constructor: 5, toString: 2 },
        housing: 0,
        jobs: 0,
      },
    ];
    const sys = createProductionSystem(defs);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'w1', type: 'weird-camp' }));

    sys.update(state, makeCtx());

    expect(getResource(state, 'constructor')).toBe(5);
    expect(getResource(state, 'toString')).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(state.resources, 'constructor')).toBe(true);
  });
});
