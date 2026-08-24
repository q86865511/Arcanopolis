// M4-W1 R3-R5：加工鏈核心——資料表擴充（resources.json/buildings.json）與端到端鏈路整合
//
// R3：data/resources.json 在既有 wood/stone/food/gold 之外新增 grain/flour/plank/iron-ore/iron/tools，共 10 種。
// R4：data/buildings.json 擴充為 10 棟——farm 改為產出 grain 4（原 food 3）；新增 mill/bakery/sawmill/
//     mine/smelter/blacksmith，數值依任務簡報的表格逐條鎖定。
// R5：以真實資料表（非自建 fixture）驗證糧食/木材/金屬三條鏈路端到端可跑通，且中間資源不會變負。
//     只有 mine 帶 terrain.consumes，其餘新建築的 terrain 皆為 on-only（不影響生產），
//     故鏈路測試僅需在 mine 的座標塞 terrainOverrides。
import { describe, expect, it } from 'vitest';
import { parseBuildingDefs, parseResourceDefs, parseTerrainEconomy } from '../../src/data/loader';
import type { BuildingDef } from '../../src/data/types';
import { createProductionSystem } from '../../src/core/systems/production';
import { createInitialState, addResource, getResource } from '../../src/core/world/state';
import type { Building, GameState } from '../../src/core/world/state';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';
import resourcesJson from '../../data/resources.json';
import buildingsJson from '../../data/buildings.json';
import terrainEconomyJson from '../../data/terrain-economy.json';

type BuildingDefWithInputs = BuildingDef & { inputs?: Record<string, number> };

const NEW_RESOURCE_IDS = ['grain', 'flour', 'plank', 'iron-ore', 'iron', 'tools'] as const;

function realResourceIds(): Set<string> {
  return new Set(parseResourceDefs(resourcesJson).map((r) => r.id));
}

function realDefs(): BuildingDefWithInputs[] {
  return parseBuildingDefs(buildingsJson, realResourceIds()) as BuildingDefWithInputs[];
}

function defsById(defs: BuildingDefWithInputs[]): Map<string, BuildingDefWithInputs> {
  return new Map(defs.map((d) => [d.id, d]));
}

// ── R3：資源表擴充 ────────────────────────────────────────────────────────────

describe('data/resources.json 擴充加工鏈資源（R3）', () => {
  it('經 parseResourceDefs 驗證通過，含既有 4 種＋新增 6 種共 10 種', () => {
    const resources = parseResourceDefs(resourcesJson);
    expect(resources).toHaveLength(10);
    const ids = resources.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['wood', 'stone', 'food', 'gold', ...NEW_RESOURCE_IDS]));
  });
});

// ── R4：建築表擴充 ────────────────────────────────────────────────────────────

