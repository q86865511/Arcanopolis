// M5-W2：資源趨勢歷史與人口診斷（src/render/resourceDiagnostics.ts）純函數測試。
// 比照 tests/core/population-system.test.ts 的 fixture 風格（createInitialState + helper）。
import { describe, expect, it } from 'vitest';
import { addResource, createInitialState } from '../../src/core/world/state';
import type { Building, Citizen } from '../../src/core/world/state';
import type { BuildingDef, PopulationConfig } from '../../src/data/types';
import {
  HISTORY_MAX_DAYS,
  createResourceHistory,
  dailyDelta,
  diagnosePopulation,
  recordDay,
} from '../../src/render/resourceDiagnostics';

function building(overrides: Partial<Building>): Building {
  return { id: 'house1', type: 'house', x: 0, y: 0, ...overrides };
}

function citizen(overrides: Partial<Citizen>): Citizen {
  return { id: 'c1', home: 'house1', job: null, x: 0, y: 0, ...overrides };
}

function makeDefs(overrides: Partial<BuildingDef> = {}): BuildingDef[] {
  return [
    {
      id: 'house',
      name: '民居',
      size: { w: 1, h: 1 },
      cost: {},
      production: {},
      housing: 5,
      jobs: 0,
      ...overrides,
    },
  ];
}

function makeConfig(overrides: Partial<PopulationConfig> = {}): PopulationConfig {
  return {
    foodPerCitizenPerDay: 1,
    growthPerDay: 2,
    growthFoodReserveDays: 3,
    starvationDeathsPerDay: 1,
    maxCommuteDistance: 4,
    ...overrides,
  };
}

describe('資源歷史（createResourceHistory / recordDay / dailyDelta）', () => {
  it('歷史為空時 dailyDelta 回 null（尚無資料）', () => {
    const history = createResourceHistory();
    expect(dailyDelta(history, 'wood')).toBeNull();
  });

  it('只記錄過一天時 dailyDelta 仍回 null（歷史不足兩筆才算得出增減）', () => {
    let history = createResourceHistory();
    history = recordDay(history, 1, { wood: 10 });
    expect(dailyDelta(history, 'wood')).toBeNull();
  });

  it('記錄兩天後，dailyDelta 回最近一日的增減（正值＝增加）', () => {
    let history = createResourceHistory();
    history = recordDay(history, 1, { wood: 10 });
    history = recordDay(history, 2, { wood: 25 });
    expect(dailyDelta(history, 'wood')).toBe(15);
  });

  it('資源減少時 dailyDelta 回負值', () => {
    let history = createResourceHistory();
    history = recordDay(history, 1, { food: 50 });
    history = recordDay(history, 2, { food: 30 });
    expect(dailyDelta(history, 'food')).toBe(-20);
  });

  it('同一天重複呼叫 recordDay 會覆蓋而非新增一筆（避免同日內誤觸發灌爆歷史）', () => {
    let history = createResourceHistory();
    history = recordDay(history, 1, { wood: 10 });
    history = recordDay(history, 1, { wood: 12 }); // 同一天再記一次，數值更新
    history = recordDay(history, 2, { wood: 20 });
    expect(history.snapshots.length).toBe(2);
    expect(dailyDelta(history, 'wood')).toBe(8); // 20 - 12（不是 20 - 10）
  });

  it('歷史超過 HISTORY_MAX_DAYS 天時只保留最近幾天，dailyDelta 仍以最後兩筆為準', () => {
    let history = createResourceHistory();
    for (let day = 1; day <= HISTORY_MAX_DAYS + 5; day++) {
      history = recordDay(history, day, { wood: day * 10 });
    }
    expect(history.snapshots.length).toBe(HISTORY_MAX_DAYS);
    // 最舊一筆應該是第 (HISTORY_MAX_DAYS+5 - HISTORY_MAX_DAYS + 1) 天，而非第 1 天
    expect(history.snapshots[0].day).toBe(6);
    expect(dailyDelta(history, 'wood')).toBe(10); // 每天固定 +10
  });

  it('查詢從未記錄過的資源 id 時視為 0（own-property 語義，不因鍵不存在而 throw）', () => {
    let history = createResourceHistory();
    history = recordDay(history, 1, { wood: 10 });
    history = recordDay(history, 2, { wood: 15 }); // 沒有 stone 這個鍵
    expect(dailyDelta(history, 'stone')).toBe(0);
  });
});

