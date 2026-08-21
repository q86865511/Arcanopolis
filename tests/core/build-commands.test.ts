// M2-T2：core 建築擺放/拆除指令
// R1：指令型別擴充（src/core/sim/commands.ts）— PlaceBuildingCommand / RemoveBuildingCommand 併入 Command 聯集
//     （型別本身無執行期存在，於編譯期由 tsc 檢查；本檔以 R2/R5/R6/R8 的執行期行為間接驗證）
// R2：validateCommand 擴充（src/core/sim/commands.ts）
// R3：defs 注入（src/core/sim/simulation.ts）— new Simulation(state, systems, defs?)
// R4：佔格工具（src/core/world/occupancy.ts）— footprintTiles / isAreaFree
// R5：placeBuilding 語義（tick 套用時）
// R6：removeBuilding 語義
// R7：決定論與存檔 round-trip
// R8：applyCommand 窮盡守衛（未知指令型別 throw）
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/core/sim/commands';
import { applyCommand, validateCommand } from '../../src/core/sim/commands';
import { createInitialState, getResource } from '../../src/core/world/state';
import { Simulation } from '../../src/core/sim/simulation';
import { footprintTiles, isAreaFree } from '../../src/core/world/occupancy';
import { serializeGameState, deserializeGameState } from '../../src/core/save/save';
import type { BuildingDef } from '../../src/data/types';

// 精簡 fixture defs：不依賴 data/*.json，涵蓋單資源成本、多資源成本、非 1×1 佔地
const houseDef: BuildingDef = { id: 'house', name: '房屋', size: { w: 1, h: 1 }, cost: { wood: 15 }, production: {} };
const tavernDef: BuildingDef = { id: 'tavern', name: '酒館', size: { w: 2, h: 2 }, cost: { wood: 5 }, production: {} };
const barracksDef: BuildingDef = {
  id: 'barracks',
  name: '兵營',
  size: { w: 1, h: 1 },
  cost: { wood: 10, stone: 5 },
  production: {},
};
const defs: BuildingDef[] = [houseDef, tavernDef, barracksDef];

describe('R2：validateCommand 擴充', () => {
  it('placeBuilding 合法指令不 throw', () => {
    expect(() => validateCommand({ type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 })).not.toThrow();
  });

  it('placeBuilding buildingType 非空字串以外 → throw 且訊息含 buildingType', () => {
    expect(() =>
      validateCommand({ type: 'placeBuilding', buildingType: '', x: 0, y: 0 } as Command),
    ).toThrow(/buildingType/);
    expect(() =>
      validateCommand({ type: 'placeBuilding', buildingType: 123, x: 0, y: 0 } as unknown as Command),
    ).toThrow(/buildingType/);
  });

  it('placeBuilding x/y 非整數 → throw 且訊息含欄位名', () => {
    expect(() =>
      validateCommand({ type: 'placeBuilding', buildingType: 'house', x: 1.5, y: 0 } as Command),
    ).toThrow(/x/);
    expect(() =>
      validateCommand({ type: 'placeBuilding', buildingType: 'house', x: 0, y: 'a' } as unknown as Command),
    ).toThrow(/y/);
  });

  it('removeBuilding 合法指令不 throw', () => {
    expect(() => validateCommand({ type: 'removeBuilding', buildingId: 'house@0,0' })).not.toThrow();
  });

  it('removeBuilding buildingId 非空字串以外 → throw 且訊息含 buildingId', () => {
    expect(() => validateCommand({ type: 'removeBuilding', buildingId: '' } as Command)).toThrow(/buildingId/);
    expect(() =>
      validateCommand({ type: 'removeBuilding', buildingId: 123 } as unknown as Command),
    ).toThrow(/buildingId/);
  });

  it('未知 type 仍 throw（回歸）', () => {
    expect(() => validateCommand({ type: 'bogus' } as unknown as Command)).toThrow();
  });
});

describe('R3：defs 注入（Simulation 第三參數，選填，預設空）', () => {
  it('既有兩參數呼叫不受影響（回歸）：無 defs 時 placeBuilding 視為未知型別，靜默跳過', () => {
    const state = createInitialState(1);
    state.resources.wood = 100;
    const sim = new Simulation(state, []); // 兩參數呼叫，未注入 defs

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([]);
    expect(state.resources.wood).toBe(100);
  });
});

