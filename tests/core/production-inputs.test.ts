// M4-W1 R1-R2：加工鏈核心——BuildingDef.inputs 欄位驗證與 production system 消耗原料
//
// R1：src/data/types.ts 的 BuildingDef 新增選填欄位 inputs?: Record<string, number>；
//     src/data/loader.ts 的 parseBuildingDefs 比照 cost/production 的嚴格度驗證（未知資源 id、
//     非正數、訊息含建築 id 一律 throw），差異是 inputs 值須為「正數」（cost/production 允許 0）。
// R2：src/core/systems/production.ts 依 inputs 消耗原料，契約見任務簡報 R2(a)-(g)：
//     jobRatio（既有邏輯）→ 名目需求 = inputs[r]*jobRatio → inputRatio = clamp(min(庫存/名目需求),0,1)
//     （名目需求為 0 視為 1）→ 實際產出 = production*jobRatio*inputRatio、實際消耗 = inputs[r]*jobRatio*inputRatio；
//     資源永不為負；與 terrain.consumes 疊加時兩種限制都要生效，地形不足不得只扣原料不產出。
//
// BuildingDef 目前（實作前）尚未宣告 inputs 欄位，用交集型別讓測試碼能在型別新增前先行撰寫、
// 且不影響既有 BuildingDef[] 形參的結構相容性。
import { describe, expect, it } from 'vitest';
import { createProductionSystem } from '../../src/core/systems/production';
import { createInitialState, addResource, getResource } from '../../src/core/world/state';
import type { Building, Citizen, GameState } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import type { SimContext } from '../../src/core/sim/system';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';
import { parseBuildingDefs } from '../../src/data/loader';

type BuildingDefWithInputs = BuildingDef & { inputs?: Record<string, number> };

// ── R1：loader 驗證 inputs 欄位 ──────────────────────────────────────────────

describe('parseBuildingDefs 支援 inputs 欄位（R1）', () => {
  const resourceIds = new Set(['wood', 'grain', 'flour']);

  function validMill(): Record<string, unknown> {
    return {
      id: 'mill',
      name: '磨坊',
      size: { w: 1, h: 1 },
      cost: { wood: 10 },
      production: { flour: 2 },
      housing: 0,
      jobs: 2,
      inputs: { grain: 4 },
    };
  }

  it('合法 inputs 通過驗證，回傳 def.inputs 與輸入相同', () => {
    const defs = parseBuildingDefs([validMill()], resourceIds) as BuildingDefWithInputs[];
    expect(defs[0].inputs).toEqual({ grain: 4 });
  });

  it('省略 inputs（選填欄位）→ def.inputs 為 undefined', () => {
    const { inputs: _inputs, ...withoutInputs } = validMill();
    const defs = parseBuildingDefs([withoutInputs], resourceIds) as BuildingDefWithInputs[];
    expect(defs[0].inputs).toBeUndefined();
  });

  it('空 inputs 物件正規化為 undefined', () => {
    const defs = parseBuildingDefs([{ ...validMill(), inputs: {} }], resourceIds) as BuildingDefWithInputs[];
    expect(defs[0].inputs).toBeUndefined();
  });

  it('inputs 引用未知資源 id → throw 且訊息含建築 id', () => {
    expect(() =>
      parseBuildingDefs([{ ...validMill(), inputs: { unknown: 1 } }], resourceIds),
    ).toThrow(/mill/);
  });

  it('inputs 值為 0 或負數 → throw 且訊息含建築 id（須為正數，不同於 cost/production 允許 0）', () => {
    expect(() => parseBuildingDefs([{ ...validMill(), inputs: { grain: 0 } }], resourceIds)).toThrow(/mill/);
    expect(() => parseBuildingDefs([{ ...validMill(), inputs: { grain: -1 } }], resourceIds)).toThrow(/mill/);
  });

  it('inputs 值非有限數（NaN/Infinity）→ throw 且訊息含建築 id', () => {
    expect(() =>
      parseBuildingDefs([{ ...validMill(), inputs: { grain: Number.NaN } }], resourceIds),
    ).toThrow(/mill/);
    expect(() =>
      parseBuildingDefs([{ ...validMill(), inputs: { grain: Infinity } }], resourceIds),
    ).toThrow(/mill/);
  });

  it('inputs 值型別非數字（字串）→ throw 且訊息含建築 id', () => {
    expect(() =>
      parseBuildingDefs([{ ...validMill(), inputs: { grain: '4' } }], resourceIds),
    ).toThrow(/mill/);
  });

  it('inputs 非物件（陣列/字串）→ throw 且訊息含建築 id', () => {
    expect(() => parseBuildingDefs([{ ...validMill(), inputs: [1, 2] }], resourceIds)).toThrow(/mill/);
    expect(() => parseBuildingDefs([{ ...validMill(), inputs: 'grain' }], resourceIds)).toThrow(/mill/);
  });

  it('回傳的 inputs 是複本：改動 def 不污染原始輸入物件（比照 cost/production 慣例）', () => {
    const input = validMill();
    const defs = parseBuildingDefs([input], resourceIds) as BuildingDefWithInputs[];
    defs[0].inputs!.grain = 999999;
    expect((input.inputs as Record<string, number>).grain).toBe(4);
  });

  it('建築沒有 inputs 欄位時仍不受影響（既有欄位驗證不受破壞）', () => {
    const { inputs: _inputs, ...withoutInputs } = validMill();
    expect(() => parseBuildingDefs([withoutInputs], resourceIds)).not.toThrow();
  });
});

