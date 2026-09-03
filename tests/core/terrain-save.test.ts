// R4：GameState 擴充 worldSeed/worldSize/terrainOverrides（src/core/world/state.ts）
// R6：存檔 v6（SAVE_SCHEMA_VERSION、舊檔作廢、deserializeGameState 的欄位驗證含 roads）
import { describe, expect, it } from 'vitest';
import { createInitialState, SAVE_SCHEMA_VERSION, type GameState } from '../../src/core/world/state';
import { deserializeGameState, OutdatedSaveError, serializeGameState } from '../../src/core/save/save';
import { TERRAIN_GENERATOR_VERSION, type TerrainOverride } from '../../src/core/world/terrain';

describe('R4：GameState 擴充 worldSeed/worldSize/terrainOverrides', () => {
  it('createInitialState(seed) 預設 worldSeed=seed、worldSize=200、terrainOverrides={}', () => {
    const state = createInitialState(7);
    expect(state.worldSeed).toBe(7);
    expect(state.worldSize).toBe(200);
    expect(state.terrainOverrides).toEqual({});
  });

  it('不同 seed 各自反映到 worldSeed', () => {
    expect(createInitialState(1).worldSeed).toBe(1);
    expect(createInitialState(42).worldSeed).toBe(42);
  });

  it('仍為純資料：JSON round-trip 後與原 state 深相等（含新欄位）', () => {
    const state = createInitialState(3);
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });

  it('terrainOverrides 內含 TerrainOverride（type/resource）時仍可正確 round-trip', () => {
    const state = createInitialState(3);
    const overrides: Record<string, TerrainOverride> = {
      '1,1': { type: 'sand' },
      '2,2': { resource: 5 },
      '3,3': { type: 'forest', resource: 2 },
    };
    (state as GameState & { terrainOverrides: Record<string, TerrainOverride> }).terrainOverrides = overrides;

    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped.terrainOverrides).toEqual(overrides);
  });
});

