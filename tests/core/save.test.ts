// R1：GameState 擴充 schemaVersion + pendingCommands（src/core/world/state.ts）
// R2：pendingCommands 併入 state（src/core/sim/simulation.ts，取代 Simulation 私有佇列）
// R3：序列化 round-trip（src/core/save/save.ts）
// R4：deserializeGameState 驗證拒絕（src/core/save/save.ts）
// R5：遷移 registry（Migration + applyMigrations，src/core/save/save.ts）
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/core/sim/commands';
import type { GameState } from '../../src/core/world/state';
import { createInitialState, SAVE_SCHEMA_VERSION } from '../../src/core/world/state';
import { Simulation } from '../../src/core/sim/simulation';
import {
  serializeGameState,
  deserializeGameState,
  applyMigrations,
  type Migration,
} from '../../src/core/save/save';

describe('R1：GameState 擴充 schemaVersion + pendingCommands', () => {
  it('state.ts 匯出常數 SAVE_SCHEMA_VERSION = 4（M3.9：新增地形欄位升版）', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(4);
  });

  it('createInitialState 填入 schemaVersion 與空 pendingCommands', () => {
    const state = createInitialState(1);
    expect(state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(state.pendingCommands).toEqual([]);
  });

  it('仍為純資料：JSON round-trip 後與原 state 深相等（含新欄位）', () => {
    const state = createInitialState(1);
    const roundTripped = JSON.parse(JSON.stringify(state));
    expect(roundTripped).toEqual(state);
  });
});

describe('R2：pendingCommands 併入 state（Simulation 不再用私有佇列）', () => {
  it('enqueue 後、tick 前，指令即存在於 state.pendingCommands', () => {
    const state = createInitialState(1);
    const sim = new Simulation(state, []);
    const cmd: Command = { type: 'addResource', resource: 'wood', amount: 5 };

    sim.enqueue(cmd);

    expect(state.pendingCommands).toEqual([cmd]);
  });

  it('tick() 套用後 state.pendingCommands 清空（語義不變：批次取出即清空）', () => {
    const state = createInitialState(1);
    const sim = new Simulation(state, []);
    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 5 });

    sim.tick();

    expect(state.pendingCommands).toEqual([]);
  });

  it('存檔攜帶 pendingCommands：enqueue 兩道指令→尚未 tick 前 JSON round-trip→用快照建新 Simulation→tick→指令生效', () => {
    const state = createInitialState(1);
    state.resources.wood = 0;
    const sim = new Simulation(state, []);
    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 5 });
    sim.enqueue({ type: 'addResource', resource: 'wood', amount: 3 });

    const snapshot: GameState = JSON.parse(JSON.stringify(state));
    expect(snapshot.pendingCommands).toHaveLength(2);

    const resumed = new Simulation(snapshot, []);
    resumed.tick();

    expect(snapshot.resources.wood).toBe(8);
  });
});

describe('R3：序列化 round-trip（src/core/save/save.ts）', () => {
  it('serializeGameState 產出字串，deserializeGameState 還原後與原 state 深相等', () => {
    const state = createInitialState(1);
    state.resources.wood = 10;
    state.buildings.push({ id: 'b1', type: 'house', x: 1, y: 2 });
    state.pendingCommands.push({ type: 'addResource', resource: 'stone', amount: 2 });

    const json = serializeGameState(state);
    expect(typeof json).toBe('string');

    const restored = deserializeGameState(json);
    expect(restored).toEqual(state);
  });
});

describe('R4：deserializeGameState 驗證拒絕（訊息含欄位名）', () => {
  it('非法 JSON 字串 → throw', () => {
    expect(() => deserializeGameState('{not valid json')).toThrow();
  });

  it('缺 schemaVersion → throw 且訊息含欄位名', () => {
    const { schemaVersion, ...withoutVersion } = createInitialState(1) as GameState & { schemaVersion: number };
    expect(() => deserializeGameState(JSON.stringify(withoutVersion))).toThrow(/schemaVersion/);
  });

  it('schemaVersion 非正整數 → throw', () => {
    const base = createInitialState(1);
    expect(() => deserializeGameState(JSON.stringify({ ...base, schemaVersion: 0 }))).toThrow(/schemaVersion/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, schemaVersion: -1 }))).toThrow(/schemaVersion/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, schemaVersion: 1.5 }))).toThrow(/schemaVersion/);
  });

  it('schemaVersion 大於 SAVE_SCHEMA_VERSION → throw', () => {
    const base = createInitialState(1);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...base, schemaVersion: SAVE_SCHEMA_VERSION + 1 })),
    ).toThrow(/schemaVersion/);
  });

  it('tick 非非負整數 → throw 且訊息含欄位名', () => {
    const base = createInitialState(1);
    expect(() => deserializeGameState(JSON.stringify({ ...base, tick: -1 }))).toThrow(/tick/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, tick: 1.5 }))).toThrow(/tick/);
  });

  it('rngState 非有限數 → throw 且訊息含欄位名', () => {
    const base = createInitialState(1);
    expect(() => deserializeGameState(JSON.stringify({ ...base, rngState: Number.NaN }))).toThrow(/rngState/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, rngState: Infinity }))).toThrow(/rngState/);
  });

  it('rngState 非整數或超出 uint32 範圍 → throw（存檔標示須與實際重播狀態一致）', () => {
    const base = createInitialState(1);
    expect(() => deserializeGameState(JSON.stringify({ ...base, rngState: 1.5 }))).toThrow(/rngState/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, rngState: -1 }))).toThrow(/rngState/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, rngState: 0x1_0000_0000 }))).toThrow(/rngState/);
  });

  it('buildings 非陣列 → throw 且訊息含欄位名', () => {
    const base = createInitialState(1);
    expect(() => deserializeGameState(JSON.stringify({ ...base, buildings: {} }))).toThrow(/buildings 必須是陣列/);
  });

  it('buildings 元素非法（null/數字/缺欄/型別錯）→ throw 且訊息含欄位名', () => {
    const base = createInitialState(1);
    expect(() => deserializeGameState(JSON.stringify({ ...base, buildings: [null] }))).toThrow(/buildings/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, buildings: [42] }))).toThrow(/buildings/);
    expect(() => deserializeGameState(JSON.stringify({ ...base, buildings: [{ nope: 1 }] }))).toThrow(/buildings/);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...base, buildings: [{ id: 'a', type: 'farm', x: 0.5, y: 0 }] })),
    ).toThrow(/buildings/);
  });

  it('pendingCommands 非陣列 → throw 且訊息含欄位名', () => {
    const base = createInitialState(1);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...base, pendingCommands: {} })),
    ).toThrow(/pendingCommands 必須是陣列/);
  });

  it('pendingCommands 含未知 type 或缺 resource 的指令 → throw', () => {
    const base = createInitialState(1);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...base, pendingCommands: [{ type: 'nuke' }] })),
    ).toThrow();
    expect(() =>
      deserializeGameState(JSON.stringify({ ...base, pendingCommands: [{ type: 'addResource', amount: 7 }] })),
    ).toThrow(/resource/);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...base, pendingCommands: [null] })),
    ).toThrow(/指令必須是物件/);
  });

  it('resources 含非有限數值 → throw 且訊息含欄位名', () => {
    const base = createInitialState(1);
    expect(() =>
      deserializeGameState(JSON.stringify({ ...base, resources: { wood: Number.NaN } })),
    ).toThrow(/resources/);
  });

  it('pendingCommands 含非法指令（amount: NaN）→ throw', () => {
    const base = createInitialState(1);
    const raw = {
      ...base,
      pendingCommands: [{ type: 'addResource', resource: 'wood', amount: Number.NaN }],
    };
    expect(() => deserializeGameState(JSON.stringify(raw))).toThrow();
  });
});

