// M3.9-W2：地形綁定生產與資源耗竭再生
//
// R4：地形資源儲量（src/core/world/terrain.ts 擴充）
//     FOREST_WOOD_CAPACITY / ROCK_STONE_CAPACITY（正整數常數，匯出）
//     terrainResourceCapacity(type,economy)：forest/rock 回注入容量，其餘回 0
//     getTerrainResource(state,x,y,economy)：有 override.resource 用之，否則回注入設定的地形容量
//     consumeTerrainResource(state,x,y,amount,economy)：扣除並回傳實際扣到的量；扣到 0 時該格 override.type 設為
//     'grass'（保留 resource:0）——森林砍光/礦脈挖盡都變草地
// R5：production system 擴充——terrain.consumes 的建築，產出時從地形來源格扣等量資源；
//     實際產出量 = min(名目產出×在職率, 可扣到的地形資源量)；來源枯竭→產出 0（不 throw）。
//     'near' 的鄰格掃描順序鎖定為 北→東→南→西（與 src/core/systems/movement.ts 的
//     STEP_OFFSETS 慣例一致），每 tick 重新掃描（某鄰格耗盡後自動改採下一個符合清單且仍有存量者）。
// R6：森林再生（新 system src/core/systems/regrowth.ts 的 createRegrowthSystem(config)，id 'regrowth'）
//     僅在日界（tickOfDay===0）動作；「曾是森林但已砍光」判定＝override.type==='grass' &&
//     override.resource===0 && baseTerrainAt 該格原本是 forest；經 config.forestRegrowDays 天
//     （totalDay - override.depletedDay >= forestRegrowDays）後回復 forest（移除該格 override）。
//     礦脈（原本是 rock）不再生；override 缺 depletedDay 時不動作、不 throw；不消耗 rng。
// R8：決定論與存檔（terrainOverrides.resource/depletedDay 的 round-trip；depletedDay 的 save.ts 驗證）
//
// 本檔一律用 terrainOverrides 手動塞地形，不依賴 seed 的程序生成結果，
// 唯 R6 需要「baseTerrainAt 原本是 forest/rock」的座標時，以掃描方式動態尋找（不寫死座標）。
import { describe, expect, it } from 'vitest';
import {
  FOREST_WOOD_CAPACITY,
  ROCK_STONE_CAPACITY,
  terrainResourceCapacity,
  getTerrainResource,
  consumeTerrainResource,
  terrainAt,
  baseTerrainAt,
  type TerrainType,
  type TerrainOverride,
} from '../../src/core/world/terrain';
import { createInitialState, getResource } from '../../src/core/world/state';
import type { GameState } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import { createProductionSystem } from '../../src/core/systems/production';
import { createRegrowthSystem } from '../../src/core/systems/regrowth';
import type { SimContext } from '../../src/core/sim/system';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick, TICKS_PER_DAY } from '../../src/core/sim/time';
import { Simulation } from '../../src/core/sim/simulation';
import { serializeGameState, deserializeGameState } from '../../src/core/save/save';
import { parseBuildingDefs, parseResourceDefs, parseTerrainEconomy } from '../../src/data/loader';
import type { TerrainEconomy } from '../../src/data/types';
import buildingsJson from '../../data/buildings.json';
import resourcesJson from '../../data/resources.json';
import terrainEconomyJson from '../../data/terrain-economy.json';

const TEST_ECONOMY: TerrainEconomy = {
  forestWoodCapacity: 60,
  rockStoneCapacity: 120,
  forestRegrowDays: 5,
};

function economy(overrides: Partial<TerrainEconomy> = {}): TerrainEconomy {
  return { ...TEST_ECONOMY, ...overrides };
}

function setTerrain(state: GameState, x: number, y: number, type: TerrainType): void {
  (state.terrainOverrides as Record<string, TerrainOverride>)[`${x},${y}`] = { type };
}

// ── R4：地形資源儲量 ──────────────────────────────────────────────────────────