describe('data/buildings.json 擴充加工鏈建築（R4）', () => {
  it('經 parseBuildingDefs 驗證通過，共 11 棟（W1 十棟＋W2 市場）', () => {
    expect(realDefs()).toHaveLength(11);
  });

  it('farm 改為產出 grain 4（原 food 3），jobs/cost/terrain 不變', () => {
    const farm = defsById(realDefs()).get('farm')!;
    expect(farm.production).toEqual({ grain: 4 });
    expect(farm.cost).toEqual({ wood: 25, gold: 5 });
    expect(farm.jobs).toBe(2);
    expect(farm.terrain).toEqual({ on: ['grass'] });
  });

  it('mill：jobs2、production flour2、inputs grain4、cost、terrain on grass', () => {
    const mill = defsById(realDefs()).get('mill')!;
    expect(mill.jobs).toBe(2);
    expect(mill.production).toEqual({ flour: 2 });
    expect(mill.inputs).toEqual({ grain: 4 });
    expect(mill.cost).toEqual({ wood: 30, stone: 10, gold: 10 });
    expect(mill.terrain).toEqual({ on: ['grass'] });
  });

  it('bakery：jobs2、production food4、inputs flour2、cost、terrain on grass', () => {
    const bakery = defsById(realDefs()).get('bakery')!;
    expect(bakery.jobs).toBe(2);
    expect(bakery.production).toEqual({ food: 4 });
    expect(bakery.inputs).toEqual({ flour: 2 });
    expect(bakery.cost).toEqual({ wood: 25, stone: 15, gold: 10 });
    expect(bakery.terrain).toEqual({ on: ['grass'] });
  });

  it('sawmill：jobs2、production plank1、inputs wood2、cost、terrain on grass', () => {
    const sawmill = defsById(realDefs()).get('sawmill')!;
    expect(sawmill.jobs).toBe(2);
    expect(sawmill.production).toEqual({ plank: 1 });
    expect(sawmill.inputs).toEqual({ wood: 2 });
    expect(sawmill.cost).toEqual({ wood: 35, gold: 15 });
    expect(sawmill.terrain).toEqual({ on: ['grass'] });
  });

  it('mine：jobs3、production iron-ore1、無 inputs、cost、terrain on+consumes rock', () => {
    const mine = defsById(realDefs()).get('mine')!;
    expect(mine.jobs).toBe(3);
    expect(mine.production).toEqual({ 'iron-ore': 1 });
    expect(mine.inputs).toBeUndefined();
    expect(mine.cost).toEqual({ wood: 40, stone: 20, gold: 20 });
    expect(mine.terrain).toEqual({ on: ['rock'], consumes: ['rock'] });
  });

  it('smelter：jobs3、production iron1、inputs iron-ore1+wood1、cost、terrain on grass', () => {
    const smelter = defsById(realDefs()).get('smelter')!;
    expect(smelter.jobs).toBe(3);
    expect(smelter.production).toEqual({ iron: 1 });
    expect(smelter.inputs).toEqual({ 'iron-ore': 1, wood: 1 });
    expect(smelter.cost).toEqual({ stone: 40, wood: 20, gold: 25 });
    expect(smelter.terrain).toEqual({ on: ['grass'] });
  });

  it('blacksmith：jobs2、production tools1、inputs iron1+plank1、cost（含 plank）、terrain on grass', () => {
    const blacksmith = defsById(realDefs()).get('blacksmith')!;
    expect(blacksmith.jobs).toBe(2);
    expect(blacksmith.production).toEqual({ tools: 1 });
    expect(blacksmith.inputs).toEqual({ iron: 1, plank: 1 });
    expect(blacksmith.cost).toEqual({ stone: 30, plank: 10, gold: 20 });
    expect(blacksmith.terrain).toEqual({ on: ['grass'] });
  });

  it('六棟新建築皆為 1×1（比照既有 house/farm/lumber-camp/quarry 慣例）', () => {
    const defs = defsById(realDefs());
    for (const id of ['mill', 'bakery', 'sawmill', 'mine', 'smelter', 'blacksmith']) {
      expect(defs.get(id)?.size).toEqual({ w: 1, h: 1 });
    }
  });
});

// ── R5：真實資料表端到端鏈路整合 ───────────────────────────────────────────────

/** 讓建築滿編：工人放在該建築的格子上——到崗才算在職（見 production system），
 *  放在 (0,0) 等於全員還在路上，建築產出恆為 0。 */
function employ(state: GameState, buildingId: string, count: number): void {
  const workplace = state.buildings.find((b) => b.id === buildingId);
  if (workplace === undefined) throw new Error(`employ: 找不到建築 ${buildingId}`);
  for (let index = 0; index < count; index++) {
    state.citizens.push({
      id: `${buildingId}-worker-${index}`,
      home: buildingId,
      job: buildingId,
      x: workplace.x,
      y: workplace.y,
    });
  }
}

/** 逐 tick 執行並在每 tick 後斷言所有資源皆非負（R2d 的鏈路級回歸鎖）。 */
function runTicks(system: ReturnType<typeof createProductionSystem>, state: GameState, ticks: number): void {
  for (let tick = 1; tick <= ticks; tick++) {
    system.update(state, { rng: createRng(1), time: timeFromTick(tick) });
    for (const id of Object.keys(state.resources)) {
      expect(getResource(state, id)).toBeGreaterThanOrEqual(0);
    }
  }
}

function pushBuilding(state: GameState, building: Building): void {
  state.buildings.push(building);
}

