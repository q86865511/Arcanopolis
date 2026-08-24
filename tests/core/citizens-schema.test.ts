// R1：Citizen 型別＋ GameState.citizens（src/core/world/state.ts）
// R2：存檔版本升級至 3，SAVE_MIGRATIONS 含 from:1（既有 no-op）與 from:2（補 citizens）
//     （src/core/save/save.ts）
// R3：deserializeGameState 對 citizens 欄位的驗證（src/core/save/save.ts）
import { describe, expect, it } from 'vitest';
import type { Citizen, GameState } from '../../src/core/world/state';
import { createInitialState, SAVE_SCHEMA_VERSION } from '../../src/core/world/state';
import { deserializeGameState, SAVE_MIGRATIONS } from '../../src/core/save/save';

describe('R1：Citizen 型別＋ GameState.citizens', () => {
  it('createInitialState 填入空 citizens 陣列', () => {
    const state = createInitialState(1);
    expect(state.citizens).toEqual([]);
  });

  it('含 citizens 的 state 仍為純資料：JSON round-trip 後與原 state 深相等（job:null、浮點 x/y）', () => {
    const state = createInitialState(1);
    const citizen: Citizen = { id: 'c1', home: 'house@0,0#0', job: null, x: 1.5, y: 2.25 };
    state.citizens.push(citizen);

    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it('Citizen.job 可為非空字串（已分配工作）', () => {
    const state = createInitialState(1);
    const citizen: Citizen = { id: 'c2', home: 'house@0,0#0', job: 'lumber-camp@1,1#0', x: 0, y: 0 };
    state.citizens.push(citizen);
    expect(state.citizens[0].job).toBe('lumber-camp@1,1#0');
  });
});

describe('R2：存檔版本升級至 3（citizens 加入 GameState）', () => {
  it('SAVE_SCHEMA_VERSION = 5（M4.5-W2：建築新增 progress）', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(5);
  });

  it('SAVE_MIGRATIONS 含 from:1（no-op）、from:2（補 citizens）、from:3（補地形欄位）、from:4（progress 選填放行）', () => {
    const froms = SAVE_MIGRATIONS.map((m) => m.from).sort((a, b) => a - b);
    expect(froms).toEqual([1, 2, 3, 4]);
  });

  /** 手工構造的合法 v1 存檔（schemaVersion:1，無 citizens，含一筆 pending addResource）。 */
  function v1SaveJson(): string {
    const v1 = {
      schemaVersion: 1,
      tick: 5,
      rngState: 12345,
      resources: { wood: 10 },
      buildings: [{ id: 'house@0,0#0', type: 'house', x: 0, y: 0 }],
      pendingCommands: [{ type: 'addResource', resource: 'wood', amount: 3 }],
    };
    return JSON.stringify(v1);
  }

  /** 手工構造的合法 v2 存檔（schemaVersion:2，無 citizens，含一筆 pending placeBuilding）。 */
  function v2SaveJson(): string {
    const v2 = {
      schemaVersion: 2,
      tick: 8,
      rngState: 999,
      resources: { wood: 20 },
      buildings: [],
      pendingCommands: [{ type: 'placeBuilding', buildingType: 'house', x: 2, y: 3 }],
    };
    return JSON.stringify(v2);
  }

  it('v1 存檔：預設參數 deserialize 成功，schemaVersion 升為 3、citizens 補為 []、pending 保留', () => {
    const restored = deserializeGameState(v1SaveJson());

    expect(restored.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(restored.citizens).toEqual([]);
    expect(restored.pendingCommands).toEqual([{ type: 'addResource', resource: 'wood', amount: 3 }]);
  });

  it('v2 存檔：預設參數 deserialize 成功，citizens 補為 []、pending 保留', () => {
    const restored = deserializeGameState(v2SaveJson());

    expect(restored.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(restored.citizens).toEqual([]);
    expect(restored.pendingCommands).toEqual([{ type: 'placeBuilding', buildingType: 'house', x: 2, y: 3 }]);
  });

  it('deserializeGameState(v2json, []) → throw（版本落後且無對應遷移）', () => {
    expect(() => deserializeGameState(v2SaveJson(), [])).toThrow();
  });

  it('v2 存檔已含合法 citizens 陣列 → migrate 缺欄才補，保留原值不被清空', () => {
    const v2 = JSON.parse(v2SaveJson());
    v2.citizens = [{ id: 'c1', home: 'house@0,0#0', job: null, x: 0, y: 0 }];
    const restored = deserializeGameState(JSON.stringify(v2));

    expect(restored.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(restored.citizens).toEqual([{ id: 'c1', home: 'house@0,0#0', job: null, x: 0, y: 0 }]);
  });

  it('v2 存檔的 citizens 為非法值（字串）→ migrate 保留原值，交後續 v3 validator 拒收', () => {
    const v2 = JSON.parse(v2SaveJson());
    v2.citizens = 'not-an-array';
    expect(() => deserializeGameState(JSON.stringify(v2))).toThrow(/citizens/);
  });
});

describe('R3：deserializeGameState 的 citizens 驗證（訊息含欄位名與索引）', () => {
  function baseState(): GameState {
    return createInitialState(1);
  }

  it('citizens 非陣列 → throw 且訊息含 citizens', () => {
    const base = baseState();
    expect(() => deserializeGameState(JSON.stringify({ ...base, citizens: {} }))).toThrow(/citizens/);
  });

  it('citizens 元素 id 非非空字串 → throw 且訊息含 citizens 與索引', () => {
    const base = baseState();
    const bad = { ...base, citizens: [{ id: '', home: 'house@0,0#0', job: null, x: 0, y: 0 }] };
    expect(() => deserializeGameState(JSON.stringify(bad))).toThrow(/citizens\[0\]/);
  });

  it('citizens 元素 home 非非空字串 → throw 且訊息含欄位名與索引', () => {
    const base = baseState();
    const bad = { ...base, citizens: [{ id: 'c1', home: '', job: null, x: 0, y: 0 }] };
    expect(() => deserializeGameState(JSON.stringify(bad))).toThrow(/citizens\[0\].*home/);
  });

  it('citizens 元素 job 非（非空字串或 null）→ throw 且訊息含欄位名與索引', () => {
    const base = baseState();
    const badEmpty = { ...base, citizens: [{ id: 'c1', home: 'house@0,0#0', job: '', x: 0, y: 0 }] };
    expect(() => deserializeGameState(JSON.stringify(badEmpty))).toThrow(/citizens\[0\].*job/);

    const badNum = { ...base, citizens: [{ id: 'c1', home: 'house@0,0#0', job: 5, x: 0, y: 0 }] };
    expect(() => deserializeGameState(JSON.stringify(badNum))).toThrow(/citizens\[0\].*job/);
  });

  it('citizens 元素 x/y 非有限數 → throw 且訊息含欄位名與索引', () => {
    const base = baseState();
    const badX = { ...base, citizens: [{ id: 'c1', home: 'house@0,0#0', job: null, x: Number.NaN, y: 0 }] };
    expect(() => deserializeGameState(JSON.stringify(badX))).toThrow(/citizens\[0\].*x/);

    const badY = { ...base, citizens: [{ id: 'c1', home: 'house@0,0#0', job: null, x: 0, y: Infinity }] };
    expect(() => deserializeGameState(JSON.stringify(badY))).toThrow(/citizens\[0\].*y/);
  });

  it('合法 citizens（含 job:null 與浮點 x/y）通過並完整回傳', () => {
    const base = baseState();
    const citizens = [
      { id: 'c1', home: 'house@0,0#0', job: null, x: 1.25, y: 2.75 },
      { id: 'c2', home: 'house@0,0#0', job: 'lumber-camp@1,0#0', x: 3, y: 4 },
    ];
    const restored = deserializeGameState(JSON.stringify({ ...base, citizens }));
    expect(restored.citizens).toEqual(citizens);
  });

  it('citizens 元素 id 長度超過 128 → throw 且訊息含 citizens 與索引', () => {
    const base = baseState();
    const bad = {
      ...base,
      citizens: [{ id: 'x'.repeat(129), home: 'house@0,0#0', job: null, x: 0, y: 0 }],
    };
    expect(() => deserializeGameState(JSON.stringify(bad))).toThrow(/citizens\[0\].*id/);
  });

  it('citizens 元素 x 絕對值超過 1e6 → throw 且訊息含 citizens 與索引', () => {
    const base = baseState();
    const bad = { ...base, citizens: [{ id: 'c1', home: 'house@0,0#0', job: null, x: 1e7, y: 0 }] };
    expect(() => deserializeGameState(JSON.stringify(bad))).toThrow(/citizens\[0\].*x/);
  });

  it('citizens 陣列長度超過 100000 → throw 且訊息含 citizens', () => {
    const base = baseState();
    const citizens = Array.from({ length: 100001 }, (_, i) => ({
      id: `c${i}`,
      home: 'house@0,0#0',
      job: null,
      x: 0,
      y: 0,
    }));
    expect(() => deserializeGameState(JSON.stringify({ ...base, citizens }))).toThrow(/citizens/);
  });
});
