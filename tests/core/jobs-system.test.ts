// M3-T2 R1：職業指派 system（src/core/systems/jobs.ts）
// createJobsSystem(defs: BuildingDef[]): System，id 'jobs'。
// 每 tick 把 job===null 的 citizen 依 citizens 陣列序、依 buildings 陣列序指派到有空缺的建築；
// job 指向不存在的 building → 重設為 null；home 指向不存在的 building → citizen 整個移除。
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
    {
      id: 'workshop',
      name: '工坊',
      size: { w: 2, h: 2 },
      cost: {},
      production: {},
      housing: 0,
      jobs: 1,
    },
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 2, h: 2 },
      cost: {},
      production: { wood: 2 },
      housing: 0,
      jobs: 2,
    },
    {
      id: 'house',
      name: '民居',
      size: { w: 1, h: 1 },
      cost: {},
      production: {},
      housing: 4,
      jobs: 0,
    },
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

describe('createJobsSystem（R1）', () => {
  it('system.id 為 jobs', () => {
    const sys = createJobsSystem(makeDefs());
    expect(sys.id).toBe('jobs');
  });

  it('job===null 的 citizen 被指派到有空缺的建築（單一空缺、單一待業者）', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'ws1', type: 'workshop' }));
    state.citizens.push(citizen({ id: 'c1' }));

    sys.update(state, makeCtx());

    expect(state.citizens[0].job).toBe('ws1');
  });

  it('同一建築 jobs 容量 >1 時，依 citizens 陣列序在同一 tick 內依序填滿（在職數即時累計）', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1' }), citizen({ id: 'c2' }));

    sys.update(state, makeCtx());

    expect(state.citizens[0].job).toBe('lc1');
    expect(state.citizens[1].job).toBe('lc1');
  });

  it('建築容量已滿（在職數 === jobs）時第三位待業者維持 job:null', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1' }), citizen({ id: 'c2' }), citizen({ id: 'c3' }));

    sys.update(state, makeCtx());

    expect(state.citizens[0].job).toBe('lc1');
    expect(state.citizens[1].job).toBe('lc1');
    expect(state.citizens[2].job).toBe(null);
  });

  it('依 buildings 陣列序找空缺：第一棟已滿時指派到第二棟', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'ws1', type: 'workshop' }));
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    // ws1（jobs:1）已被 c0 佔滿
    state.citizens.push(citizen({ id: 'c0', job: 'ws1' }));
    state.citizens.push(citizen({ id: 'c1' }));

    sys.update(state, makeCtx());

    expect(state.citizens[1].job).toBe('lc1');
  });

  it('已在職（job 指向存在的建築）的 citizen 不受影響、不重新指派', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'ws1', type: 'workshop' }));
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1', job: 'lc1' }));

    sys.update(state, makeCtx());

    expect(state.citizens[0].job).toBe('lc1');
  });

  it('job 指向已不存在的 building id 且無其他空缺 → 重設為 null', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'ws1', type: 'workshop' }));
    // ws1（jobs:1）已被 c0 佔滿，c1 原本在一棟已拆除的建築工作
    state.citizens.push(citizen({ id: 'c0', job: 'ws1' }));
    state.citizens.push(citizen({ id: 'c1', job: 'demolished-building' }));

    sys.update(state, makeCtx());

    expect(state.citizens[1].job).toBe(null);
  });

  it('home 指向不存在的 building → citizen 從 citizens 陣列移除，其他 citizen 不受影響', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.citizens.push(citizen({ id: 'homeless', home: 'demolished-house' }));
    state.citizens.push(citizen({ id: 'housed', home: 'house1' }));

    sys.update(state, makeCtx());

    expect(state.citizens.map((c) => c.id)).toEqual(['housed']);
  });

  it('沒有任何空缺時，job===null 的 citizen 全部維持 null', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' })); // jobs:0
    state.citizens.push(citizen({ id: 'c1' }), citizen({ id: 'c2' }));

    sys.update(state, makeCtx());

    expect(state.citizens[0].job).toBe(null);
    expect(state.citizens[1].job).toBe(null);
  });

  it('不消耗 rng：呼叫即 throw 的假 rng 下仍正常執行並正確指派', () => {
    const sys = createJobsSystem(makeDefs());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'ws1', type: 'workshop' }));
    state.citizens.push(citizen({ id: 'c1' }));

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
    expect(state.citizens[0].job).toBe('ws1');
  });

  it('（F4）建築 jobs 容量調降（如 2→1）時，依 citizens 陣列序保留前 def.jobs 名、其餘釋放為 null', () => {
    const reducedDefs: BuildingDef[] = [{ ...makeDefs()[1], jobs: 1 }]; // lumber-camp jobs 由 2 調成 1
    const sys = createJobsSystem(reducedDefs);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1', job: 'lc1' }), citizen({ id: 'c2', job: 'lc1' }));

    sys.update(state, makeCtx());

    expect(state.citizens[0].job).toBe('lc1');
    expect(state.citizens[1].job).toBe(null);
  });

  it('（F4）建築 jobs 容量調成 0 時，原在職者全部釋放為 null', () => {
    const reducedDefs: BuildingDef[] = [{ ...makeDefs()[1], jobs: 0 }]; // lumber-camp jobs 調成 0
    const sys = createJobsSystem(reducedDefs);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1', job: 'lc1' }), citizen({ id: 'c2', job: 'lc1' }));

    sys.update(state, makeCtx());

    expect(state.citizens[0].job).toBe(null);
    expect(state.citizens[1].job).toBe(null);
  });

  it('（F4）超額釋放者於下一次 update 可被指派到別處有空缺的建築', () => {
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));
    state.citizens.push(citizen({ id: 'c1', job: 'lc1' }), citizen({ id: 'c2', job: 'lc1' }));

    // 第一次 update：lumber-camp jobs 已被調降為 1（模擬資料表再平衡），c2 被釋放；
    // 此時尚無其他有空缺的建築，c2 維持待業。
    const reducedDefs: BuildingDef[] = [{ ...makeDefs()[1], jobs: 1 }];
    createJobsSystem(reducedDefs).update(state, makeCtx());
    expect(state.citizens[1].job).toBe(null);

    // 新建一棟有空缺的建築後，下一次 update 重新指派：lumber-camp 容量仍維持 1（已被 c1 佔滿），
    // 被釋放的 c2 應被指派到新出現的 workshop，而不是重新擠回 lumber-camp。
    state.buildings.push(building({ id: 'ws1', type: 'workshop' }));
    const defsWithVacantWorkshop: BuildingDef[] = [makeDefs()[0], { ...makeDefs()[1], jobs: 1 }, makeDefs()[2]];
    createJobsSystem(defsWithVacantWorkshop).update(state, makeCtx());
    expect(state.citizens[1].job).toBe('ws1');
  });
});