describe('R6：存檔 v6——SAVE_SCHEMA_VERSION 與舊檔作廢', () => {
  it('SAVE_SCHEMA_VERSION = 6（M6-W1：roads 進 schema）', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(6);
  });

  it('手工構造的 v3 存檔（無地形欄位）→ 不再補欄遷移，一律 OutdatedSaveError', () => {
    const v3 = {
      schemaVersion: 3,
      tick: 5,
      rngState: 777,
      resources: { wood: 10 },
      buildings: [],
      citizens: [],
      pendingCommands: [],
    };

    expect(() => deserializeGameState(JSON.stringify(v3))).toThrow(OutdatedSaveError);
  });

  it('deserializeGameState 對 schemaVersion===SAVE_SCHEMA_VERSION 的存檔可正常 round-trip', () => {
    const state = createInitialState(9);
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    expect(restored).toEqual(state);
  });

  it('C1：terrainGeneratorVersion 大於程式目前支援版本 → throw（存檔的地形演算法版本比程式新）', () => {
    const state = createInitialState(1);
    const json = JSON.stringify({ ...state, terrainGeneratorVersion: TERRAIN_GENERATOR_VERSION + 1 });
    expect(() => deserializeGameState(json)).toThrow(/地形演算法版本比程式新/);
  });

  it('C1：terrainGeneratorVersion 非正整數 → throw', () => {
    const state = createInitialState(1);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, terrainGeneratorVersion: 0 })),
    ).toThrow(/terrainGeneratorVersion/);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, terrainGeneratorVersion: 1.5 })),
    ).toThrow(/terrainGeneratorVersion/);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, terrainGeneratorVersion: 'x' })),
    ).toThrow(/terrainGeneratorVersion/);
  });

  it('C1：terrainGeneratorVersion 恰為 TERRAIN_GENERATOR_VERSION 時 round-trip 保留原值', () => {
    const state = createInitialState(1);
    expect(state.terrainGeneratorVersion).toBe(TERRAIN_GENERATOR_VERSION);
    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.terrainGeneratorVersion).toBe(TERRAIN_GENERATOR_VERSION);
  });

  it('C4：createInitialState(-1) 的 worldSeed 正規化為 4294967295，且可 serialize→deserialize', () => {
    const state = createInitialState(-1);
    expect(state.worldSeed).toBe(4294967295);
    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.worldSeed).toBe(4294967295);
  });

  it('F1b：serializeGameState 對 roads 的鍵格式／座標／值做與 deserialize 對稱的驗證（Codex 第二審 M6-W1）', () => {
    const outOfWorld = createInitialState(1);
    outOfWorld.roads = { [`${outOfWorld.worldSize},0`]: 1 };
    expect(() => serializeGameState(outOfWorld)).toThrow(/roads 鍵座標超出世界範圍/);

    const leadingZero = createInitialState(1);
    leadingZero.roads = { '01,0': 1 };
    expect(() => serializeGameState(leadingZero)).toThrow(/roads 鍵格式不合法/);

    const wrongValue = createInitialState(1);
    (wrongValue as unknown as { roads: Record<string, number> }).roads = { '1,1': 2 };
    expect(() => serializeGameState(wrongValue)).toThrow(/必須是 1/);
  });

  it('F1：serializeGameState 對 citizens／terrainOverrides／roads 超過上限（100000/200000/200000）→ throw', () => {
    const stateWithTooManyCitizens = createInitialState(1);
    (stateWithTooManyCitizens as GameState).citizens = Array.from({ length: 100001 }, (_, i) => ({
      id: `c${i}`,
      home: 'h',
      job: null,
      x: 0,
      y: 0,
    }));
    expect(() => serializeGameState(stateWithTooManyCitizens)).toThrow(/citizens/);

    const stateWithTooManyOverrides = createInitialState(1);
    stateWithTooManyOverrides.worldSize = 500;
    const overrides: Record<string, TerrainOverride> = {};
    for (let i = 0; i < 200001; i++) {
      overrides[`${i % 500},${Math.floor(i / 500)}`] = { type: 'grass' };
    }
    (stateWithTooManyOverrides as GameState).terrainOverrides = overrides;
    expect(() => serializeGameState(stateWithTooManyOverrides)).toThrow(/terrainOverrides/);

    const stateWithTooManyRoads = createInitialState(1);
    stateWithTooManyRoads.worldSize = 500;
    const roads: Record<string, 1> = {};
    for (let i = 0; i < 200001; i++) {
      roads[`${i % 500},${Math.floor(i / 500)}`] = 1;
    }
    stateWithTooManyRoads.roads = roads;
    expect(() => serializeGameState(stateWithTooManyRoads)).toThrow(/roads/);
  });

  it('F5：worldSize 低於下限 10 → throw；恰為 10 則不因此 throw', () => {
    const state = createInitialState(1);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, worldSize: 9 })),
    ).toThrow(/worldSize/);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, worldSize: 10 })),
    ).not.toThrow();
  });

  it('C3：terrainOverrides 鍵格式不合法（非 "x,y"、負數、前導零）→ throw', () => {
    const state = createInitialState(1);
    const base = (overrides: Record<string, unknown>): string =>
      JSON.stringify({ ...state, terrainOverrides: overrides });

    expect(() => deserializeGameState(base({ abc: { type: 'sand' } }))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(base({ '-1,0': { type: 'sand' } }))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(base({ '01,0': { type: 'sand' } }))).toThrow(/terrainOverrides/);
  });

  it('C3：terrainOverrides 鍵座標 ≥ worldSize → throw', () => {
    const state = createInitialState(1);
    state.worldSize = 10;
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, terrainOverrides: { '10,0': { type: 'sand' } } })),
    ).toThrow(/terrainOverrides/);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, terrainOverrides: { '0,10': { type: 'sand' } } })),
    ).toThrow(/terrainOverrides/);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...state, terrainOverrides: { '9,9': { type: 'sand' } } })),
    ).not.toThrow();
  });
});