describe('加工鏈端到端整合（真實資料表，R5）', () => {
  function realEconomy() {
    return parseTerrainEconomy(terrainEconomyJson);
  }

  it('(a) 農場→磨坊→麵包坊：三棟滿編就業，跑滿整條鏈的批次延遲後 food 增加，grain/flour 不變負也不失控累積', () => {
    const defs = realDefs();
    const byId = defsById(defs);
    const state = createInitialState(1);
    pushBuilding(state, { id: 'farm1', type: 'farm', x: 0, y: 0 });
    pushBuilding(state, { id: 'mill1', type: 'mill', x: 1, y: 0 });
    pushBuilding(state, { id: 'bakery1', type: 'bakery', x: 2, y: 0 });
    employ(state, 'farm1', byId.get('farm')!.jobs);
    employ(state, 'mill1', byId.get('mill')!.jobs);
    employ(state, 'bakery1', byId.get('bakery')!.jobs);
    const system = createProductionSystem(defs, realEconomy());

    // 產出改為整批入帳後，三段鏈的首批 food 最快要 3×workTicks=180 tick；跑 400 留餘裕
    runTicks(system, state, 400);

    expect(getResource(state, 'food')).toBeGreaterThan(0);

    // 中間產物不得失控累積。整批入帳後，上游一次倒進一批、下游逐 tick 取用，
    // 中間產物本來就會在 0 與「一批的量」之間來回——所以上界是「一批」而不是接近 0；
    // 真正要擋的是「下游跟不上、庫存單調成長」，故再多跑一整批確認沒有繼續往上長。
    const farmBatch = byId.get('farm')!.production.grain * byId.get('farm')!.workTicks!;
    const millBatch = byId.get('mill')!.production.flour * byId.get('mill')!.workTicks!;
    const grainAfter400 = getResource(state, 'grain');
    const flourAfter400 = getResource(state, 'flour');
    expect(grainAfter400).toBeLessThanOrEqual(farmBatch);
    expect(flourAfter400).toBeLessThanOrEqual(millBatch);

    runTicks(system, state, 400);
    expect(getResource(state, 'grain')).toBeLessThanOrEqual(farmBatch);
    expect(getResource(state, 'flour')).toBeLessThanOrEqual(millBatch);
  });

  it('(b) 缺上游：只有磨坊沒有農場 → flour 產出恆為 0，grain 不會變負', () => {
    const defs = realDefs();
    const byId = defsById(defs);
    const state = createInitialState(1);
    pushBuilding(state, { id: 'mill1', type: 'mill', x: 0, y: 0 });
    employ(state, 'mill1', byId.get('mill')!.jobs);
    const system = createProductionSystem(defs, realEconomy());

    runTicks(system, state, 20);

    expect(getResource(state, 'flour')).toBe(0);
    expect(getResource(state, 'grain')).toBe(0);
  });

  it('(c) 木材鏈：伐木場→鋸木廠產出 plank', () => {
    const defs = realDefs();
    const byId = defsById(defs);
    const state = createInitialState(1);
    state.terrainOverrides['0,0'] = { type: 'forest', resource: 2400 };
    pushBuilding(state, { id: 'lumber1', type: 'lumber-camp', x: 0, y: 0 });
    pushBuilding(state, { id: 'sawmill1', type: 'sawmill', x: 1, y: 0 });
    employ(state, 'lumber1', byId.get('lumber-camp')!.jobs);
    employ(state, 'sawmill1', byId.get('sawmill')!.jobs);
    const system = createProductionSystem(defs, realEconomy());

    runTicks(system, state, 200);

    expect(getResource(state, 'plank')).toBeGreaterThan(0);
  });

  it('(d) 金屬鏈：礦坑→冶煉廠→鐵匠鋪產出 tools（冶煉廠同時吃 iron-ore 與 wood；wood/plank 由測試直接供應，本測試不模擬木材鏈）', () => {
    const defs = realDefs();
    const byId = defsById(defs);
    const state = createInitialState(1);
    state.terrainOverrides['0,0'] = { type: 'rock', resource: 4800 };
    pushBuilding(state, { id: 'mine1', type: 'mine', x: 0, y: 0 });
    pushBuilding(state, { id: 'smelter1', type: 'smelter', x: 1, y: 0 });
    pushBuilding(state, { id: 'blacksmith1', type: 'blacksmith', x: 2, y: 0 });
    employ(state, 'mine1', byId.get('mine')!.jobs);
    employ(state, 'smelter1', byId.get('smelter')!.jobs);
    employ(state, 'blacksmith1', byId.get('blacksmith')!.jobs);
    addResource(state, 'wood', 1000); // 冶煉廠所需的第二項原料，直接供應
    addResource(state, 'plank', 1000); // 鐵匠鋪所需的木板，直接供應
    const system = createProductionSystem(defs, realEconomy());

    runTicks(system, state, 400);

    expect(getResource(state, 'tools')).toBeGreaterThan(0);
  });
});