describe('R4：地形資源儲量（terrainResourceCapacity/getTerrainResource/consumeTerrainResource）', () => {
  it('FOREST_WOOD_CAPACITY / ROCK_STONE_CAPACITY 為正整數常數', () => {
    expect(Number.isInteger(FOREST_WOOD_CAPACITY)).toBe(true);
    expect(FOREST_WOOD_CAPACITY).toBeGreaterThan(0);
    expect(Number.isInteger(ROCK_STONE_CAPACITY)).toBe(true);
    expect(ROCK_STONE_CAPACITY).toBeGreaterThan(0);
  });

  it('terrainResourceCapacity：forest 回 FOREST_WOOD_CAPACITY，rock 回 ROCK_STONE_CAPACITY，其餘四種回 0', () => {
    expect(terrainResourceCapacity('forest')).toBe(FOREST_WOOD_CAPACITY);
    expect(terrainResourceCapacity('rock')).toBe(ROCK_STONE_CAPACITY);
    for (const t of ['water', 'sand', 'grass', 'mountain'] as TerrainType[]) {
      expect(terrainResourceCapacity(t)).toBe(0);
    }
  });

  it('注入經濟設定會決定容量，get/consume 皆沿用同一設定而非硬寫常數', () => {
    const injected = economy({ forestWoodCapacity: 17, rockStoneCapacity: 29 });
    const state = createInitialState(1);
    setTerrain(state, 5, 5, 'forest');
    setTerrain(state, 6, 6, 'rock');

    expect(terrainResourceCapacity('forest', injected)).toBe(17);
    expect(terrainResourceCapacity('rock', injected)).toBe(29);
    expect(getTerrainResource(state, 5, 5, injected)).toBe(17);
    expect(consumeTerrainResource(state, 5, 5, 3, injected)).toBe(3);
    expect(getTerrainResource(state, 5, 5, injected)).toBe(14);
  });

  it('getTerrainResource：無 override.resource 時回該格 terrainResourceCapacity（未開採過的格子是滿的）', () => {
    const state = createInitialState(1);
    setTerrain(state, 5, 5, 'forest');
    expect(getTerrainResource(state, 5, 5)).toBe(FOREST_WOOD_CAPACITY);
    setTerrain(state, 6, 6, 'rock');
    expect(getTerrainResource(state, 6, 6)).toBe(ROCK_STONE_CAPACITY);
    setTerrain(state, 7, 7, 'grass');
    expect(getTerrainResource(state, 7, 7)).toBe(0);
  });

  it('getTerrainResource：override.resource 存在時優先於 terrainResourceCapacity', () => {
    const state = createInitialState(1);
    (state.terrainOverrides as Record<string, TerrainOverride>)['5,5'] = { type: 'forest', resource: 12.5 };
    expect(getTerrainResource(state, 5, 5)).toBe(12.5);
  });

  it('consumeTerrainResource：扣除量小於現存量時，回傳實際扣到的量並更新剩餘量；地形本身不變（尚未耗盡）', () => {
    const state = createInitialState(1);
    setTerrain(state, 5, 5, 'forest');

    const consumed = consumeTerrainResource(state, 5, 5, 20);

    expect(consumed).toBe(20);
    expect(getTerrainResource(state, 5, 5)).toBe(FOREST_WOOD_CAPACITY - 20);
    expect(terrainAt(state, 5, 5)).toBe('forest');
  });

  it('consumeTerrainResource：扣除量 ≥ 現存量時，回傳現存量（clip），地形翻轉為 grass、resource 為 0', () => {
    const state = createInitialState(1);
    (state.terrainOverrides as Record<string, TerrainOverride>)['5,5'] = { type: 'forest', resource: 3 };

    const consumed = consumeTerrainResource(state, 5, 5, 100);

    expect(consumed).toBe(3);
    expect(getTerrainResource(state, 5, 5)).toBe(0);
    expect(terrainAt(state, 5, 5)).toBe('grass');
  });

  it('consumeTerrainResource：連續呼叫逐步耗盡，恰好耗盡時翻轉為 grass，之後再呼叫回傳 0 且不 throw', () => {
    const state = createInitialState(1);
    (state.terrainOverrides as Record<string, TerrainOverride>)['5,5'] = { type: 'rock', resource: 10 };

    expect(consumeTerrainResource(state, 5, 5, 4)).toBe(4);
    expect(getTerrainResource(state, 5, 5)).toBe(6);
    expect(terrainAt(state, 5, 5)).toBe('rock');

    expect(consumeTerrainResource(state, 5, 5, 4)).toBe(4);
    expect(getTerrainResource(state, 5, 5)).toBe(2);
    expect(terrainAt(state, 5, 5)).toBe('rock');

    expect(consumeTerrainResource(state, 5, 5, 4)).toBe(2); // 只剩 2，clip
    expect(getTerrainResource(state, 5, 5)).toBe(0);
    expect(terrainAt(state, 5, 5)).toBe('grass');

    expect(() => consumeTerrainResource(state, 5, 5, 4)).not.toThrow();
    expect(consumeTerrainResource(state, 5, 5, 4)).toBe(0);
  });

  it('consumeTerrainResource：對容量為 0 的地形（grass/water）呼叫，回傳 0、不 throw、不產生 override 變化', () => {
    const state = createInitialState(1);
    setTerrain(state, 5, 5, 'grass');
    const before = JSON.stringify(state.terrainOverrides);

    expect(() => consumeTerrainResource(state, 5, 5, 5)).not.toThrow();
    expect(consumeTerrainResource(state, 5, 5, 5)).toBe(0);
    expect(JSON.stringify(state.terrainOverrides)).toBe(before);
  });

  it('consumeTerrainResource：amount 為負數 → throw', () => {
    const state = createInitialState(1);
    setTerrain(state, 5, 5, 'forest');
    expect(() => consumeTerrainResource(state, 5, 5, -1)).toThrow();
  });
});

