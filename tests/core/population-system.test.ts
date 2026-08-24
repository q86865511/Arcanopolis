// M3-T2 R3：人口 system（src/core/systems/population.ts）
// createPopulationSystem(defs, config): System，id 'population'；只在日界 tick（ctx.time.tickOfDay===0）動作。
// (a) 糧食消耗 (b) 飢餓死亡 (c) 成長 (d) 決定論。
// M3-T2 R4：jobs + production + population 三 system 整合。
import { describe, expect, it } from 'vitest';
import { createPopulationSystem } from '../../src/core/systems/population';
import { createJobsSystem } from '../../src/core/systems/jobs';
import { createProductionSystem } from '../../src/core/systems/production';
import { createInitialState, getResource, addResource } from '../../src/core/world/state';
import type { Building, Citizen, GameState } from '../../src/core/world/state';
import type { BuildingDef, PopulationConfig } from '../../src/data/types';
import type { SimContext } from '../../src/core/sim/system';
import { Simulation } from '../../src/core/sim/simulation';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick, TICKS_PER_DAY } from '../../src/core/sim/time';

function makeDefs(): BuildingDef[] {
  return [
    {
      id: 'house',
      name: '民居',
      size: { w: 1, h: 1 },
      cost: {},
      production: {},
      housing: 4,
      jobs: 0,
    },
    {
      id: 'small-house',
      name: '小屋',
      size: { w: 1, h: 1 },
      cost: {},
      production: {},
      housing: 1,
      jobs: 0,
    },
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 2, h: 2 },
      cost: {},
      production: { wood: 5 },
      housing: 0,
      jobs: 1,
    },
  ];
}

function makeConfig(overrides: Partial<PopulationConfig> = {}): PopulationConfig {
  return {
    foodPerCitizenPerDay: 1,
    growthPerDay: 2,
    growthFoodReserveDays: 3,
    starvationDeathsPerDay: 1,
    maxCommuteDistance: 24,
    ...overrides,
  };
}

function makeCtx(tick: number, seed = 1): SimContext {
  return { rng: createRng(seed), time: timeFromTick(tick) };
}

function building(overrides: Partial<Building>): Building {
  return { id: 'house1', type: 'house', x: 0, y: 0, ...overrides };
}

function citizen(overrides: Partial<Citizen>): Citizen {
  return { id: 'c1', home: 'house1', job: null, x: 0, y: 0, ...overrides };
}

function poisonedRng() {
  return {
    next: () => {
      throw new Error('population system 不應呼叫 rng.next()');
    },
    nextInt: () => {
      throw new Error('population system 不應呼叫 rng.nextInt()');
    },
    getState: () => 0,
    setState: () => {},
  };
}