describe('R4：佔格工具（src/core/world/occupancy.ts）', () => {
  it('footprintTiles(x,y,w,h) 回傳 w×h 格清單', () => {
    const tiles = footprintTiles(2, 3, 2, 2);
    const asSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
    expect(asSet).toEqual(new Set(['2,3', '3,3', '2,4', '3,4']));
    expect(tiles).toHaveLength(4);
  });

  it('footprintTiles(x,y,1,1) 回傳單一格', () => {
    expect(footprintTiles(0, 0, 1, 1)).toEqual([{ x: 0, y: 0 }]);
  });

  it('isAreaFree：空地圖上任何範圍皆自由', () => {
    const state = createInitialState(1);
    expect(isAreaFree(state, footprintTiles(0, 0, 2, 2), defs)).toBe(true);
  });

  it('isAreaFree：與既有建築 footprint 有交集則不自由', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'house@2,2', type: 'house', x: 2, y: 2 });

    expect(isAreaFree(state, footprintTiles(2, 2, 1, 1), defs)).toBe(false);
    // 2x2 範圍從 (1,1) 起會覆蓋到 (2,2)
    expect(isAreaFree(state, footprintTiles(1, 1, 2, 2), defs)).toBe(false);
  });

  it('isAreaFree：不重疊範圍為自由', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'house@2,2', type: 'house', x: 2, y: 2 });

    expect(isAreaFree(state, footprintTiles(10, 10, 2, 2), defs)).toBe(true);
  });

  it('既有建築 type 不在 defs（資料表與存檔漂移）→ isAreaFree 以 1×1 佔格 fallback，不誤判成更大範圍', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'ghost@2,2#0', type: 'ghost-type', x: 2, y: 2 });

    // fallback 1×1：只佔 (2,2)，鄰格 (3,2) 仍自由
    expect(isAreaFree(state, footprintTiles(2, 2, 1, 1), defs)).toBe(false);
    expect(isAreaFree(state, footprintTiles(3, 2, 1, 1), defs)).toBe(true);
  });
});

describe('R5：placeBuilding 語義（tick 套用時）', () => {
  it('buildingType 不存在於 defs → 靜默跳過，state 不變、不 throw', () => {
    const state = createInitialState(1);
    state.resources.wood = 100;
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'castle', x: 0, y: 0 } as Command);
    expect(() => sim.tick()).not.toThrow();

    expect(state.buildings).toEqual([]);
    expect(state.resources.wood).toBe(100);
  });

  it('footprint 與既有建築重疊 → 跳過，state 不變', () => {
    const state = createInitialState(1);
    state.resources.wood = 100;
    state.buildings.push({ id: 'house@2,2', type: 'house', x: 2, y: 2 });
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 2, y: 2 } as Command);
    sim.tick();

    expect(state.buildings).toHaveLength(1);
    expect(state.resources.wood).toBe(100);
  });

  it('cost 資源不足（單一資源）→ 跳過，state 不變', () => {
    const state = createInitialState(1);
    state.resources.wood = 10; // house 需要 15
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([]);
    expect(state.resources.wood).toBe(10);
  });

  it('cost 資源不足（多資源成本，僅其中一項不足）→ 整筆跳過，不部分扣款', () => {
    const state = createInitialState(1);
    state.resources.wood = 20; // barracks 需要 wood:10, stone:5
    state.resources.stone = 0;
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'barracks', x: 5, y: 5 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([]);
    expect(state.resources.wood).toBe(20);
    expect(getResource(state, 'stone')).toBe(0);
  });

  it('三關全過（型別存在、無重疊、資源足夠）→ 逐項扣 cost、append Building', () => {
    const state = createInitialState(1);
    state.resources.wood = 20;
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 3, y: 4 } as Command);
    sim.tick();

    expect(state.resources.wood).toBe(5);
    expect(state.buildings).toEqual([{ id: 'house@3,4#0', type: 'house', x: 3, y: 4 }]);
  });

  it('多資源成本成功路徑：逐項扣除所有 cost 資源', () => {
    const state = createInitialState(1);
    state.resources.wood = 20;
    state.resources.stone = 10;
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'barracks', x: 1, y: 1 } as Command);
    sim.tick();

    expect(getResource(state, 'wood')).toBe(10);
    expect(getResource(state, 'stone')).toBe(5);
    expect(state.buildings).toEqual([{ id: 'barracks@1,1#0', type: 'barracks', x: 1, y: 1 }]);
  });

  it('資源剛好等於成本（getResource === cost）→ 仍可成功建造，不因邊界被拒', () => {
    const state = createInitialState(1);
    state.resources.wood = 15; // house 成本恰為 15
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 } as Command);
    sim.tick();

    expect(state.resources.wood).toBe(0);
    expect(state.buildings).toEqual([{ id: 'house@0,0#0', type: 'house', x: 0, y: 0 }]);
  });
});

describe('R6：removeBuilding 語義', () => {
  it('依 id 找到 → 移除該棟，不退款', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'house@0,0', type: 'house', x: 0, y: 0 });
    state.resources.wood = 5;
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'removeBuilding', buildingId: 'house@0,0' } as Command);
    sim.tick();

    expect(state.buildings).toEqual([]);
    expect(state.resources.wood).toBe(5);
  });

  it('找不到 id → 靜默跳過，不 throw、state 不變', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'house@0,0', type: 'house', x: 0, y: 0 });
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'removeBuilding', buildingId: 'no-such-id' } as Command);
    expect(() => sim.tick()).not.toThrow();

    expect(state.buildings).toHaveLength(1);
  });
});

