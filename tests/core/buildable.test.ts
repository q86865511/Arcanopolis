// M3.9-W2：地形綁定生產與資源耗竭再生 —— 可建性判定與 placeBuilding 地形檢查
//
// R1：BuildingDef.terrain 欄位擴充與 loader 驗證（src/data/types.ts＋src/data/loader.ts）
//     terrain?: { on?: TerrainType[]; near?: TerrainType[]; consumes?: TerrainType[] }；省略視為無限制；
//     值非法（非陣列、空陣列、未知地形 id、未知鍵）一律 throw 且訊息含建築 id。
// R2：canBuildAt（新檔 src/core/world/buildable.ts）——純函數可建性判定：
//     (a) 佔格全部在世界範圍內 (b) 每格 isBuildable (c) terrain.on：每格皆須在清單內
//     (d) terrain.near：四方鄰接格（不含斜角，越界視為 water）至少一格在清單內
//     (e) 佔格不與既有建築重疊（isAreaFree）。
// R3：placeBuilding 接上地形檢查（src/core/sim/commands.ts）——canBuildAt 為假時第四關
//     靜默跳過（不扣款、不新增建築），既有三關語義不得退步。
//
// 本檔一律用 terrainOverrides 手動塞地形，不依賴 seed 的程序生成結果（見派工簡報約束）。
import { describe, expect, it } from 'vitest';
import { parseBuildingDefs } from '../../src/data/loader';
import type { BuildingDef } from '../../src/data/types';
import type { TerrainType, TerrainOverride } from '../../src/core/world/terrain';
import { canBuildAt } from '../../src/core/world/buildable';
import { createInitialState } from '../../src/core/world/state';
import type { GameState } from '../../src/core/world/state';
import { applyCommand, type Command } from '../../src/core/sim/commands';
import { Simulation } from '../../src/core/sim/simulation';
import { getResource } from '../../src/core/world/state';

// ── R1：loader 驗證 ─────────────────────────────────────────────────────────

const resourceIds = new Set(['wood', 'stone', 'food', 'gold']);

function baseDef(): Record<string, unknown> {
  return {
    id: 'lumber-camp',
    name: '伐木場',
    size: { w: 1, h: 1 },
    cost: { wood: 10 },
    production: { wood: 2 },
  };
}

describe('R1：BuildingDef.terrain 欄位與 parseBuildingDefs 驗證', () => {
  it('terrain 欄位省略時不影響驗證，回傳的 def.terrain 為 undefined', () => {
    expect(() => parseBuildingDefs([baseDef()], resourceIds)).not.toThrow();
    const [def] = parseBuildingDefs([baseDef()], resourceIds);
    expect((def as BuildingDef & { terrain?: unknown }).terrain).toBeUndefined();
  });

  it('terrain.on 為合法地形陣列時通過驗證，且原樣保留在回傳的 def 中', () => {
    const input = { ...baseDef(), terrain: { on: ['grass', 'sand'] } };
    const [def] = parseBuildingDefs([input], resourceIds);
    expect((def as BuildingDef & { terrain?: unknown }).terrain).toEqual({ on: ['grass', 'sand'] });
  });

  it('terrain.near 為合法地形陣列時通過驗證，且原樣保留在回傳的 def 中', () => {
    const input = { ...baseDef(), terrain: { near: ['forest'] } };
    const [def] = parseBuildingDefs([input], resourceIds);
    expect((def as BuildingDef & { terrain?: unknown }).terrain).toEqual({ near: ['forest'] });
  });

  it('terrain 同時有 on 與 near 皆合法時，兩者都保留', () => {
    const input = { ...baseDef(), terrain: { on: ['rock'], near: ['forest'] } };
    const [def] = parseBuildingDefs([input], resourceIds);
    expect((def as BuildingDef & { terrain?: unknown }).terrain).toEqual({ on: ['rock'], near: ['forest'] });
  });

  it('terrain.consumes 為合法地形陣列時通過驗證，且原樣保留在回傳的 def 中', () => {
    const input = { ...baseDef(), terrain: { near: ['forest'], consumes: ['forest'] } };
    const [def] = parseBuildingDefs([input], resourceIds);
    expect(def.terrain).toEqual({ near: ['forest'], consumes: ['forest'] });
  });

  it('terrain 非物件（字串/陣列/數字）→ throw 且訊息含建築 id', () => {
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: 'forest' }], resourceIds)).toThrow(/lumber-camp/);
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: ['forest'] }], resourceIds)).toThrow(/lumber-camp/);
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: 5 }], resourceIds)).toThrow(/lumber-camp/);
  });

  it('terrain.on 非陣列 → throw', () => {
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { on: 'forest' } }], resourceIds)).toThrow(
      /lumber-camp/,
    );
  });

  it('terrain.on 為空陣列 → throw', () => {
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { on: [] } }], resourceIds)).toThrow(/lumber-camp/);
  });

  it('terrain.on 含未知地形 id → throw', () => {
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { on: ['lava'] } }], resourceIds)).toThrow(
      /lumber-camp/,
    );
  });

  it('terrain.near 非陣列／空陣列／含未知地形 id → 分別 throw', () => {
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { near: 'forest' } }], resourceIds)).toThrow(
      /lumber-camp/,
    );
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { near: [] } }], resourceIds)).toThrow(/lumber-camp/);
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { near: ['lava'] } }], resourceIds)).toThrow(
      /lumber-camp/,
    );
  });

  it('terrain.consumes 非陣列／空陣列／含未知地形 id → 分別 throw', () => {
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { consumes: 'forest' } }], resourceIds)).toThrow(
      /lumber-camp/,
    );
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { consumes: [] } }], resourceIds)).toThrow(
      /lumber-camp/,
    );
    expect(() => parseBuildingDefs([{ ...baseDef(), terrain: { consumes: ['lava'] } }], resourceIds)).toThrow(
      /lumber-camp/,
    );
  });

  it('terrain 物件含未知鍵（非 on/near/consumes）→ throw 且訊息含該欄位名', () => {
    expect(() =>
      parseBuildingDefs([{ ...baseDef(), terrain: { on: ['grass'], extra: 1 } }], resourceIds),
    ).toThrow(/extra/);
  });
});