// ── R5：production system 消耗地形資源 ─────────────────────────────────────────

describe('R5：production system 只依 terrain.consumes 消耗地形資源', () => {
  function onDef(): BuildingDef {
    return {
      id: 'quarry-t',
      name: '採石場',
      size: { w: 1, h: 1 },
      cost: {},
      production: { stone: 5 },
      housing: 0,
      jobs: 0,
      terrain: { on: ['rock'], consumes: ['rock'] },
    } as BuildingDef;
  }

  function nearDef(): BuildingDef {
    return {
      id: 'lumber-t',
      name: '伐木場',
      size: { w: 1, h: 1 },
      cost: {},
      production: { wood: 5 },
      housing: 0,
      jobs: 0,
      terrain: { near: ['forest'], consumes: ['forest'] },
    } as BuildingDef;
  }

  function makeCtx(tick = 1): SimContext {
    return { rng: createRng(1), time: timeFromTick(tick) };
  }

  it('terrain.consumes：實際產出量 = min(名目產出, 可扣地形資源量)，逐 tick 從佔格本身扣地形資源，耗盡後產出 0', () => {
    const sys = createProductionSystem([onDef()]);
    const state = createInitialState(1);
    state.buildings.push({ id: 'q1', type: 'quarry-t', x: 5, y: 5 });
    (state.terrainOverrides as Record<string, TerrainOverride>)['5,5'] = { type: 'rock', resource: 7 };

    sys.update(state, makeCtx(1)); // min(5,7)=5
    expect(getResource(state, 'stone')).toBe(5);
    expect(getTerrainResource(state, 5, 5)).toBe(2);
    expect(terrainAt(state, 5, 5)).toBe('rock');

    sys.update(state, makeCtx(2)); // min(5,2)=2 → 耗盡
    expect(getResource(state, 'stone')).toBe(7);
    expect(getTerrainResource(state, 5, 5)).toBe(0);
    expect(terrainAt(state, 5, 5)).toBe('grass');

    sys.update(state, makeCtx(3)); // 已耗盡，產出 0，不 throw
    expect(getResource(state, 'stone')).toBe(7);
  });

  it('terrain.consumes：耗盡時 override.depletedDay 記錄當下 ctx.time.totalDay（供 R6 森林再生使用）', () => {
    const sys = createProductionSystem([onDef()]);
    const state = createInitialState(1);
    state.buildings.push({ id: 'q1', type: 'quarry-t', x: 5, y: 5 });
    (state.terrainOverrides as Record<string, TerrainOverride>)['5,5'] = { type: 'rock', resource: 7 };

    sys.update(state, makeCtx(1));
    sys.update(state, makeCtx(2)); // 第 2 次呼叫耗盡

    const override = (state.terrainOverrides as Record<string, TerrainOverride & { depletedDay?: number }>)['5,5'];
    expect(override.depletedDay).toBe(timeFromTick(2).totalDay);
  });

  it('terrain.consumes：每 tick 在 footprint 後依北→東→南→西選第一個仍有存量且符合清單的鄰格', () => {
    const sys = createProductionSystem([nearDef()]);
    const state = createInitialState(1);
    state.buildings.push({ id: 'lc1', type: 'lumber-t', x: 5, y: 5 });
    const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
    overrides['5,4'] = { type: 'grass' }; // 北：不符合
    overrides['6,5'] = { type: 'forest', resource: 3 }; // 東：符合，存量最少
    overrides['5,6'] = { type: 'forest', resource: 8 }; // 南：符合
    overrides['4,5'] = { type: 'forest', resource: 8 }; // 西：符合

    sys.update(state, makeCtx(1)); // 東 3 < 5，扣光
    expect(getResource(state, 'wood')).toBe(3);
    expect(getTerrainResource(state, 6, 5)).toBe(0);
    expect(terrainAt(state, 6, 5)).toBe('grass');
    expect(getTerrainResource(state, 5, 6)).toBe(8);
    expect(getTerrainResource(state, 4, 5)).toBe(8);

    sys.update(state, makeCtx(2)); // 東已耗盡不符合 → 改採南（在西之前）：min(5,8)=5
    expect(getResource(state, 'wood')).toBe(8);
    expect(getTerrainResource(state, 5, 6)).toBe(3);
    expect(getTerrainResource(state, 4, 5)).toBe(8);

    sys.update(state, makeCtx(3)); // 南剩 3 < 5，扣光耗盡
    expect(getResource(state, 'wood')).toBe(11);
    expect(getTerrainResource(state, 5, 6)).toBe(0);
    expect(terrainAt(state, 5, 6)).toBe('grass');
    expect(getTerrainResource(state, 4, 5)).toBe(8);

    sys.update(state, makeCtx(4)); // 南已耗盡 → 改採西：min(5,8)=5
    expect(getResource(state, 'wood')).toBe(16);
    expect(getTerrainResource(state, 4, 5)).toBe(3);
  });

  it('terrain.consumes：footprint 與四鄰接皆不符合清單或已耗盡 → 產出 0，不 throw', () => {
    const sys = createProductionSystem([nearDef()]);
    const state = createInitialState(1);
    state.buildings.push({ id: 'lc1', type: 'lumber-t', x: 5, y: 5 });
    const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
    overrides['5,4'] = { type: 'grass' };
    overrides['6,5'] = { type: 'grass' };
    overrides['5,6'] = { type: 'grass' };
    overrides['4,5'] = { type: 'grass' };

    expect(() => sys.update(state, makeCtx(1))).not.toThrow();
    expect(getResource(state, 'wood')).toBe(0);
  });

  it('terrain 有值但 production 為空物件（如實際資料表的 house）→ 不觸發任何地形消耗、不影響資源', () => {
    const houseLikeDef: BuildingDef = {
      id: 'house-t',
      name: '民居',
      size: { w: 1, h: 1 },
      cost: {},
      production: {},
      housing: 4,
      jobs: 0,
      terrain: { on: ['grass', 'sand'] },
    } as BuildingDef;
    const sys = createProductionSystem([houseLikeDef]);
    const state = createInitialState(1);
    state.buildings.push({ id: 'h1', type: 'house-t', x: 5, y: 5 });
    setTerrain(state, 5, 5, 'grass');

    expect(() => sys.update(state, makeCtx(1))).not.toThrow();
    expect(state.resources).toEqual({});
  });

  it('terrain.on/near 只有擺放語義：未宣告 consumes 的生產建築走名目產出且不消耗地形', () => {
    const farmLikeDef: BuildingDef = {
      id: 'farm-t',
      name: '農場',
      size: { w: 1, h: 1 },
      cost: {},
      production: { food: 3 },
      housing: 0,
      jobs: 0,
      terrain: { on: ['grass'] },
    };
    const sys = createProductionSystem([farmLikeDef], TEST_ECONOMY);
    const state = createInitialState(1);
    state.buildings.push({ id: 'f1', type: 'farm-t', x: 5, y: 5 });
    setTerrain(state, 5, 5, 'grass');
    const before = JSON.stringify(state.terrainOverrides);

    sys.update(state, makeCtx(1));

    expect(getResource(state, 'food')).toBe(3);
    expect(JSON.stringify(state.terrainOverrides)).toBe(before);
  });

  it('來源順序先掃完整 footprint，再掃原點四鄰', () => {
    const wideDef: BuildingDef = {
      ...nearDef(),
      id: 'wide-lumber',
      size: { w: 2, h: 1 },
    };
    const sys = createProductionSystem([wideDef], TEST_ECONOMY);
    const state = createInitialState(1);
    state.buildings.push({ id: 'wide', type: 'wide-lumber', x: 5, y: 5 });
    const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
    overrides['5,5'] = { type: 'grass' };
    overrides['6,5'] = { type: 'forest', resource: 5 }; // footprint 第二格
    overrides['5,4'] = { type: 'forest', resource: 5 }; // 原點北鄰

    sys.update(state, makeCtx(1));
    expect(getTerrainResource(state, 6, 5, TEST_ECONOMY)).toBe(0);
    expect(getTerrainResource(state, 5, 4, TEST_ECONOMY)).toBe(5);

    sys.update(state, makeCtx(2));
    expect(getTerrainResource(state, 5, 4, TEST_ECONOMY)).toBe(0);
    expect(getResource(state, 'wood')).toBe(10);
  });

  it('無 terrain 欄位的建築完全不受影響（既有生產邏輯回歸）', () => {
    const plainDef: BuildingDef = {
      id: 'plain-t',
      name: '無地形限制建築',
      size: { w: 1, h: 1 },
      cost: {},
      production: { gold: 3 },
      housing: 0,
      jobs: 0,
    } as BuildingDef;
    const sys = createProductionSystem([plainDef]);
    const state = createInitialState(1);
    state.buildings.push({ id: 'p1', type: 'plain-t', x: 5, y: 5 });
    setTerrain(state, 5, 5, 'water'); // 即使地形不可通行，無 terrain 欄位者的產出仍不受影響

    sys.update(state, makeCtx(1));

    expect(getResource(state, 'gold')).toBe(3);
  });

  it('在職率與地形資源上限共同作用：實際產出 = min(名目產出×在職率, 可扣地形資源量)', () => {
    const jobbedDef: BuildingDef = {
      id: 'quarry-jobs',
      name: '採石場',
      size: { w: 1, h: 1 },
      cost: {},
      production: { stone: 5 },
      housing: 0,
      jobs: 4,
      terrain: { on: ['rock'], consumes: ['rock'] },
    } as BuildingDef;
    const sys = createProductionSystem([jobbedDef]);
    const state = createInitialState(1);
    state.buildings.push({ id: 'q1', type: 'quarry-jobs', x: 5, y: 5 });
    state.citizens.push(
      { id: 'c1', home: 'h', job: 'q1', x: 0, y: 0 },
      { id: 'c2', home: 'h', job: 'q1', x: 0, y: 0 },
    ); // 2/4 在職 → ratio 0.5 → 名目 2.5
    (state.terrainOverrides as Record<string, TerrainOverride>)['5,5'] = { type: 'rock', resource: 10 };

    sys.update(state, makeCtx(1));

    expect(getResource(state, 'stone')).toBe(2.5);
    expect(getTerrainResource(state, 5, 5)).toBe(7.5);
  });
});

