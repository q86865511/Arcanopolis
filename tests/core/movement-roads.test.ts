// M6-W3：帶權尋路接入 movement（src/core/systems/movement.ts）
//
// 契約：步進成本＝道路格 1、非道路格 K（options.roads.nonRoadStepCost）。
// 本檔鎖定四件事：
//  1. 無道路情境行為零變化——K=3 與 K=1 對同一世界逐 tick 座標深相等（既有測試不改的直接證據）。
//  2. 道路真的影響路徑——同一張地圖上 K=3 走道路繞路、K=1 走直線。
//  3. 道路不強制——目標周邊無路可達時仍會穿越非道路格抵達（連通性強制是 M6-W4，不是本波）。
//  4. 決定論——同世界兩次跑深相等，且全程不消耗 rng。
import { describe, expect, it } from 'vitest';
import { createMovementSystem } from '../../src/core/systems/movement';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';
import { placeRoad } from '../../src/core/world/roads';
import { createInitialState } from '../../src/core/world/state';
import type { Building, Citizen, GameState } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import type { Rng } from '../../src/core/sim/rng';
import type { SimContext } from '../../src/core/sim/system';
import type { GameTime } from '../../src/core/sim/time';

function makeDefs(): BuildingDef[] {
  return [
    { id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: { wood: 5 }, production: {}, housing: 4, jobs: 0 },
    {
      id: 'lumber-camp',
      name: '伐木場',
      size: { w: 1, h: 1 },
      cost: { wood: 10 },
      production: { wood: 2 },
      housing: 0,
      jobs: 2,
    },
  ];
}

function building(id: string, type: string, x: number, y: number): Building {
  return { id, type, x, y };
}

function makeTime(tickOfDay: number): GameTime {
  return { tickOfDay, day: 1, season: 'spring', year: 1, totalDay: 1 };
}

function makeCtx(tickOfDay: number): SimContext {
  return { rng: createRng(1), time: makeTime(tickOfDay) };
}

const ROADS_K3 = { roads: { nonRoadStepCost: 3 } };

/** 無道路的障礙世界：x=10 一整排建築擋住東西向，只留 y=8/9 兩格缺口。 */
function walledWorld(): GameState {
  const state = createInitialState(1);
  state.worldSize = 20;
  state.buildings.push(building('h0', 'house', 1, 1));
  state.buildings.push(building('h1', 'house', 1, 8));
  state.buildings.push(building('j0', 'lumber-camp', 18, 1));
  state.buildings.push(building('j1', 'lumber-camp', 18, 8));
  for (let y = 0; y < 8; y++) state.buildings.push(building(`w${y}`, 'lumber-camp', 10, y));
  const citizens: Citizen[] = [
    { id: 'c0', home: 'h0', job: 'j0', x: 1, y: 1 },
    { id: 'c1', home: 'h1', job: 'j1', x: 1, y: 8 },
    { id: 'c2', home: 'h0', job: 'j1', x: 1, y: 1 },
    { id: 'c3', home: 'h1', job: 'j0', x: 1, y: 8 },
  ];
  state.citizens.push(...citizens);
  return state;
}

/**
 * 繞道世界：home(0,2) → job(6,2) 直走 6 格全非道路；沿 y=0 的道路繞路共 10 格。
 * K=3 時繞路 9*1+3=12 便宜於直走 5*3+3=18；K=1 時直走 6 便宜於繞路 10。
 */
function detourWorld(): GameState {
  const state = createInitialState(1);
  state.worldSize = 8;
  state.buildings.push(building('h1', 'house', 0, 2));
  state.buildings.push(building('j1', 'lumber-camp', 6, 2));
  state.citizens.push({ id: 'c1', home: 'h1', job: 'j1', x: 0, y: 2 });
  placeRoad(state, 0, 1);
  for (let x = 0; x <= 6; x++) placeRoad(state, x, 0);
  placeRoad(state, 6, 1);
  return state;
}

/**
 * 斜向世界：home(0,0) → job(6,4)，所有單調路徑都是 10 步；沿 x=0 往下再往右那條全程鋪路，
 * K=3 時成本 9*1+3=12（其餘走法每步 3），K=1 時 10 步平手、由 (y,x) 決勝走另一條。
 */
function diagonalWorld(): GameState {
  const state = createInitialState(1);
  state.worldSize = 8;
  state.buildings.push(building('h1', 'house', 0, 0));
  state.buildings.push(building('j1', 'lumber-camp', 6, 4));
  state.citizens.push({ id: 'c1', home: 'h1', job: 'j1', x: 0, y: 0 });
  for (let y = 1; y <= 4; y++) placeRoad(state, 0, y);
  for (let x = 1; x <= 5; x++) placeRoad(state, x, 4);
  return state;
}

describe('無道路情境：K 不影響任何行為', () => {
  it('K=3 與 K=1 對同一障礙世界跑 400 tick，逐 tick 全體居民座標深相等', () => {
    const bounds = { w: 20, h: 10 };
    const weighted = walledWorld();
    const plain = walledWorld();
    const start = plain.citizens.map((c) => ({ x: c.x, y: c.y }));
    const sysWeighted = createMovementSystem(makeDefs(), bounds, ROADS_K3);
    const sysPlain = createMovementSystem(makeDefs(), bounds);
    const rng = createRng(1);

    // 前 300 tick 上半日朝 job、之後下半日折返朝 home，兩種目標都涵蓋。
    for (let tick = 0; tick < 400; tick++) {
      const ctx: SimContext = { rng, time: timeFromTick(tick) };
      sysWeighted.update(weighted, ctx);
      sysPlain.update(plain, ctx);
      expect(weighted.citizens).toEqual(plain.citizens);
    }

    // 防呆：確認上面比對的不是「兩邊都沒動」的空對空。
    expect(plain.citizens.map((c) => ({ x: c.x, y: c.y }))).not.toEqual(start);
  });
});

