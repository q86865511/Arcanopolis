// R4：GameState 擴充 worldSeed/worldSize/terrainOverrides（src/core/world/state.ts）
// R6：存檔 v4（SAVE_SCHEMA_VERSION、SAVE_MIGRATIONS 的 from:3、deserializeGameState 新欄位驗證）
import { describe, expect, it } from 'vitest';
import { createInitialState, SAVE_SCHEMA_VERSION, type GameState } from '../../src/core/world/state';
import {
  serializeGameState,
  deserializeGameState,
  applyMigrations,
  SAVE_MIGRATIONS,
} from '../../src/core/save/save';
import { TERRAIN_GENERATOR_VERSION, terrainAt, type TerrainOverride } from '../../src/core/world/terrain';

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

describe('R6：存檔 v4——SAVE_SCHEMA_VERSION 與 SAVE_MIGRATIONS(from:3)', () => {
  it('SAVE_SCHEMA_VERSION = 4（M3.9：新增地形欄位升版）', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(4);
  });

  it('SAVE_MIGRATIONS 含 from:3 的遷移', () => {
    const migration = SAVE_MIGRATIONS.find((m) => m.from === 3);
    expect(migration).toBeDefined();
  });

  it('from:3 遷移：缺 worldSeed 時用 raw.rngState 補；缺 worldSize 時補 200；缺 terrainOverrides 時補 {}', () => {
    const migration = SAVE_MIGRATIONS.find((m) => m.from === 3)!;
    const raw = {
      schemaVersion: 3,
      tick: 1,
      rngState: 999,
      resources: {},
      buildings: [],
      citizens: [],
      pendingCommands: [],
    };

    const migrated = migration.migrate(raw) as Record<string, unknown>;

    expect(migrated.worldSeed).toBe(999);
    expect(migrated.worldSize).toBe(200);
    expect(migrated.terrainOverrides).toEqual({});
  });

  it('from:3 遷移：raw 缺 rngState（或非數值）時，worldSeed 退回固定值 1', () => {
    const migration = SAVE_MIGRATIONS.find((m) => m.from === 3)!;
    const rawNoRngState = {
      schemaVersion: 3,
      tick: 1,
      resources: {},
      buildings: [],
      citizens: [],
      pendingCommands: [],
    };
    const migratedA = migration.migrate(rawNoRngState) as Record<string, unknown>;
    expect(migratedA.worldSeed).toBe(1);

    const rawBadRngState = { ...rawNoRngState, rngState: 'not-a-number' };
    const migratedB = migration.migrate(rawBadRngState) as Record<string, unknown>;
    expect(migratedB.worldSeed).toBe(1);
  });

  it('from:3 遷移：raw 已有 worldSeed/worldSize/terrainOverrides 時一律保留原值，不覆蓋（比照 from:2 的「缺欄才補」慣例）', () => {
    const migration = SAVE_MIGRATIONS.find((m) => m.from === 3)!;
    const raw = {
      schemaVersion: 3,
      tick: 1,
      rngState: 999,
      resources: {},
      buildings: [],
      citizens: [],
      pendingCommands: [],
      worldSeed: 12345,
      worldSize: 500,
      terrainOverrides: { '1,1': { type: 'sand' } },
    };

    const migrated = migration.migrate(raw) as Record<string, unknown>;

    expect(migrated.worldSeed).toBe(12345);
    expect(migrated.worldSize).toBe(500);
    expect(migrated.terrainOverrides).toEqual({ '1,1': { type: 'sand' } });
  });

  it('端到端：手工構造 v3 存檔（無新欄位）→ 預設參數 deserialize 成功、schemaVersion===4、三個新欄位補上', () => {
    const v3 = {
      schemaVersion: 3,
      tick: 5,
      rngState: 777,
      resources: { wood: 10 },
      buildings: [],
      citizens: [],
      pendingCommands: [],
    };

    const restored = deserializeGameState(JSON.stringify(v3));

    expect(restored.schemaVersion).toBe(4);
    expect(restored.worldSeed).toBe(777);
    expect(restored.worldSize).toBe(200);
    expect(restored.terrainOverrides).toEqual({});
    expect(restored.tick).toBe(5);
    expect(restored.resources).toEqual({ wood: 10 });
  });

  it('deserializeGameState(v3json, []) → throw（版本落後且未提供遷移）', () => {
    const v3 = {
      schemaVersion: 3,
      tick: 0,
      rngState: 1,
      resources: {},
      buildings: [],
      citizens: [],
      pendingCommands: [],
    };
    expect(() => deserializeGameState(JSON.stringify(v3), [])).toThrow();
  });

  it('v1 舊存檔可鏈式遷移到 v4（1→2→3→4 全部套用）', () => {
    const v1 = {
      schemaVersion: 1,
      tick: 5,
      rngState: 12345,
      resources: { wood: 10 },
      buildings: [{ id: 'house@0,0#0', type: 'house', x: 0, y: 0 }],
      pendingCommands: [{ type: 'addResource', resource: 'wood', amount: 3 }],
    };

    const restored = deserializeGameState(JSON.stringify(v1));

    expect(restored.schemaVersion).toBe(4);
    expect(restored.citizens).toEqual([]);
    expect(restored.worldSeed).toBe(12345); // 補自 rngState
    expect(restored.worldSize).toBe(200);
    // C2：建築 (0,0) 是舊檔升版後的腳下保護對象——(0,0) 是世界角落，baseTerrainAt 恆為 water，
    // 若不補 grass override 這棟建築升版後就會站在海裡。
    expect(restored.terrainOverrides).toEqual({ '0,0': { type: 'grass' } });
    expect(restored.terrainGeneratorVersion).toBe(TERRAIN_GENERATOR_VERSION);
  });

  it('v2 舊存檔（已有 citizens，缺地形欄位）可遷移到 v4', () => {
    const v2 = {
      schemaVersion: 2,
      tick: 1,
      rngState: 42,
      resources: {},
      buildings: [],
      citizens: [{ id: 'c1', home: 'h1', job: null, x: 1, y: 1 }],
      pendingCommands: [],
    };

    const restored = deserializeGameState(JSON.stringify(v2));

    expect(restored.schemaVersion).toBe(4);
    expect(restored.citizens).toEqual([{ id: 'c1', home: 'h1', job: null, x: 1, y: 1 }]);
    expect(restored.worldSeed).toBe(42);
    expect(restored.worldSize).toBe(200);
    // C2：居民 (1,1) 的腳下保護，理由同上。
    expect(restored.terrainOverrides).toEqual({ '1,1': { type: 'grass' } });
  });

  it('deserializeGameState 對 schemaVersion===SAVE_SCHEMA_VERSION(4) 的存檔可正常 round-trip', () => {
    const state = createInitialState(9);
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    expect(restored).toEqual(state);
  });

  it('C1：from:3 遷移缺 terrainGeneratorVersion 時補目前的 TERRAIN_GENERATOR_VERSION', () => {
    const migration = SAVE_MIGRATIONS.find((m) => m.from === 3)!;
    const raw = {
      schemaVersion: 3,
      tick: 1,
      rngState: 999,
      resources: {},
      buildings: [],
      citizens: [],
      pendingCommands: [],
    };

    const migrated = migration.migrate(raw) as Record<string, unknown>;

    expect(migrated.terrainGeneratorVersion).toBe(TERRAIN_GENERATOR_VERSION);
  });

  it('C1：schemaVersion=4 但 terrainGeneratorVersion 大於程式目前支援版本 → throw（存檔的地形演算法版本比程式新）', () => {
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

  it('C2：手工 v3 檔含建築 (7,3) 與居民 (2.4, 8.6) → 遷移後 terrainAt 於 (7,3) 與 (2,9) 為 grass', () => {
    const v3 = {
      schemaVersion: 3,
      tick: 0,
      rngState: 1,
      resources: {},
      buildings: [{ id: 'b1', type: 'house', x: 7, y: 3 }],
      citizens: [{ id: 'c1', home: 'b1', job: null, x: 2.4, y: 8.6 }],
      pendingCommands: [],
    };

    const restored = deserializeGameState(JSON.stringify(v3));

    expect(terrainAt(restored, 7, 3)).toBe('grass');
    // Math.round(2.4)=2, Math.round(8.6)=9
    expect(terrainAt(restored, 2, 9)).toBe('grass');
  });

  it('C4：createInitialState(-1) 的 worldSeed 正規化為 4294967295，且可 serialize→deserialize', () => {
    const state = createInitialState(-1);
    expect(state.worldSeed).toBe(4294967295);
    const restored = deserializeGameState(serializeGameState(state));
    expect(restored.worldSeed).toBe(4294967295);
  });

  it('F1：serializeGameState 對 citizens 超過上限（100000）或 terrainOverrides 鍵數超過上限（200000）→ throw', () => {
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