describe('diagnosePopulation（比照 src/core/systems/population.ts 的判斷順序與門檻）', () => {
  it('needed > available → starving，deficit 為缺口量', () => {
    const state = createInitialState(1);
    for (let i = 0; i < 5; i++) state.citizens.push(citizen({ id: `c${i}` }));
    state.buildings.push(building({}));
    addResource(state, 'food', 3); // needed=5 > available=3

    const result = diagnosePopulation(state, makeDefs(), makeConfig({ foodPerCitizenPerDay: 1 }));
    expect(result).toEqual({ status: 'starving', deficit: 2 });
  });

  it('needed === available（邊界，非 starving）但 remaining < reserveRequirement → food-short', () => {
    const state = createInitialState(1);
    for (let i = 0; i < 5; i++) state.citizens.push(citizen({ id: `c${i}` }));
    state.buildings.push(building({}));
    addResource(state, 'food', 5); // needed=5===available=5；consumed=5, remaining=0

    // reserveRequirement = max(1,5)*1*3 = 15；remaining(0) < 15
    const result = diagnosePopulation(state, makeDefs(), makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 3 }));
    expect(result).toEqual({ status: 'food-short', shortfall: 15 });
  });

  it('remaining === reserveRequirement（邊界，非 food-short）且住房已滿 → housing-full', () => {
    const state = createInitialState(1);
    for (let i = 0; i < 5; i++) state.citizens.push(citizen({ id: `c${i}`, home: 'house1' }));
    state.buildings.push(building({ id: 'house1' }));
    // needed=5；reserveRequirement=max(1,5)*1*3=15；remaining 要恰好 15 → available = 5(needed) + 15 = 20
    addResource(state, 'food', 20);

    // housing:5，5 個 citizen 都 home=house1 → vacancy=0
    const result = diagnosePopulation(state, makeDefs({ housing: 5 }), makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 3 }));
    expect(result).toEqual({ status: 'housing-full' });
  });

  it('食物充足、reserve 達標、住房有空位 → growing，vacancies 為剩餘空位數', () => {
    const state = createInitialState(1);
    for (let i = 0; i < 3; i++) state.citizens.push(citizen({ id: `c${i}`, home: 'house1' }));
    state.buildings.push(building({ id: 'house1' }));
    addResource(state, 'food', 1000);

    // housing:5，3 個 citizen 住 house1 → vacancy=2
    const result = diagnosePopulation(state, makeDefs({ housing: 5 }), makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 1 }));
    expect(result).toEqual({ status: 'growing', vacancies: 2 });
  });

  it('人口為 0 時 reserve 門檻仍以「至少 1 人份」計算（比照 population.ts 的 F5 防護）', () => {
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'house1' }));
    addResource(state, 'food', 4); // needed=0；reserveRequirement=max(1,0)*1*5=5；remaining=4<5

    const result = diagnosePopulation(state, makeDefs({ housing: 5 }), makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 5 }));
    expect(result).toEqual({ status: 'food-short', shortfall: 1 });
  });

  it('沒有任何住房建築（vacancies 恆為 0）→ housing-full', () => {
    const state = createInitialState(1);
    addResource(state, 'food', 1000);
    // 無 citizens、無 buildings：needed=0, reserveRequirement=max(1,0)*1*1=1，food 給 1000 遠超過
    const result = diagnosePopulation(state, makeDefs({ housing: 5 }), makeConfig({ foodPerCitizenPerDay: 1, growthFoodReserveDays: 1 }));
    expect(result).toEqual({ status: 'housing-full' });
  });
});