// ── 真實資料表整合回歸 ────────────────────────────────────────────────────────

describe('真實 buildings.json + terrain-economy.json 生產行為', () => {
  const SEED = 1;
  const SIZE = 200;
  const resourceDefs = parseResourceDefs(resourcesJson);
  const realDefs = parseBuildingDefs(buildingsJson, new Set(resourceDefs.map((def) => def.id)));
  const realEconomy = parseTerrainEconomy(terrainEconomyJson);

  function naturalTerrain(type: TerrainType): { x: number; y: number } {
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        if (baseTerrainAt(SEED, SIZE, x, y) === type) return { x, y };
      }
    }
    throw new Error(`naturalTerrain: 找不到天然 ${type} 地形`);
  }

  function naturalLumberSite(): { x: number; y: number; sourceX: number; sourceY: number } {
    const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const origin = baseTerrainAt(SEED, SIZE, x, y);
        if (!['sand', 'grass', 'rock'].includes(origin)) continue;
        for (const [dx, dy] of offsets) {
          if (baseTerrainAt(SEED, SIZE, x + dx, y + dy) === 'forest') {
            return { x, y, sourceX: x + dx, sourceY: y + dy };
          }
        }
      }
    }
    throw new Error('naturalLumberSite: 找不到鄰接天然森林的可建格');
  }

  function employ(state: GameState, buildingId: string, count: number): void {
    for (let index = 0; index < count; index++) {
      state.citizens.push({
        id: `${buildingId}-worker-${index}`,
        home: buildingId,
        job: buildingId,
        x: 0,
        y: 0,
      });
    }
  }

  function update(system: ReturnType<typeof createProductionSystem>, state: GameState, tick: number): void {
    system.update(state, { rng: createRng(1), time: timeFromTick(tick) });
  }

  it('farm 蓋在天然草地且滿在職率時每 tick 產 3 糧，不消耗任何地形', () => {
    const farm = realDefs.find((def) => def.id === 'farm')!;
    const coord = naturalTerrain('grass');
    const state = createInitialState(SEED);
    state.worldSize = SIZE;
    state.buildings.push({ id: 'farm-real', type: farm.id, ...coord });
    employ(state, 'farm-real', farm.jobs);
    const system = createProductionSystem(realDefs, realEconomy);
    const beforeOverrides = JSON.stringify(state.terrainOverrides);

    update(system, state, 1);
    expect(getResource(state, 'food')).toBe(3);
    update(system, state, 2);
    expect(getResource(state, 'food')).toBe(6);
    expect(JSON.stringify(state.terrainOverrides)).toBe(beforeOverrides);
    expect(terrainAt(state, coord.x, coord.y)).toBe('grass');
  });

  it('lumber-camp 鄰接天然森林時產木材並依 JSON 容量扣該森林格', () => {
    const lumberCamp = realDefs.find((def) => def.id === 'lumber-camp')!;
    const site = naturalLumberSite();
    const state = createInitialState(SEED);
    state.worldSize = SIZE;
    state.buildings.push({ id: 'lumber-real', type: lumberCamp.id, x: site.x, y: site.y });
    employ(state, 'lumber-real', lumberCamp.jobs);
    const system = createProductionSystem(realDefs, realEconomy);

    update(system, state, 1);

    expect(getResource(state, 'wood')).toBe(2);
    expect(getTerrainResource(state, site.sourceX, site.sourceY, realEconomy)).toBe(
      realEconomy.forestWoodCapacity - 2,
    );
  });

  it('quarry 蓋在天然石礦上時產石材並依 JSON 容量扣腳下格', () => {
    const quarry = realDefs.find((def) => def.id === 'quarry')!;
    const coord = naturalTerrain('rock');
    const state = createInitialState(SEED);
    state.worldSize = SIZE;
    state.buildings.push({ id: 'quarry-real', type: quarry.id, ...coord });
    employ(state, 'quarry-real', quarry.jobs);
    const system = createProductionSystem(realDefs, realEconomy);

    update(system, state, 1);

    expect(getResource(state, 'stone')).toBe(2);
    expect(getTerrainResource(state, coord.x, coord.y, realEconomy)).toBe(realEconomy.rockStoneCapacity - 2);
  });

  it('森林耗盡轉草地後改採下一鄰格，四鄰皆耗盡時產出 0', () => {
    const lumberCamp = realDefs.find((def) => def.id === 'lumber-camp')!;
    const state = createInitialState(SEED);
    state.buildings.push({ id: 'lumber-real', type: lumberCamp.id, x: 10, y: 10 });
    employ(state, 'lumber-real', lumberCamp.jobs);
    const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
    overrides['10,10'] = { type: 'grass' };
    overrides['10,9'] = { type: 'forest', resource: 2 }; // 北，先採
    overrides['11,10'] = { type: 'forest', resource: 2 }; // 東，北耗盡後採
    overrides['10,11'] = { type: 'grass', resource: 0 }; // 南，已耗盡
    overrides['9,10'] = { type: 'grass', resource: 0 }; // 西，已耗盡
    const system = createProductionSystem(realDefs, realEconomy);

    update(system, state, 1);
    expect(getResource(state, 'wood')).toBe(2);
    expect(terrainAt(state, 10, 9)).toBe('grass');
    expect(getTerrainResource(state, 11, 10, realEconomy)).toBe(2);

    update(system, state, 2);
    expect(getResource(state, 'wood')).toBe(4);
    expect(terrainAt(state, 11, 10)).toBe('grass');

    update(system, state, 3);
    expect(getResource(state, 'wood')).toBe(4);
    for (const [x, y] of [[10, 9], [11, 10], [10, 11], [9, 10]] as const) {
      expect(getTerrainResource(state, x, y, realEconomy)).toBe(0);
      expect(terrainAt(state, x, y)).toBe('grass');
    }
  });
});