// ── R2：production system 消耗 inputs ────────────────────────────────────────

function makeCtx(seed = 1, tick = 1): SimContext {
  return { rng: createRng(seed), time: timeFromTick(tick) };
}

function building(overrides: Partial<Building>): Building {
  return { id: 'm1', type: 'mill', x: 0, y: 0, ...overrides };
}

function citizen(overrides: Partial<Citizen>): Citizen {
  return { id: 'c1', home: 'house1', job: null, x: 0, y: 0, ...overrides };
}

function employAll(state: GameState, buildingId: string, count: number): void {
  for (let index = 0; index < count; index++) {
    state.citizens.push(citizen({ id: `${buildingId}-w${index}`, job: buildingId }));
  }
}

function millDef(overrides: Partial<BuildingDefWithInputs> = {}): BuildingDefWithInputs {
  return {
    id: 'mill',
    name: '磨坊',
    size: { w: 1, h: 1 },
    cost: {},
    production: { flour: 2 },
    housing: 0,
    jobs: 2,
    inputs: { grain: 4 },
    ...overrides,
  };
}

describe('production system 依 inputs 消耗原料（R2）', () => {
  it('(a) 無 inputs 的建築行為不變（回歸）', () => {
    const def: BuildingDefWithInputs = {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 1, h: 1 },
      cost: {},
      production: { wood: 2 },
      housing: 0,
      jobs: 0,
    };
    const sys = createProductionSystem([def]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'lc1', type: 'lumber-camp' }));

    sys.update(state, makeCtx());

    expect(getResource(state, 'wood')).toBe(2);
  });

  it('(b)(c) inputs 充足且滿在職率 → 全額產出，依 jobRatio(1) 精確扣除 inputs', () => {
    const sys = createProductionSystem([millDef()]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 2); // jobs=2 全職
    addResource(state, 'grain', 100);

    sys.update(state, makeCtx());

    expect(getResource(state, 'flour')).toBe(2);
    expect(getResource(state, 'grain')).toBe(96); // 100 - 4*1(jobRatio)*1(inputRatio)
  });

  it('(b)(c) 在職率未滿（jobs2、在職1）→ 產出與消耗皆依 jobRatio(0.5) 等比例縮減', () => {
    const sys = createProductionSystem([millDef()]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 1); // 1/2 在職
    addResource(state, 'grain', 100);

    sys.update(state, makeCtx());

    expect(getResource(state, 'flour')).toBe(1); // 2*0.5
    expect(getResource(state, 'grain')).toBe(98); // 100 - 4*0.5
  });

  it('在職率未滿時名目需求同步縮減：1/2 到職、grain=2 仍可產 flour 1 並耗盡 grain', () => {
    const sys = createProductionSystem([millDef()]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 1);
    addResource(state, 'grain', 2);

    sys.update(state, makeCtx());

    expect(getResource(state, 'flour')).toBe(1);
    expect(getResource(state, 'grain')).toBe(0);
  });

  it('(b)(c) inputs 不足（庫存1、名目需求4）→ 依 inputRatio(0.25) 等比例縮減產出與消耗，剛好耗盡不超額', () => {
    const sys = createProductionSystem([millDef()]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 2); // 滿職，jobRatio=1
    addResource(state, 'grain', 1);

    sys.update(state, makeCtx());

    expect(getResource(state, 'flour')).toBeCloseTo(0.5); // 2 * 0.25
    expect(getResource(state, 'grain')).toBeCloseTo(0); // 1 - 4*0.25
  });

  it('(e) inputs 庫存為 0 → 產出 0，不 throw', () => {
    const sys = createProductionSystem([millDef()]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 2);

    expect(() => sys.update(state, makeCtx())).not.toThrow();
    expect(getResource(state, 'flour')).toBe(0);
    expect(getResource(state, 'grain')).toBe(0);
  });

  it('(d) 資源永遠不得變成負數：庫存1、名目需求10，連續 20 tick 後庫存恆 ≥ 0 且穩定於 0', () => {
    const hungryDef = millDef({ inputs: { grain: 10 } });
    const sys = createProductionSystem([hungryDef]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 2);
    addResource(state, 'grain', 1);

    for (let tick = 1; tick <= 20; tick++) {
      sys.update(state, makeCtx(1, tick));
      expect(getResource(state, 'grain')).toBeGreaterThanOrEqual(0);
    }
    expect(getResource(state, 'grain')).toBe(0);
  });

  it('浮點消耗誤差也不得讓資源為負（鎖定扣料前的庫存 clamp）', () => {
    const def = millDef({ production: { flour: 1 }, inputs: { grain: 0.6 } });
    const sys = createProductionSystem([def]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 1);
    addResource(state, 'grain', 0.19);

    sys.update(state, makeCtx());

    expect(getResource(state, 'grain')).toBe(0);
    expect(getResource(state, 'grain')).toBeGreaterThanOrEqual(0);
  });

  it('同資源不足時按總需求比例分配，產出不受建築陣列順序影響', () => {
    const defs: BuildingDefWithInputs[] = [
      millDef({ id: 'consumer-a', production: { outputA: 1 }, jobs: 0, inputs: { raw: 4 } }),
      millDef({ id: 'consumer-b', production: { outputB: 1 }, jobs: 0, inputs: { raw: 4 } }),
    ];

    const run = (types: string[]): GameState => {
      const state = createInitialState(1);
      state.buildings.push(...types.map((type, index) => building({ id: `b${index}`, type })));
      addResource(state, 'raw', 6);
      createProductionSystem(defs).update(state, makeCtx());
      return state;
    };

    const forward = run(['consumer-a', 'consumer-b']);
    const reversed = run(['consumer-b', 'consumer-a']);
    expect(getResource(forward, 'outputA')).toBeCloseTo(0.75);
    expect(getResource(forward, 'outputB')).toBeCloseTo(0.75);
    expect(forward.resources).toEqual(reversed.resources);
  });

  it('有 inputs 但 production 為空時仍依 jobRatio 與 inputRatio 扣料', () => {
    const consumer = millDef({ production: {}, inputs: { food: 2 }, jobs: 0 });
    const sys = createProductionSystem([consumer]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'tavern1' }));
    addResource(state, 'food', 100);

    sys.update(state, makeCtx());

    expect(getResource(state, 'food')).toBe(98);
  });

  it('多項 inputs：inputRatio 取所有資源中最嚴格者（min），兩項消耗皆依同一比例', () => {
    const def = millDef({ production: { flour: 10 }, inputs: { grain: 4, wood: 2 } });
    const sys = createProductionSystem([def]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 'm1' }));
    employAll(state, 'm1', 2); // 滿職
    addResource(state, 'grain', 100); // 充足，非瓶頸
    addResource(state, 'wood', 0.2); // wood 是瓶頸：0.2/2 = 0.1

    sys.update(state, makeCtx());

    expect(getResource(state, 'flour')).toBeCloseTo(1); // 10 * 0.1
    expect(getResource(state, 'wood')).toBeCloseTo(0); // 0.2 - 2*0.1
    expect(getResource(state, 'grain')).toBeCloseTo(100 - 4 * 0.1); // 同一比例，非各自獨立計算
  });

  it('(g) 決定論：同 state 同 defs 跑兩次深等，且不消耗 rng', () => {
    const defs: BuildingDefWithInputs[] = [millDef()];
    function run(): GameState {
      const state = createInitialState(1);
      state.buildings.push(building({ id: 'm1' }));
      employAll(state, 'm1', 2);
      addResource(state, 'grain', 5);
      const sys = createProductionSystem(defs);
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
      sys.update(state, { rng: poisonedRng, time: timeFromTick(1) });
      return state;
    }

    const a = run();
    const b = run();

    expect(a.resources).toEqual(b.resources);
  });
});