describe('createPopulationSystem（R3）', () => {
  it('system.id 為 population', () => {
    const sys = createPopulationSystem(makeDefs(), makeConfig());
    expect(sys.id).toBe('population');
  });

  it('非日界 tick（tickOfDay !== 0）→ 無任何副作用', () => {
    const sys = createPopulationSystem(makeDefs(), makeConfig());
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    state.citizens.push(citizen({ id: 'c1' }));
    addResource(state, 'food', 100);

    sys.update(state, makeCtx(5)); // tickOfDay = 5

    expect(state.citizens.length).toBe(1);
    expect(getResource(state, 'food')).toBe(100);
  });

  it('(a) 日界時扣除 citizens.length * foodPerCitizenPerDay 的糧食', () => {
    const sys = createPopulationSystem(makeDefs(), makeConfig({ foodPerCitizenPerDay: 2, growthFoodReserveDays: 999 }));
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    state.citizens.push(citizen({ id: 'c1' }), citizen({ id: 'c2' }));
    addResource(state, 'food', 100);

    sys.update(state, makeCtx(TICKS_PER_DAY)); // tickOfDay = 0

    expect(getResource(state, 'food')).toBe(96); // 100 - 2*2
  });

  it('食物充足但未達成長門檻（reserve 未滿）→ 人口不變、不餓死', () => {
    const sys = createPopulationSystem(makeDefs(), makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 3 }));
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    state.citizens.push(citizen({ id: 'c1' }), citizen({ id: 'c2' }));
    addResource(state, 'food', 3); // needed=2 <= 3；扣完後剩 1，reserve 需求 2*1*3=6，未達

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.length).toBe(2);
    expect(getResource(state, 'food')).toBe(1);
  });

  it('(b) 糧食不足當日（needed > available）→ food 扣到 0、不為負', () => {
    const sys = createPopulationSystem(makeDefs(), makeConfig({ foodPerCitizenPerDay: 1 }));
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    for (let i = 0; i < 5; i++) state.citizens.push(citizen({ id: `c${i}` }));
    addResource(state, 'food', 3); // needed=5 > available=3

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(getResource(state, 'food')).toBe(0);
  });

  it('(b) 糧食不足時，依 citizens 陣列尾端移除 starvationDeathsPerDay 個', () => {
    const sys = createPopulationSystem(makeDefs(), makeConfig({ foodPerCitizenPerDay: 1, starvationDeathsPerDay: 2 }));
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    for (let i = 0; i < 5; i++) state.citizens.push(citizen({ id: `c${i}` }));
    addResource(state, 'food', 3); // needed=5 > available=3

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('(b) starvationDeathsPerDay 超過現有人口時，全部移除但不 throw', () => {
    const sys = createPopulationSystem(makeDefs(), makeConfig({ foodPerCitizenPerDay: 1, starvationDeathsPerDay: 5 }));
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    state.citizens.push(citizen({ id: 'c1' }), citizen({ id: 'c2' }));
    addResource(state, 'food', 0); // needed=2 > available=0

    expect(() => sys.update(state, makeCtx(TICKS_PER_DAY))).not.toThrow();
    expect(state.citizens).toEqual([]);
  });

  it('(c) 糧食充足且達 reserve 門檻、有住房空位 → 新增 min(growthPerDay, 空位數) 個 citizen', () => {
    const sys = createPopulationSystem(
      makeDefs(),
      makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 1, growthPerDay: 3 }),
    );
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' })); // housing:4
    state.citizens.push(citizen({ id: 'c1' }), citizen({ id: 'c2' }));
    // needed=2，reserve 需求＝2*1*1=2；food 給 10：扣完剩 8 >= 2 → 成長；空位 4-2=2 < growthPerDay 3
    addResource(state, 'food', 10);

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.length).toBe(4); // 2 + min(3, 2)
  });

  it('(c) 成長的新 citizen：id 符合 citizen#<tick>-<序號> 格式、home/x/y 對應有空位的住房、job:null', () => {
    const sys = createPopulationSystem(
      makeDefs(),
      makeConfig({ foodPerCitizenPerDay: 0, growthFoodReserveDays: 0, growthPerDay: 2 }),
    );
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house', x: 3, y: 7 })); // housing:4
    addResource(state, 'food', 0);

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.length).toBe(2);
    for (const c of state.citizens) {
      expect(c.id).toMatch(/^citizen#\d+-\d+$/);
      expect(c.home).toBe('house1');
      expect(c.x).toBe(3);
      expect(c.y).toBe(7);
      expect(c.job).toBe(null);
    }
    // 新 citizen id 彼此不重複
    const ids = new Set(state.citizens.map((c) => c.id));
    expect(ids.size).toBe(2);
  });

  it('（F5）人口為 0 時，reserve 門檻以至少 1 人份計算：糧食足額（如 food=5, reserve=1*1*5）→ 仍可成長', () => {
    const sys = createPopulationSystem(
      makeDefs(),
      makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 5, growthPerDay: 2 }),
    );
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' })); // housing:4
    addResource(state, 'food', 5); // 無 citizens：needed=0；reserve 需求=max(1,0)*1*5=5，5>=5 成立

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.length).toBe(2);
  });

  it('（F5）人口為 0 時，糧食為 0（未達最低 1 人份 reserve）→ 不成長，消除 0 人口無限生死循環', () => {
    const sys = createPopulationSystem(
      makeDefs(),
      makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 5, growthPerDay: 2 }),
    );
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' })); // housing:4
    // 無 citizens、無 food：needed=0 <= available=0，不觸發飢餓；但 reserve 需求=max(1,0)*1*5=5，0<5 不成長

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.length).toBe(0);
  });

  it('(c) 成長人數受住房總空位上限，跨兩棟住房依 buildings 序填滿第一棟後才填下一棟', () => {
    const sys = createPopulationSystem(
      makeDefs(),
      makeConfig({ foodPerCitizenPerDay: 0, growthFoodReserveDays: 0, growthPerDay: 3 }),
    );
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'small1', type: 'small-house', x: 1, y: 1 })); // housing:1
    state.buildings.push(building({ id: 'house1', type: 'house', x: 9, y: 9 })); // housing:4
    addResource(state, 'food', 0);

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.length).toBe(3); // min(3, 1+4)
    const homes = state.citizens.map((c) => c.home).sort();
    expect(homes).toEqual(['house1', 'house1', 'small1']); // small1 只有 1 個空位先填滿
  });

  it('(c) 沒有住房空位時，即使糧食充足也不成長', () => {
    const sys = createPopulationSystem(
      makeDefs(),
      makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 1, growthPerDay: 2 }),
    );
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'small1', type: 'small-house' })); // housing:1
    state.citizens.push(citizen({ id: 'c1', home: 'small1' })); // 已滿
    addResource(state, 'food', 100);

    sys.update(state, makeCtx(TICKS_PER_DAY));

    expect(state.citizens.length).toBe(1);
  });

  it('(d) 決定論：相同初始 state 與 config，兩個獨立 state 各跑 3 日結果深相等', () => {
    const defs = makeDefs();
    const config = makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 1, growthPerDay: 2 });
    function build(seed: number) {
      const state = createInitialState(seed);
      state.buildings.push(building({ id: 'house1', type: 'house' }));
      addResource(state, 'food', 1000);
      const sim = new Simulation(state, [createPopulationSystem(defs, config)], defs);
      return { state, sim };
    }

    const a = build(1);
    const b = build(999);
    a.sim.run(TICKS_PER_DAY * 3);
    b.sim.run(TICKS_PER_DAY * 3);

    expect(a.state.citizens).toEqual(b.state.citizens);
    expect(a.state.resources).toEqual(b.state.resources);
  });

  it('不消耗 rng：呼叫即 throw 的假 rng 下，成長與飢餓分支皆正常執行', () => {
    const sys = createPopulationSystem(
      makeDefs(),
      makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 0, growthPerDay: 2 }),
    );
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1', type: 'house' }));
    addResource(state, 'food', 100);
    const ctx: SimContext = { rng: poisonedRng(), time: timeFromTick(TICKS_PER_DAY) };

    expect(() => sys.update(state, ctx)).not.toThrow();
    expect(state.citizens.length).toBe(2);
  });
});