describe('R6：deserializeGameState 欄位驗證——worldSeed/worldSize', () => {
  function v4Json(overrides: Record<string, unknown> = {}): string {
    const state = createInitialState(1);
    return JSON.stringify({ ...state, ...overrides });
  }

  it('worldSeed 非整數/負數/NaN → throw 且訊息含欄位名', () => {
    expect(() => deserializeGameState(v4Json({ worldSeed: 1.5 }))).toThrow(/worldSeed/);
    expect(() => deserializeGameState(v4Json({ worldSeed: -1 }))).toThrow(/worldSeed/);
    expect(() => deserializeGameState(v4Json({ worldSeed: Number.NaN }))).toThrow(/worldSeed/);
    expect(() => deserializeGameState(v4Json({ worldSeed: '1' }))).toThrow(/worldSeed/);
  });

  it('worldSize 非整數/負數/NaN → throw 且訊息含欄位名', () => {
    expect(() => deserializeGameState(v4Json({ worldSize: 1.5 }))).toThrow(/worldSize/);
    expect(() => deserializeGameState(v4Json({ worldSize: -1 }))).toThrow(/worldSize/);
    expect(() => deserializeGameState(v4Json({ worldSize: 0 }))).toThrow(/worldSize/);
    expect(() => deserializeGameState(v4Json({ worldSize: Number.NaN }))).toThrow(/worldSize/);
  });

  it('worldSize 超過上限 2000 → throw；恰為 2000 則不因此欄位 throw', () => {
    expect(() => deserializeGameState(v4Json({ worldSize: 2001 }))).toThrow(/worldSize/);
    expect(() => deserializeGameState(v4Json({ worldSize: 2000 }))).not.toThrow();
  });
});

describe('R6：deserializeGameState 欄位驗證——terrainOverrides', () => {
  function v4Json(overrides: Record<string, unknown> = {}): string {
    const state = createInitialState(1);
    return JSON.stringify({ ...state, ...overrides });
  }

  it('terrainOverrides 非物件（陣列/字串/數字）→ throw 且訊息含欄位名', () => {
    expect(() => deserializeGameState(v4Json({ terrainOverrides: [] }))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(v4Json({ terrainOverrides: 'nope' }))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(v4Json({ terrainOverrides: 5 }))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(v4Json({ terrainOverrides: null }))).toThrow(/terrainOverrides/);
  });

  it('terrainOverrides 的 value 非物件 → throw', () => {
    expect(() =>
      deserializeGameState(v4Json({ terrainOverrides: { '1,1': 'sand' } })),
    ).toThrow(/terrainOverrides/);
    expect(() =>
      deserializeGameState(v4Json({ terrainOverrides: { '1,1': null } })),
    ).toThrow(/terrainOverrides/);
    expect(() =>
      deserializeGameState(v4Json({ terrainOverrides: { '1,1': [1, 2] } })),
    ).toThrow(/terrainOverrides/);
  });

  it('terrainOverrides 的 value.type 非合法 TerrainType → throw', () => {
    expect(() =>
      deserializeGameState(v4Json({ terrainOverrides: { '1,1': { type: 'lava' } } })),
    ).toThrow(/terrainOverrides/);
  });

  it('terrainOverrides 的 value.resource 非有限非負數 → throw', () => {
    expect(() =>
      deserializeGameState(v4Json({ terrainOverrides: { '1,1': { resource: -1 } } })),
    ).toThrow(/terrainOverrides/);
    expect(() =>
      deserializeGameState(v4Json({ terrainOverrides: { '1,1': { resource: Number.NaN } } })),
    ).toThrow(/terrainOverrides/);
    expect(() =>
      deserializeGameState(v4Json({ terrainOverrides: { '1,1': { resource: Infinity } } })),
    ).toThrow(/terrainOverrides/);
  });

  it('合法 override（type、resource、兩者皆有、皆無）通過驗證', () => {
    expect(() =>
      deserializeGameState(
        v4Json({
          terrainOverrides: {
            '1,1': { type: 'sand' },
            '2,2': { resource: 3 },
            '3,3': { type: 'forest', resource: 1.5 },
            '4,4': {},
          },
        }),
      ),
    ).not.toThrow();
  });

  it('terrainOverrides 鍵數超過上限 200000 → throw；恰為上限則不因此 throw', () => {
    // C3：鍵座標須 < worldSize，故用夠大的 worldSize（500×500=250000 ≥ 200001）
    // 把 200001 個鍵全部鋪在界內，單純測「鍵數上限」而不誤觸座標越界檢查。
    const boundsWorldSize = 500;
    function buildOverrides(n: number): Record<string, { type: string }> {
      const result: Record<string, { type: string }> = {};
      for (let i = 0; i < n; i++) {
        result[`${i % boundsWorldSize},${Math.floor(i / boundsWorldSize)}`] = { type: 'grass' };
      }
      return result;
    }

    expect(() =>
      deserializeGameState(v4Json({ worldSize: boundsWorldSize, terrainOverrides: buildOverrides(200001) })),
    ).toThrow(/terrainOverrides/);

    expect(() =>
      deserializeGameState(v4Json({ worldSize: boundsWorldSize, terrainOverrides: buildOverrides(200000) })),
    ).not.toThrow();
  }, 15000);
});