// ── R2(f)：inputs 與 terrain.consumes 疊加 ──────────────────────────────────

function terrainInputDef(overrides: Partial<BuildingDefWithInputs> = {}): BuildingDefWithInputs {
  return {
    id: 'terrain-input-b',
    name: '地形加原料',
    size: { w: 1, h: 1 },
    cost: {},
    production: { output: 2 },
    housing: 0,
    jobs: 0,
    inputs: { fuel: 2 },
    terrain: { consumes: ['rock'] },
    ...overrides,
  };
}

describe('production system：inputs 與 terrain.consumes 疊加（R2f）', () => {
  it('地形資源不足（無可用來源）時不得扣減 inputs——不能只扣不產', () => {
    const sys = createProductionSystem([terrainInputDef()]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 't1', type: 'terrain-input-b', x: 5, y: 5 }));
    // (5,5) 及四鄰全設為非 rock，findTerrainSource 恆回 null（無可用地形來源）
    for (const [x, y] of [
      [5, 5],
      [5, 4],
      [6, 5],
      [5, 6],
      [4, 5],
    ]) {
      state.terrainOverrides[`${x},${y}`] = { type: 'grass' };
    }
    addResource(state, 'fuel', 100);

    sys.update(state, makeCtx());

    expect(getResource(state, 'output')).toBe(0);
    expect(getResource(state, 'fuel')).toBe(100); // 不得被扣減
  });

  it('地形與 inputs 皆充足 → 產出全額，兩種資源皆依全額比例扣除', () => {
    const sys = createProductionSystem([terrainInputDef()]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 't1', type: 'terrain-input-b', x: 5, y: 5 }));
    state.terrainOverrides['5,5'] = { type: 'rock', resource: 4800 };
    addResource(state, 'fuel', 100);

    sys.update(state, makeCtx());

    expect(getResource(state, 'output')).toBe(2);
    expect(getResource(state, 'fuel')).toBe(98); // 100 - 2
  });

  it('多產出遇地形部分供給時，inputs 依總實產／總名目產出比例扣除', () => {
    const def = terrainInputDef({
      production: { out1: 1, out2: 10 },
      inputs: { fuel: 4 },
    });
    const sys = createProductionSystem([def]);
    const state = createInitialState(1);
    state.buildings.push(building({ id: 't1', type: 'terrain-input-b', x: 5, y: 5 }));
    state.terrainOverrides['5,5'] = { type: 'rock', resource: 1 };
    for (const [x, y] of [[5, 4], [6, 5], [5, 6], [4, 5]]) {
      state.terrainOverrides[`${x},${y}`] = { type: 'grass' };
    }
    addResource(state, 'fuel', 100);

    sys.update(state, makeCtx());

    expect(getResource(state, 'out1')).toBe(1);
    expect(getResource(state, 'out2')).toBe(0);
    expect(getResource(state, 'fuel')).toBeCloseTo(100 - 4 / 11);
  });
});