describe('R7：決定論與存檔', () => {
  function buildSim(seed: number): { sim: Simulation; state: ReturnType<typeof createInitialState> } {
    const state = createInitialState(seed);
    state.resources.wood = 100;
    state.resources.stone = 100;
    const sim = new Simulation(state, [], defs);
    return { sim, state };
  }

  it('同 seed + 同指令序列（含 place/remove）→ 兩個獨立 Simulation run 後 state 深相等', () => {
    const a = buildSim(555);
    const b = buildSim(555);

    const sequence: Command[] = [
      { type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 } as Command,
      { type: 'placeBuilding', buildingType: 'tavern', x: 5, y: 5 } as Command,
      // 四筆指令都在 enqueue 後、尚未 tick 前送出，會於第一個 tick（tick=0）同批套用，
      // 故 house 的 id 帶 #0 後綴（見 M2：id 帶入套用當下的 state.tick）。
      { type: 'removeBuilding', buildingId: 'house@0,0#0' } as Command,
      { type: 'placeBuilding', buildingType: 'barracks', x: 8, y: 8 } as Command,
    ];

    for (const cmd of sequence) {
      a.sim.enqueue(cmd);
      b.sim.enqueue(cmd);
    }
    a.sim.run(10);
    b.sim.run(10);

    expect(a.state).toEqual(b.state);
  });

  it('pendingCommands 含新指令型別時 serialize/deserialize round-trip 成功', () => {
    const state = createInitialState(1);
    state.pendingCommands.push({ type: 'placeBuilding', buildingType: 'house', x: 1, y: 1 } as Command);
    state.pendingCommands.push({ type: 'removeBuilding', buildingId: 'house@1,1' } as Command);

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);

    expect(restored.pendingCommands).toEqual(state.pendingCommands);
  });

  it('非法新指令（placeBuilding 缺 buildingType）在存檔還原時被拒', () => {
    const state = createInitialState(1);
    state.pendingCommands.push({ type: 'placeBuilding', x: 1, y: 1 } as unknown as Command);

    const json = serializeGameState(state);
    expect(() => deserializeGameState(json)).toThrow();
  });
});

describe('R8：applyCommand 窮盡守衛', () => {
  it('未知（強制轉型）指令型別 → applyCommand throw 而非靜默', () => {
    const state = createInitialState(1);
    const bogus = { type: 'bogus' } as unknown as Command;

    expect(() => applyCommand(state, bogus)).toThrow();
  });
});

describe('M2：id 帶 #tick 防 ABA（place→tick→remove→tick→place 同格→tick）', () => {
  it('兩次放置同格的 id 不同；重蓋後回放舊 id 的 removeBuilding 不會刪到新棟', () => {
    const state = createInitialState(1);
    state.resources.wood = 100;
    const sim = new Simulation(state, [], defs);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 } as Command);
    sim.tick(); // tick 0：套用時 state.tick 為 0 → id 帶 #0
    const firstId = state.buildings[0]?.id;
    expect(firstId).toBe('house@0,0#0');

    sim.enqueue({ type: 'removeBuilding', buildingId: firstId! } as Command);
    sim.tick(); // tick 1：拆除成功
    expect(state.buildings).toEqual([]);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 0, y: 0 } as Command);
    sim.tick(); // tick 2：套用時 state.tick 為 2 → id 帶 #2，與第一次不同
    const secondId = state.buildings[0]?.id;
    expect(secondId).toBe('house@0,0#2');
    expect(secondId).not.toBe(firstId);

    // 模擬「舊 id 的 removeBuilding 在重蓋後回放」：enqueue 第一次那筆已過期的 remove 指令
    sim.enqueue({ type: 'removeBuilding', buildingId: firstId! } as Command);
    sim.tick(); // tick 3：找不到 firstId（新棟 id 是 secondId）→ 靜默跳過，新棟仍在
    expect(state.buildings).toEqual([{ id: secondId, type: 'house', x: 0, y: 0 }]);
  });
});

describe('M1：邊界驗證（validateCommand 座標/長度上限）', () => {
  it('placeBuilding x 絕對值超過 1,000,000 → throw', () => {
    expect(() => validateCommand({ type: 'placeBuilding', buildingType: 'house', x: 1e15, y: 0 } as Command)).toThrow(
      /x/,
    );
  });

  it('placeBuilding buildingType 超過 64 字元 → throw；經 deserializeGameState 路徑（pendingCommands）也同樣被拒', () => {
    const overlongType = 'a'.repeat(65);
    expect(() =>
      validateCommand({ type: 'placeBuilding', buildingType: overlongType, x: 0, y: 0 } as Command),
    ).toThrow(/buildingType/);

    const base = createInitialState(1);
    base.pendingCommands.push({ type: 'placeBuilding', buildingType: overlongType, x: 0, y: 0 } as unknown as Command);
    expect(() => deserializeGameState(JSON.stringify(base))).toThrow(/buildingType/);
  });
});