describe('人口／職業／生產整合（R4）', () => {
  function baseState(): GameState {
    return createInitialState(1);
  }

  it('有住房與充足糧食時，人口從 0 逐日成長（受住房容量上限）', () => {
    const defs: BuildingDef[] = [
      { id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 20, jobs: 0 },
    ];
    const config = makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 0, growthPerDay: 2 });
    const state = baseState();
    state.buildings.push({ id: 'house1', type: 'house', x: 0, y: 0 });
    addResource(state, 'food', 1000);
    const sim = new Simulation(
      state,
      [createJobsSystem(defs), createProductionSystem(defs), createPopulationSystem(defs, config)],
      defs,
    );

    sim.run(TICKS_PER_DAY * 3);

    expect(state.citizens.length).toBe(6); // 2 人/日 * 3 日
  });

  it('新居民被指派後仍要走到工作地才算在職：人未到崗時產出為 0，到崗後才產出', () => {
    const defs: BuildingDef[] = [
      { id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 5, jobs: 0 },
      {
        id: 'lumber-camp',
        name: '伐木場',
        size: { w: 2, h: 2 },
        cost: {},
        production: { wood: 5 },
        housing: 0,
        jobs: 1,
      },
    ];
    const config = makeConfig({ foodPerCitizenPerDay: 0, growthFoodReserveDays: 0, growthPerDay: 5 });
    const state = baseState();
    state.buildings.push({ id: 'house1', type: 'house', x: 0, y: 0 });
    state.buildings.push({ id: 'lc1', type: 'lumber-camp', x: 5, y: 5 });
    const sim = new Simulation(
      state,
      [createJobsSystem(defs), createProductionSystem(defs), createPopulationSystem(defs, config)],
      defs,
    );

    // tick TICKS_PER_DAY（日界）：population 在該 tick 尾端才新增居民，job 仍為 null，
    // 該 tick 的 production 尚未看到新居民在職。
    sim.run(TICKS_PER_DAY);
    expect(getResource(state, 'wood')).toBe(0);

    // 下一 tick：jobs system 已把新居民指派到 lumber-camp，但人還在 house1（本 sim 未掛
    // movement system，居民不會自己移動）。指派不等於在崗，產出仍為 0。
    sim.tick();
    expect(state.citizens.some((citizen) => citizen.job === 'lc1')).toBe(true);
    expect(getResource(state, 'wood')).toBe(0);

    // 把該居民搬到工作地（等同 movement 走完全程），下一 tick 才開始產出全額。
    for (const citizen of state.citizens) {
      if (citizen.job === 'lc1') {
        citizen.x = 5;
        citizen.y = 5;
      }
    }
    sim.tick();
    expect(getResource(state, 'wood')).toBe(5);
  });

  it('糧食耗盡後人口逐日下降（飢餓致死）', () => {
    const defs: BuildingDef[] = [
      { id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 10, jobs: 0 },
    ];
    const config = makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 999, growthPerDay: 0, starvationDeathsPerDay: 1 });
    const state = baseState();
    state.buildings.push({ id: 'house1', type: 'house', x: 0, y: 0 });
    state.citizens.push(
      citizen({ id: 'c1', home: 'house1' }),
      citizen({ id: 'c2', home: 'house1' }),
      citizen({ id: 'c3', home: 'house1' }),
    );
    // food:0，每日 needed=3 > available=0 → 飢餓
    const sim = new Simulation(
      state,
      [createJobsSystem(defs), createProductionSystem(defs), createPopulationSystem(defs, config)],
      defs,
    );

    sim.run(TICKS_PER_DAY); // 第 1 日界
    expect(state.citizens.length).toBe(2);

    sim.run(TICKS_PER_DAY); // 第 2 日界
    expect(state.citizens.length).toBe(1);
  });
});