describe('R5：遷移 registry（Migration + applyMigrations）', () => {
  it('applyMigrations 依序套用 from=fromVersion..toVersion-1 的遷移（fromVersion 1→3 兩步假資料變換）', () => {
    const migrations: Migration[] = [
      { from: 1, migrate: (raw) => ({ ...(raw as Record<string, unknown>), step1: true }) },
      { from: 2, migrate: (raw) => ({ ...(raw as Record<string, unknown>), step2: true }) },
    ];

    const result = applyMigrations({ x: 1 }, 1, 3, migrations) as Record<string, unknown>;

    expect(result.step1).toBe(true);
    expect(result.step2).toBe(true);
  });

  it('套用順序為由舊到新（from=1 的遷移先於 from=2 執行，後者可觀察到前者的輸出）', () => {
    const order: number[] = [];
    const migrations: Migration[] = [
      {
        from: 1,
        migrate: (raw) => {
          order.push(1);
          return raw;
        },
      },
      {
        from: 2,
        migrate: (raw) => {
          order.push(2);
          return raw;
        },
      },
    ];

    applyMigrations({}, 1, 3, migrations);

    expect(order).toEqual([1, 2]);
  });

  it('缺某一步（gap）→ throw', () => {
    const migrations: Migration[] = [
      { from: 1, migrate: (raw) => ({ ...(raw as Record<string, unknown>), step1: true }) },
      // from: 2 缺漏，fromVersion=1 到 toVersion=3 需要 from=1 與 from=2 兩步
    ];

    expect(() => applyMigrations({ x: 1 }, 1, 3, migrations)).toThrow();
  });

  it('fromVersion 等於 toVersion → 不執行任何遷移，原樣回傳', () => {
    const migrations: Migration[] = [];
    const raw = { x: 1 };

    const result = applyMigrations(raw, 2, 2, migrations);

    expect(result).toEqual({ x: 1 });
  });

  it('deserializeGameState 對 schemaVersion 等於 SAVE_SCHEMA_VERSION 的存檔：migrations 參數（預設空陣列）不影響還原', () => {
    const state = createInitialState(1);
    const json = serializeGameState(state);

    const restored = deserializeGameState(json, []);

    expect(restored).toEqual(state);
  });
});

describe('M3：schema v2 遷移（SAVE_MIGRATIONS，真實舊版 v1 存檔端到端）', () => {
  /** 手工構造的合法 v1 存檔（schemaVersion:1，含一筆 pending addResource 指令）。 */
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

  it('(a) 預設參數 deserialize v1 存檔成功：schemaVersion 升為目前版本、資料完整保留', () => {
    const restored = deserializeGameState(v1SaveJson());

    expect(restored.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(restored.tick).toBe(5);
    expect(restored.rngState).toBe(12345);
    expect(restored.resources).toEqual({ wood: 10 });
    expect(restored.buildings).toEqual([{ id: 'house@0,0#0', type: 'house', x: 0, y: 0 }]);
    expect(restored.pendingCommands).toEqual([{ type: 'addResource', resource: 'wood', amount: 3 }]);
  });

  it('(b) 同一 v1 JSON 以 deserializeGameState(json, []) 呼叫 → throw（版本落後且無對應遷移）', () => {
    expect(() => deserializeGameState(v1SaveJson(), [])).toThrow();
  });

  it('(c) v1 存檔還原後可用 Simulation 續跑，且還原出的 pending 指令於下一 tick 生效', () => {
    const restored = deserializeGameState(v1SaveJson());
    const sim = new Simulation(restored, []);

    sim.tick();

    expect(restored.resources.wood).toBe(13); // 10 + pending 的 addResource wood:3
    expect(restored.tick).toBe(6);
  });
});
