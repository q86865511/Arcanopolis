// M4.5-W1「到崗才算數」：production system 的在職判定必須看座標，不能只看 job 指向。
//
// 為什麼要獨立一個檔：既有的 production 測試把建築與居民都放在 (0,0)，居民「剛好」站在
// 建築上，所以無論有沒有到崗判定都會通過——它們對這個行為是全盲的。本檔的每一條都刻意
// 讓居民與建築分處不同格。
import { describe, expect, it } from 'vitest';
import { createProductionSystem } from '../../src/core/systems/production';
import { createRng } from '../../src/core/sim/rng';
import { timeFromTick } from '../../src/core/sim/time';
import { createInitialState, getResource, type Citizen, type GameState } from '../../src/core/world/state';
import type { SimContext } from '../../src/core/sim/system';
import type { BuildingDef } from '../../src/data/types';

const DEFS: BuildingDef[] = [
  {
    id: 'lumber-camp',
    name: '伐木場',
    size: { w: 1, h: 1 },
    cost: {},
    production: { wood: 8 },
    housing: 0,
    jobs: 4,
  },
  {
    id: 'big-camp',
    name: '大伐木場',
    size: { w: 2, h: 2 },
    cost: {},
    production: { wood: 4 },
    housing: 0,
    jobs: 1,
  },
];

function ctx(): SimContext {
  return { rng: createRng(1), time: timeFromTick(1) };
}

function worldWith(citizens: Citizen[], bx = 5, by = 7): GameState {
  const state = createInitialState(1);
  state.buildings.push({ id: 'lc1', type: 'lumber-camp', x: bx, y: by });
  state.citizens.push(...citizens);
  return state;
}

function run(state: GameState): number {
  createProductionSystem(DEFS).update(state, ctx());
  return getResource(state, 'wood');
}

function worker(id: string, x: number, y: number): Citizen {
  return { id, home: 'h', job: 'lc1', x, y };
}

describe('到崗才算數', () => {
  it('工人站在建築格上 → 計入在職，依人數比例產出', () => {
    expect(run(worldWith([worker('c1', 5, 7)]))).toBe(2); // 8 × 1/4
    expect(run(worldWith([worker('c1', 5, 7), worker('c2', 5, 7)]))).toBe(4); // 8 × 2/4
  });

  it('工人已被指派但人還在別處 → 完全不計入，產出為 0', () => {
    expect(run(worldWith([worker('c1', 0, 0)]))).toBe(0);
    expect(run(worldWith([worker('c1', 4, 7), worker('c2', 5, 6)]))).toBe(0);
  });

  it('差一格也不算到崗：相鄰格不能遠端上工', () => {
    for (const [x, y] of [[4, 7], [6, 7], [5, 6], [5, 8]]) {
      expect(run(worldWith([worker('c1', x, y)]))).toBe(0);
    }
  });

  it('走在半路（非整數座標）不算到崗', () => {
    expect(run(worldWith([worker('c1', 4.9, 7)]))).toBe(0);
    expect(run(worldWith([worker('c1', 5, 6.9)]))).toBe(0);
  });

  it('部分到崗：只算已抵達的人，還在路上的不算', () => {
    const state = worldWith([
      worker('c1', 5, 7),
      worker('c2', 5, 7),
      worker('c3', 1, 1),
      worker('c4', 2, 2),
    ]);
    expect(run(state)).toBe(4); // 到崗 2 人 → 8 × 2/4
  });

  it('站在別人的建築上不算：位置要對得上自己的工作地', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'lc1', type: 'lumber-camp', x: 5, y: 7 });
    state.buildings.push({ id: 'lc2', type: 'lumber-camp', x: 9, y: 9 });
    // 人站在 lc2 上，工作卻是 lc1
    state.citizens.push({ id: 'c1', home: 'h', job: 'lc1', x: 9, y: 9 });
    expect(run(state)).toBe(0);
  });

  it('多格建築：站在 footprint 內任一格都算到崗', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'bc1', type: 'big-camp', x: 3, y: 3 });
    state.citizens.push({ id: 'c1', home: 'h', job: 'bc1', x: 4, y: 4 });
    createProductionSystem(DEFS).update(state, ctx());
    expect(getResource(state, 'wood')).toBe(4);
  });

  it('多格建築：footprint 外一格不算到崗', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'bc1', type: 'big-camp', x: 3, y: 3 });
    state.citizens.push({ id: 'c1', home: 'h', job: 'bc1', x: 5, y: 3 });
    createProductionSystem(DEFS).update(state, ctx());
    expect(getResource(state, 'wood')).toBe(0);
  });

  it('jobs 為 0 的建築不受影響：沒有工人也照常產出（jobRatio 恆為 1）', () => {
    const defs: BuildingDef[] = [
      { id: 'shrine', name: '神龕', size: { w: 1, h: 1 }, cost: {}, production: { wood: 3 }, housing: 0, jobs: 0 },
    ];
    const state = createInitialState(1);
    state.buildings.push({ id: 's1', type: 'shrine', x: 8, y: 8 });
    createProductionSystem(defs).update(state, ctx());
    expect(getResource(state, 'wood')).toBe(3);
  });

  it('job 為 null 的居民即使站在建築上也不算在職', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'lc1', type: 'lumber-camp', x: 5, y: 7 });
    state.citizens.push({ id: 'c1', home: 'h', job: null, x: 5, y: 7 });
    expect(run(state)).toBe(0);
  });

  it('job 指向不存在的建築 → 不計入也不 throw', () => {
    const state = createInitialState(1);
    state.buildings.push({ id: 'lc1', type: 'lumber-camp', x: 5, y: 7 });
    state.citizens.push({ id: 'c1', home: 'h', job: 'ghost', x: 5, y: 7 });
    expect(() => run(state)).not.toThrow();
    expect(getResource(state, 'wood')).toBe(0);
  });

  it('通勤距離愈遠、當日有效工時愈短（本 system 只看當下，此處驗算的是模型的算術前提）', () => {
    // 速度 0.1 格/tick、上半日 300 tick：有效工時 = max(0, 300 - 10×距離)
    const effectiveTicks = (distance: number): number => Math.max(0, 300 - 10 * distance);
    expect(effectiveTicks(0)).toBe(300);
    expect(effectiveTicks(10)).toBe(200);
    expect(effectiveTicks(24)).toBe(60);
    expect(effectiveTicks(30)).toBe(0);
  });
});
