// 放置不得把既有建築封死（src/core/world/buildable.ts 的 wouldTrapAnyBuilding）。
//
// 背景：格子被建築佔住即不可通行。M4.5 的平衡實測中，腳本玩家把某戶人家的四個正交鄰格
// 全部蓋滿，屋裡的居民從此走不出來、被指派的磨坊到崗恆為 0，全城慢性餓死——而畫面上
// 沒有任何徵兆。這個檔鎖住「不准造成那種狀態」。
import { describe, expect, it } from 'vitest';
import { canBuildAt } from '../../src/core/world/buildable';
import { createInitialState, type GameState } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';
import type { TerrainOverride } from '../../src/core/world/terrain';

const HOUSE: BuildingDef = {
  id: 'house', name: '民居', size: { w: 1, h: 1 }, cost: {}, production: {}, housing: 4, jobs: 0,
};
const BIG: BuildingDef = {
  id: 'big', name: '大屋', size: { w: 2, h: 2 }, cost: {}, production: {}, housing: 0, jobs: 1,
};
const DEFS = [HOUSE, BIG];

/** 在指定範圍鋪平草地，讓地形不成為干擾變因。 */
function grassWorld(): GameState {
  const state = createInitialState(1);
  state.worldSize = 40;
  const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
  for (let x = 8; x <= 16; x++) {
    for (let y = 8; y <= 16; y++) overrides[`${x},${y}`] = { type: 'grass' };
  }
  return state;
}

function place(state: GameState, type: string, x: number, y: number): void {
  state.buildings.push({ id: `${type}@${x},${y}`, type, x, y });
}

describe('封死判定', () => {
  it('把民居的最後一個出口堵住 → 不准蓋', () => {
    const state = grassWorld();
    place(state, 'house', 12, 12);
    place(state, 'house', 11, 12); // 西
    place(state, 'house', 13, 12); // 東
    place(state, 'house', 12, 11); // 北
    // 南邊是最後一個出口
    expect(canBuildAt(state, HOUSE, 12, 13, DEFS)).toBe(false);
  });

  it('還留有其他出口時照常可蓋', () => {
    const state = grassWorld();
    place(state, 'house', 12, 12);
    place(state, 'house', 11, 12);
    place(state, 'house', 13, 12);
    // 只堵北，南仍通
    expect(canBuildAt(state, HOUSE, 12, 11, DEFS)).toBe(true);
  });

  it('空地上第一棟建築不受此規則影響', () => {
    expect(canBuildAt(grassWorld(), HOUSE, 12, 12, DEFS)).toBe(true);
  });

  it('本來就被地形圍住的建築不會讓別處的放置被追溯擋下', () => {
    const state = createInitialState(1);
    state.worldSize = 40;
    const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
    // 一格草地被水包住，上面已有建築（規則加入前本來就蓋得起來）
    overrides['20,20'] = { type: 'grass' };
    for (const [x, y] of [[19,20],[21,20],[20,19],[20,21]] as const) {
      overrides[`${x},${y}`] = { type: 'water' };
    }
    place(state, 'house', 20, 20);
    // 遠處另鋪一塊草地蓋新屋，不該因為那棟孤島建築而被擋
    for (let x = 8; x <= 12; x++) for (let y = 8; y <= 12; y++) overrides[`${x},${y}`] = { type: 'grass' };
    expect(canBuildAt(state, HOUSE, 10, 10, DEFS)).toBe(true);
  });

  it('多格建築：封住 2×2 建築的最後一個出口也擋得下來', () => {
    const state = grassWorld();
    place(state, 'big', 12, 12); // 佔 (12,12)(13,12)(12,13)(13,13)
    // 把周邊除了一格以外全部堵住
    for (const [x, y] of [[11,12],[11,13],[12,11],[13,11],[14,12],[14,13],[12,14]] as const) {
      place(state, 'house', x, y);
    }
    // (13,14) 是最後一個出口
    expect(canBuildAt(state, HOUSE, 13, 14, DEFS)).toBe(false);
  });

  it('多格建築本身的內部格不算出口——不能靠自己的佔格當通路', () => {
    const state = grassWorld();
    place(state, 'big', 12, 12);
    for (const [x, y] of [[11,12],[11,13],[12,11],[13,11],[14,12],[14,13],[12,14],[13,14]] as const) {
      // 最後一格封完應該已經違規，所以逐格檢查到違規為止
      if (!canBuildAt(state, HOUSE, x, y, DEFS)) {
        expect(true).toBe(true);
        return;
      }
      place(state, 'house', x, y);
    }
    throw new Error('把 2×2 建築四周全部封滿都沒有被擋下來');
  });
});