// ── R2：canBuildAt ───────────────────────────────────────────────────────────

function makeState(worldSize = 50): GameState {
  const state = createInitialState(1);
  state.worldSize = worldSize;
  return state;
}

function setTerrain(state: GameState, x: number, y: number, type: TerrainType): void {
  (state.terrainOverrides as Record<string, TerrainOverride>)[`${x},${y}`] = { type };
}

function def(
  overrides: Partial<BuildingDef> & {
    terrain?: { on?: TerrainType[]; near?: TerrainType[]; consumes?: TerrainType[] };
  },
): BuildingDef {
  return {
    id: 'test-def',
    name: '測試建築',
    size: { w: 1, h: 1 },
    cost: {},
    production: {},
    housing: 0,
    jobs: 0,
    ...overrides,
  } as BuildingDef;
}

describe('R2：canBuildAt（src/core/world/buildable.ts）', () => {
  it('無 terrain 欄位的建築：地形為 buildable（grass）時可建', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'grass');
    const plain = def({ id: 'house' });
    expect(canBuildAt(state, plain, 5, 5, [])).toBe(true);
  });

  it('無 terrain 欄位的建築：地形不可通行（water/mountain）時不可建', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'water');
    const plain = def({ id: 'house' });
    expect(canBuildAt(state, plain, 5, 5, [])).toBe(false);

    setTerrain(state, 6, 6, 'mountain');
    expect(canBuildAt(state, plain, 6, 6, [])).toBe(false);
  });

  it('佔格超出世界範圍（負座標）→ false', () => {
    const state = makeState(10);
    setTerrain(state, 0, 0, 'grass');
    const plain = def({ id: 'house' });
    expect(canBuildAt(state, plain, -1, 0, [])).toBe(false);
    expect(canBuildAt(state, plain, 0, -1, [])).toBe(false);
  });

  it('佔格超出世界範圍（≥worldSize，含多格 footprint 部分越界）→ false', () => {
    const state = makeState(10);
    for (const [x, y] of [
      [9, 9],
      [10, 9],
      [9, 10],
      [10, 10],
    ] as const) {
      setTerrain(state, x, y, 'grass');
    }
    const single = def({ id: 'house', size: { w: 1, h: 1 } });
    expect(canBuildAt(state, single, 9, 9, [])).toBe(true); // 單格恰好在界內
    expect(canBuildAt(state, single, 10, 9, [])).toBe(false); // x=10 越界

    const big2x2 = def({ id: 'tavern', size: { w: 2, h: 2 } });
    // 佔格 (9,9)(10,9)(9,10)(10,10)：後三格皆越界
    expect(canBuildAt(state, big2x2, 9, 9, [])).toBe(false);
  });

  it('terrain.on：單格建築地形須在清單內', () => {
    const state = makeState();
    setTerrain(state, 1, 1, 'grass');
    setTerrain(state, 2, 2, 'sand');
    const farm = def({ id: 'farm', terrain: { on: ['grass'] } });
    expect(canBuildAt(state, farm, 1, 1, [])).toBe(true);
    expect(canBuildAt(state, farm, 2, 2, [])).toBe(false);
  });

  it('terrain.on：多格建築（2×2）每一格都須在清單內，任一格不符即 false', () => {
    const state = makeState();
    setTerrain(state, 3, 3, 'rock');
    setTerrain(state, 4, 3, 'rock');
    setTerrain(state, 3, 4, 'rock');
    setTerrain(state, 4, 4, 'rock');
    const quarry = def({ id: 'quarry', size: { w: 2, h: 2 }, terrain: { on: ['rock'] } });
    expect(canBuildAt(state, quarry, 3, 3, [])).toBe(true);

    setTerrain(state, 4, 4, 'grass'); // 破壞其中一格
    expect(canBuildAt(state, quarry, 3, 3, [])).toBe(false);
  });

  it('terrain.near：四方鄰接格（上下左右）至少一格在清單內即可，佔格本身只受 isBuildable 限制', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'grass'); // 佔格本身
    setTerrain(state, 5, 4, 'grass'); // 北
    setTerrain(state, 6, 5, 'forest'); // 東 —— 符合
    setTerrain(state, 5, 6, 'grass'); // 南
    setTerrain(state, 4, 5, 'grass'); // 西
    const lumberCamp = def({ id: 'lumber-camp', terrain: { near: ['forest'] } });
    expect(canBuildAt(state, lumberCamp, 5, 5, [])).toBe(true);
  });

  it('terrain.near：四鄰接格皆不符 → false', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'grass');
    setTerrain(state, 5, 4, 'grass');
    setTerrain(state, 6, 5, 'grass');
    setTerrain(state, 5, 6, 'grass');
    setTerrain(state, 4, 5, 'grass');
    const lumberCamp = def({ id: 'lumber-camp', terrain: { near: ['forest'] } });
    expect(canBuildAt(state, lumberCamp, 5, 5, [])).toBe(false);
  });

  it('terrain.near：只有斜角鄰居符合不算數（不含斜角）', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'grass');
    setTerrain(state, 5, 4, 'grass'); // 北
    setTerrain(state, 6, 5, 'grass'); // 東
    setTerrain(state, 5, 6, 'grass'); // 南
    setTerrain(state, 4, 5, 'grass'); // 西
    setTerrain(state, 6, 6, 'forest'); // 東南斜角——不應被計入
    const lumberCamp = def({ id: 'lumber-camp', terrain: { near: ['forest'] } });
    expect(canBuildAt(state, lumberCamp, 5, 5, [])).toBe(false);
  });

  it('terrain.near：鄰接格可越界，越界視為 water（不會意外符合清單，除非清單含 water）', () => {
    const state = makeState(10);
    setTerrain(state, 0, 0, 'grass'); // 佔格（角落）
    setTerrain(state, 1, 0, 'grass'); // 東
    setTerrain(state, 0, 1, 'grass'); // 南
    // 北 (0,-1) 與西 (-1,0) 越界，無法設定 override，視為 water

    const lumberCamp = def({ id: 'lumber-camp', terrain: { near: ['forest'] } });
    expect(canBuildAt(state, lumberCamp, 0, 0, [])).toBe(false); // 沒有任何鄰格是 forest

    const harbor = def({ id: 'harbor', terrain: { near: ['water'] } });
    expect(canBuildAt(state, harbor, 0, 0, [])).toBe(true); // 越界鄰格視為 water，符合 near:['water']
  });

  it('terrain.on 與 terrain.near 同時指定時，兩者皆須滿足', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'rock');
    setTerrain(state, 5, 4, 'forest');
    setTerrain(state, 6, 5, 'grass');
    setTerrain(state, 5, 6, 'grass');
    setTerrain(state, 4, 5, 'grass');
    const both = def({ id: 'mixed', terrain: { on: ['rock'], near: ['forest'] } });
    expect(canBuildAt(state, both, 5, 5, [])).toBe(true);

    setTerrain(state, 5, 5, 'grass'); // on 條件破壞
    expect(canBuildAt(state, both, 5, 5, [])).toBe(false);
  });

  it('terrain.consumes 只影響生產，不增加任何擺放條件', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'grass');
    for (const [x, y] of [[5, 4], [6, 5], [5, 6], [4, 5]] as const) {
      setTerrain(state, x, y, 'grass');
    }
    const consumer = def({ id: 'consumer', terrain: { on: ['grass'], consumes: ['forest'] } });

    expect(canBuildAt(state, consumer, 5, 5, [])).toBe(true);
  });

  it('與既有建築重疊 → false，即使地形條件全部滿足', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'grass');
    state.buildings.push({ id: 'existing@5,5', type: 'farm', x: 5, y: 5 });
    const farm = def({ id: 'farm', terrain: { on: ['grass'] } });
    const defs = [farm];
    expect(canBuildAt(state, farm, 5, 5, defs)).toBe(false);
  });

  it('純函數：不修改 state，重複呼叫結果相同', () => {
    const state = makeState();
    setTerrain(state, 5, 5, 'grass');
    setTerrain(state, 6, 5, 'forest');
    const lumberCamp = def({ id: 'lumber-camp', terrain: { near: ['forest'] } });
    const before = JSON.stringify(state);

    const first = canBuildAt(state, lumberCamp, 5, 5, []);
    const second = canBuildAt(state, lumberCamp, 5, 5, []);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ── R3：placeBuilding 接上地形檢查 ─────────────────────────────────────────────

describe('R3：placeBuilding 語義擴充（canBuildAt 為第四關）', () => {
  function farmDef(): BuildingDef {
    return def({ id: 'farm', cost: { wood: 5 }, terrain: { on: ['grass'] } });
  }
  function plainHouseDef(): BuildingDef {
    return def({ id: 'house', cost: { wood: 5 } }); // 無 terrain 欄位
  }

  it('地形不符（terrain.on 不含該格地形）→ 靜默跳過，不扣款、不新增建築', () => {
    const state = makeState();
    setTerrain(state, 0, 0, 'sand'); // farm 只允許 grass
    state.resources.wood = 100;
    const sim = new Simulation(state, [], [farmDef()]);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'farm', x: 0, y: 0 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([]);
    expect(state.resources.wood).toBe(100);
  });

  it('地形符合，其餘三關也過 → 正常建造、逐項扣 cost', () => {
    const state = makeState();
    setTerrain(state, 0, 0, 'grass');
    state.resources.wood = 100;
    const sim = new Simulation(state, [], [farmDef()]);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'farm', x: 0, y: 0 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([{ id: 'farm@0,0#0', type: 'farm', x: 0, y: 0 }]);
    expect(state.resources.wood).toBe(95);
  });

  it('地形符合但資源不足 → 仍照舊跳過（既有語義不受影響）', () => {
    const state = makeState();
    setTerrain(state, 0, 0, 'grass');
    state.resources.wood = 0;
    const sim = new Simulation(state, [], [farmDef()]);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'farm', x: 0, y: 0 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([]);
  });

  it('地形符合但與既有建築重疊 → 仍照舊跳過', () => {
    const state = makeState();
    setTerrain(state, 0, 0, 'grass');
    state.resources.wood = 100;
    state.buildings.push({ id: 'existing@0,0', type: 'farm', x: 0, y: 0 });
    const sim = new Simulation(state, [], [farmDef()]);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'farm', x: 0, y: 0 } as Command);
    sim.tick();

    expect(state.buildings).toHaveLength(1);
    expect(state.resources.wood).toBe(100);
  });

  it('無 terrain 欄位的建築：地形為 buildable（grass）時仍可正常建造（回歸）', () => {
    const state = makeState();
    setTerrain(state, 1, 1, 'grass');
    state.resources.wood = 100;
    const sim = new Simulation(state, [], [plainHouseDef()]);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 1, y: 1 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([{ id: 'house@1,1#0', type: 'house', x: 1, y: 1 }]);
  });

  it('無 terrain 欄位的建築：地形不可通行（water）時仍不可建（isBuildable 基礎檢查對所有建築生效）', () => {
    const state = makeState();
    setTerrain(state, 1, 1, 'water');
    state.resources.wood = 100;
    const sim = new Simulation(state, [], [plainHouseDef()]);

    sim.enqueue({ type: 'placeBuilding', buildingType: 'house', x: 1, y: 1 } as Command);
    sim.tick();

    expect(state.buildings).toEqual([]);
  });

  it('applyCommand 直接呼叫（非經 Simulation）同樣受地形第四關把關', () => {
    const state = makeState();
    setTerrain(state, 2, 2, 'sand');
    state.resources.wood = 100;

    applyCommand(state, { type: 'placeBuilding', buildingType: 'farm', x: 2, y: 2 } as Command, [farmDef()]);

    expect(state.buildings).toEqual([]);
    expect(getResource(state, 'wood')).toBe(100);
  });
});