describe('M6-W1：roads 的 round-trip 與欄位驗證', () => {
  function v6Json(overrides: Record<string, unknown> = {}): string {
    const state = createInitialState(1);
    return JSON.stringify({ ...state, ...overrides });
  }

  it('createInitialState 的 roads 為空物件', () => {
    expect(createInitialState(1).roads).toEqual({});
  });

  it('鋪了幾格路 → serialize/deserialize 後完全相等', () => {
    const state = createInitialState(1);
    state.roads['3,4'] = 1;
    state.roads['3,5'] = 1;
    state.roads['0,0'] = 1;

    const restored = deserializeGameState(serializeGameState(state));

    expect(restored.roads).toEqual({ '3,4': 1, '3,5': 1, '0,0': 1 });
    expect(restored).toEqual(state);
  });

  it('缺 roads 欄位 → throw（v6 起是必填，不靜默補空物件）', () => {
    const raw = JSON.parse(serializeGameState(createInitialState(1))) as Record<string, unknown>;
    delete raw.roads;
    expect(() => deserializeGameState(JSON.stringify(raw))).toThrow(/roads/);
  });

  it('roads 非物件（陣列/字串/數字/null）→ throw 且訊息含欄位名', () => {
    expect(() => deserializeGameState(v6Json({ roads: [] }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: 'nope' }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: 5 }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: null }))).toThrow(/roads/);
  });

  it('roads 鍵格式不合法（非 "x,y"、負數、前導零）→ throw', () => {
    expect(() => deserializeGameState(v6Json({ roads: { 'a,b': 1 } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '-1,0': 1 } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '01,0': 1 } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '1': 1 } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '1,2,3': 1 } }))).toThrow(/roads/);
  });

  it('roads 鍵座標 ≥ worldSize → throw；界內則通過', () => {
    expect(() => deserializeGameState(v6Json({ worldSize: 10, roads: { '10,0': 1 } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ worldSize: 10, roads: { '0,10': 1 } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ worldSize: 10, roads: { '9,9': 1 } }))).not.toThrow();
  });

  it('roads 的值不是嚴格 1（true/2/"1"/null/物件）→ throw', () => {
    expect(() => deserializeGameState(v6Json({ roads: { '1,1': true } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '1,1': 2 } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '1,1': '1' } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '1,1': null } }))).toThrow(/roads/);
    expect(() => deserializeGameState(v6Json({ roads: { '1,1': { level: 1 } } }))).toThrow(/roads/);
  });

  it('roads 鍵數超過上限 200000 → throw；恰為上限則不因此 throw', () => {
    // 比照 terrainOverrides 的上限測試：worldSize 放大到 500 讓 200001 個鍵全落在界內，
    // 單純測「鍵數上限」而不誤觸座標越界檢查。
    const boundsWorldSize = 500;
    function buildRoads(n: number): Record<string, 1> {
      const result: Record<string, 1> = {};
      for (let i = 0; i < n; i++) {
        result[`${i % boundsWorldSize},${Math.floor(i / boundsWorldSize)}`] = 1;
      }
      return result;
    }

    expect(() =>
      deserializeGameState(v6Json({ worldSize: boundsWorldSize, roads: buildRoads(200001) })),
    ).toThrow(/roads/);

    expect(() =>
      deserializeGameState(v6Json({ worldSize: boundsWorldSize, roads: buildRoads(200000) })),
    ).not.toThrow();
  }, 15000);

  it('道路蓋在水上也照樣讀得回來：地形是 seed 推導的，追溯拒收會讓合法舊檔變壞檔', () => {
    // (0,0) 是世界角落，baseTerrainAt 恆為 water（見 terrain.ts 的角落保證）。
    const state = createInitialState(1);
    state.roads['0,0'] = 1;

    expect(() => deserializeGameState(serializeGameState(state))).not.toThrow();
  });
});