// ── R6：森林再生 ─────────────────────────────────────────────────────────────

describe('R6：森林再生（createRegrowthSystem）', () => {
  const SEED = 1;
  const SIZE = 200;

  function findCoordsWithBaseTerrain(type: TerrainType, count: number): Array<{ x: number; y: number }> {
    const found: Array<{ x: number; y: number }> = [];
    for (let x = 0; x < SIZE && found.length < count; x++) {
      for (let y = 0; y < SIZE && found.length < count; y++) {
        if (baseTerrainAt(SEED, SIZE, x, y) === type) found.push({ x, y });
      }
    }
    if (found.length < count) {
      throw new Error(`findCoordsWithBaseTerrain: 找不到 ${count} 個地形為 ${type} 的座標，只找到 ${found.length} 個`);
    }
    return found;
  }

  function tickForDayStart(totalDay: number): number {
    return (totalDay - 1) * TICKS_PER_DAY; // tickOfDay===0
  }

  function depletedForestState(depletedDay: number): { state: GameState; coord: { x: number; y: number } } {
    const state = createInitialState(SEED);
    const [coord] = findCoordsWithBaseTerrain('forest', 1);
    (state.terrainOverrides as Record<string, TerrainOverride & { depletedDay?: number }>)[`${coord.x},${coord.y}`] =
      { type: 'grass', resource: 0, depletedDay };
    return { state, coord };
  }

  it('system.id 為 regrowth', () => {
    const sys = createRegrowthSystem(economy({ forestRegrowDays: 5 }));
    expect(sys.id).toBe('regrowth');
  });

  it('僅在日界（tickOfDay===0）動作：非日界呼叫即使天數已滿也不 regrow', () => {
    const { state, coord } = depletedForestState(1);
    const sys = createRegrowthSystem(economy({ forestRegrowDays: 5 }));
    const ctx: SimContext = { rng: createRng(1), time: timeFromTick(tickForDayStart(10) + 1) }; // tickOfDay=1
    expect(ctx.time.tickOfDay).not.toBe(0);

    sys.update(state, ctx);

    const key = `${coord.x},${coord.y}`;
    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, key)).toBe(true);
    expect(terrainAt(state, coord.x, coord.y)).toBe('grass');
  });

  it('已過 forestRegrowDays 天且為日界 → 森林重生：override 移除，terrainAt 恢復 forest，資源回滿', () => {
    const forestRegrowDays = 5;
    const { state, coord } = depletedForestState(1); // 第 1 天耗盡
    const regrowthEconomy = economy({ forestRegrowDays });
    const sys = createRegrowthSystem(regrowthEconomy);
    const ctx: SimContext = { rng: createRng(1), time: timeFromTick(tickForDayStart(1 + forestRegrowDays)) }; // 第 6 天日界

    sys.update(state, ctx);

    const key = `${coord.x},${coord.y}`;
    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, key)).toBe(false);
    expect(terrainAt(state, coord.x, coord.y)).toBe('forest');
    expect(getTerrainResource(state, coord.x, coord.y, regrowthEconomy)).toBe(regrowthEconomy.forestWoodCapacity);
  });

  it('未滿 forestRegrowDays 天 → 不重生', () => {
    const forestRegrowDays = 5;
    const { state, coord } = depletedForestState(1);
    const sys = createRegrowthSystem(economy({ forestRegrowDays }));
    const ctx: SimContext = {
      rng: createRng(1),
      time: timeFromTick(tickForDayStart(1 + forestRegrowDays - 1)), // 只過 4 天
    };

    sys.update(state, ctx);

    const key = `${coord.x},${coord.y}`;
    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, key)).toBe(true);
    expect(terrainAt(state, coord.x, coord.y)).toBe('grass');
  });

  it('原本是 rock（採石場開採過）的格子永不重生，即使經過極長天數', () => {
    const [rockCoord] = findCoordsWithBaseTerrain('rock', 1);
    const state = createInitialState(SEED);
    (state.terrainOverrides as Record<string, TerrainOverride & { depletedDay?: number }>)[
      `${rockCoord.x},${rockCoord.y}`
    ] = { type: 'grass', resource: 0, depletedDay: 1 };
    const sys = createRegrowthSystem(economy({ forestRegrowDays: 5 }));
    const ctx: SimContext = { rng: createRng(1), time: timeFromTick(tickForDayStart(100000)) };

    sys.update(state, ctx);

    const key = `${rockCoord.x},${rockCoord.y}`;
    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, key)).toBe(true);
    expect(terrainAt(state, rockCoord.x, rockCoord.y)).toBe('grass');
  });

  it('override 缺 depletedDay（無法判斷經過天數）→ 不動作、不 throw', () => {
    const [coord] = findCoordsWithBaseTerrain('forest', 1);
    const state = createInitialState(SEED);
    (state.terrainOverrides as Record<string, TerrainOverride>)[`${coord.x},${coord.y}`] = {
      type: 'grass',
      resource: 0,
    };
    const sys = createRegrowthSystem(economy({ forestRegrowDays: 5 }));
    const ctx: SimContext = { rng: createRng(1), time: timeFromTick(tickForDayStart(100000)) };

    expect(() => sys.update(state, ctx)).not.toThrow();
    const key = `${coord.x},${coord.y}`;
    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, key)).toBe(true);
    expect(terrainAt(state, coord.x, coord.y)).toBe('grass');
  });

  it('多個已耗盡的森林格：只有滿足天數門檻者重生，其餘不動', () => {
    const [early, late] = findCoordsWithBaseTerrain('forest', 2);
    const state = createInitialState(SEED);
    const overrides = state.terrainOverrides as Record<string, TerrainOverride & { depletedDay?: number }>;
    overrides[`${early.x},${early.y}`] = { type: 'grass', resource: 0, depletedDay: 1 };
    overrides[`${late.x},${late.y}`] = { type: 'grass', resource: 0, depletedDay: 50 };
    const forestRegrowDays = 5;
    const sys = createRegrowthSystem(economy({ forestRegrowDays }));
    const ctx: SimContext = { rng: createRng(1), time: timeFromTick(tickForDayStart(1 + forestRegrowDays)) }; // 第 6 天

    sys.update(state, ctx);

    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, `${early.x},${early.y}`)).toBe(false);
    expect(terrainAt(state, early.x, early.y)).toBe('forest');
    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, `${late.x},${late.y}`)).toBe(true);
    expect(terrainAt(state, late.x, late.y)).toBe('grass');
  });

  it('不消耗 rng', () => {
    const forestRegrowDays = 5;
    const { state } = depletedForestState(1);
    const sys = createRegrowthSystem(economy({ forestRegrowDays }));
    const poisonedRng = {
      next: () => {
        throw new Error('regrowth system 不應呼叫 rng.next()');
      },
      nextInt: () => {
        throw new Error('regrowth system 不應呼叫 rng.nextInt()');
      },
      getState: () => 0,
      setState: () => {},
    };
    const ctx: SimContext = { rng: poisonedRng, time: timeFromTick(tickForDayStart(1 + forestRegrowDays)) };

    expect(() => sys.update(state, ctx)).not.toThrow();
  });

  it('冪等：重生後再次於日界呼叫不會出錯、也不會重新產生 override', () => {
    const forestRegrowDays = 5;
    const { state, coord } = depletedForestState(1);
    const sys = createRegrowthSystem(economy({ forestRegrowDays }));
    const ctx: SimContext = { rng: createRng(1), time: timeFromTick(tickForDayStart(1 + forestRegrowDays)) };

    sys.update(state, ctx);
    expect(terrainAt(state, coord.x, coord.y)).toBe('forest');

    expect(() => sys.update(state, ctx)).not.toThrow();
    expect(terrainAt(state, coord.x, coord.y)).toBe('forest');
    expect(Object.prototype.hasOwnProperty.call(state.terrainOverrides, `${coord.x},${coord.y}`)).toBe(false);
  });
});