describe('有道路：成本影響路徑選擇', () => {
  it('K=3 第一步轉向道路、K=1 第一步走直線', () => {
    const bounds = { w: 8, h: 5 };
    const weighted = detourWorld();
    const plain = detourWorld();
    createMovementSystem(makeDefs(), bounds, ROADS_K3).update(weighted, makeCtx(0));
    createMovementSystem(makeDefs(), bounds).update(plain, makeCtx(0));

    expect(weighted.citizens[0]).toMatchObject({ x: 0, y: 1.9 });
    expect(plain.citizens[0]).toMatchObject({ x: 0.1, y: 2 });
  });

  it('等長的多條斜向路徑中，K=3 全程走鋪好的那條並抵達；K=1 走另一條', () => {
    const bounds = { w: 8, h: 6 };
    const weighted = diagonalWorld();
    const plain = diagonalWorld();
    const sysWeighted = createMovementSystem(makeDefs(), bounds, ROADS_K3);
    const sysPlain = createMovementSystem(makeDefs(), bounds);
    const ctx = makeCtx(0);
    let weightedOnPavedColumn = false;
    let plainOnPavedColumn = false;

    for (let tick = 0; tick < 200; tick++) {
      sysWeighted.update(weighted, ctx);
      sysPlain.update(plain, ctx);
      // 鋪好的那條先沿 x=0 往下走到底；沒鋪路時 (y,x) 決勝會先往右。
      if (weighted.citizens[0].x === 0 && weighted.citizens[0].y === 4) weightedOnPavedColumn = true;
      if (plain.citizens[0].x === 0 && plain.citizens[0].y === 4) plainOnPavedColumn = true;
    }

    expect(weightedOnPavedColumn).toBe(true);
    expect(plainOnPavedColumn).toBe(false);
    expect(weighted.citizens[0]).toMatchObject({ x: 6, y: 4 });
    expect(plain.citizens[0]).toMatchObject({ x: 6, y: 4 });
  });
});

describe('道路不強制：無路可達目標時仍穿越非道路格', () => {
  it('道路只有一段與目標不相連的殘段，居民照樣抵達目標格', () => {
    const bounds = { w: 10, h: 5 };
    const state = createInitialState(1);
    state.worldSize = 10;
    state.buildings.push(building('h1', 'house', 0, 0));
    state.buildings.push(building('j1', 'lumber-camp', 9, 4));
    state.citizens.push({ id: 'c1', home: 'h1', job: 'j1', x: 0, y: 0 });
    // 目標四周（含通往它的任何一條路徑）完全沒有道路：這段殘段停在 x=4、y=0。
    for (let x = 2; x <= 4; x++) placeRoad(state, x, 0);

    const sys = createMovementSystem(makeDefs(), bounds, ROADS_K3);
    const ctx = makeCtx(0);
    for (let tick = 0; tick < 200; tick++) sys.update(state, ctx);

    expect(state.citizens[0]).toMatchObject({ x: 9, y: 4 });
  });
});

describe('帶權尋路仍維持 core 契約', () => {
  it('同世界跑兩次 → 深相等（決定論）', () => {
    const bounds = { w: 8, h: 5 };
    const first = detourWorld();
    const second = detourWorld();
    const sysFirst = createMovementSystem(makeDefs(), bounds, ROADS_K3);
    const sysSecond = createMovementSystem(makeDefs(), bounds, ROADS_K3);

    for (let tick = 0; tick < 150; tick++) {
      sysFirst.update(first, makeCtx(0));
      sysSecond.update(second, makeCtx(0));
    }

    expect(first).toEqual(second);
  });

  it('不消耗 rng：呼叫即 throw 的假 rng 下，帶權搜尋仍正常執行並正確移動', () => {
    const bounds = { w: 8, h: 5 };
    const state = detourWorld();
    const poisonedRng: Rng = {
      next: () => {
        throw new Error('movement system 不應呼叫 rng.next()');
      },
      nextInt: () => {
        throw new Error('movement system 不應呼叫 rng.nextInt()');
      },
      getState: () => 0,
      setState: () => {},
    };
    const ctx: SimContext = { rng: poisonedRng, time: makeTime(0) };
    const sys = createMovementSystem(makeDefs(), bounds, ROADS_K3);

    expect(() => sys.update(state, ctx)).not.toThrow();
    expect(state.citizens[0]).toMatchObject({ x: 0, y: 1.9 });
  });
  it('界外起點的居民（手改存檔才可能）不讓 movement throw，原地不動，其他居民照常更新（Codex 第二審 M6-W3）', () => {
    const bounds = { w: 8, h: 5 };
    const state = detourWorld();
    const stray: Citizen = { ...state.citizens[0], id: 'stray', x: -1, y: 0 };
    state.citizens.unshift(stray);
    const sys = createMovementSystem(makeDefs(), bounds, ROADS_K3);

    expect(() => sys.update(state, makeCtx(0))).not.toThrow();
    expect(state.citizens[0]).toMatchObject({ x: -1, y: 0 });
    expect(state.citizens[1]).toMatchObject({ x: 0, y: 1.9 });
  });
});