// ── R8：決定論與存檔 ──────────────────────────────────────────────────────────

describe('R8：決定論與存檔（terrainOverrides.resource/depletedDay）', () => {
  it('同 seed＋同指令序列（含地形資源消耗）跑 N tick 兩次，state 深相等（含 terrainOverrides）', () => {
    function buildSim(seed: number): { state: GameState; sim: Simulation } {
      const state = createInitialState(seed);
      state.worldSize = 50;
      (state.terrainOverrides as Record<string, TerrainOverride>)['5,5'] = { type: 'rock', resource: 12 };
      const def: BuildingDef = {
        id: 'quarry-t',
        name: '採石場',
        size: { w: 1, h: 1 },
        cost: {},
        production: { stone: 5 },
        housing: 0,
        jobs: 0,
        terrain: { on: ['rock'], consumes: ['rock'] },
      } as BuildingDef;
      state.buildings.push({ id: 'q1', type: 'quarry-t', x: 5, y: 5 });
      const sys = createProductionSystem([def]);
      const sim = new Simulation(state, [sys], [def]);
      return { state, sim };
    }

    const a = buildSim(777);
    const b = buildSim(777);
    a.sim.run(10);
    b.sim.run(10);

    expect(a.state).toEqual(b.state);
  });

  it('terrainOverrides 含 resource 與 depletedDay 的 override 可 serialize→deserialize round-trip', () => {
    const state = createInitialState(1);
    const overrides: Record<string, TerrainOverride & { depletedDay?: number }> = {
      '2,2': { type: 'grass', resource: 0, depletedDay: 3 },
      '3,3': { type: 'rock', resource: 45.5 },
    };
    (state as GameState & { terrainOverrides: typeof overrides }).terrainOverrides = overrides;

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);

    expect(restored.terrainOverrides).toEqual(overrides);
  });

  it('deserializeGameState：terrainOverrides[key].depletedDay 非正整數（負數/小數/字串/0）→ throw', () => {
    const state = createInitialState(1);
    const base = (depletedDay: unknown): string =>
      JSON.stringify({
        ...state,
        terrainOverrides: { '1,1': { type: 'grass', resource: 0, depletedDay } },
      });

    expect(() => deserializeGameState(base(-1))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(base(1.5))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(base('3'))).toThrow(/terrainOverrides/);
    expect(() => deserializeGameState(base(0))).toThrow(/terrainOverrides/); // totalDay 從 1 起算
  });

  it('deserializeGameState：terrainOverrides[key].depletedDay 省略或合法正整數 → 不 throw', () => {
    const state = createInitialState(1);
    const withOverrides = (overrides: Record<string, unknown>): string =>
      JSON.stringify({ ...state, terrainOverrides: overrides });

    expect(() => deserializeGameState(withOverrides({ '1,1': { type: 'grass', resource: 0 } }))).not.toThrow();
    expect(() =>
      deserializeGameState(withOverrides({ '1,1': { type: 'grass', resource: 0, depletedDay: 1 } })),
    ).not.toThrow();
  });
});
