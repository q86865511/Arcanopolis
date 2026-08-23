// 拆除確認判定（src/render/demolition.ts）
import { describe, expect, it } from 'vitest';
import { demolitionWarning, residentCount, workerCount } from '../../src/render/demolition';
import { createInitialState, type Building, type GameState } from '../../src/core/world/state';
import type { BuildingDef } from '../../src/data/types';

const HOUSE_DEF: BuildingDef = {
  id: 'house',
  name: '民居',
  size: { w: 1, h: 1 },
  cost: {},
  production: {},
  housing: 4,
  jobs: 0,
};

const FARM_DEF: BuildingDef = {
  id: 'farm',
  name: '農場',
  size: { w: 1, h: 1 },
  cost: {},
  production: { grain: 4 },
  housing: 0,
  jobs: 2,
};

const house: Building = { id: 'h1', type: 'house', x: 0, y: 0 };
const farm: Building = { id: 'f1', type: 'farm', x: 3, y: 0 };

function worldWith(residents: number, workers: number): GameState {
  const state = createInitialState(1);
  state.buildings.push(house, farm);
  for (let i = 0; i < residents; i++) {
    state.citizens.push({ id: `r${i}`, home: 'h1', job: null, x: 0, y: 0 });
  }
  for (let i = 0; i < workers; i++) {
    state.citizens.push({ id: `w${i}`, home: 'other', job: 'f1', x: 3, y: 0 });
  }
  return state;
}

describe('residentCount / workerCount', () => {
  it('分別數以該建築為家、與在該建築工作的居民', () => {
    const state = worldWith(3, 2);
    expect(residentCount(state, 'h1')).toBe(3);
    expect(workerCount(state, 'f1')).toBe(2);
    expect(residentCount(state, 'f1')).toBe(0);
    expect(workerCount(state, 'h1')).toBe(0);
  });

  it('查無此建築時回 0 而非 throw', () => {
    expect(residentCount(worldWith(1, 1), 'nope')).toBe(0);
    expect(workerCount(worldWith(1, 1), 'nope')).toBe(0);
  });
});

describe('demolitionWarning', () => {
  it('有住戶的建築要警告，訊息含建築名與住戶數', () => {
    const warning = demolitionWarning(worldWith(3, 0), house, HOUSE_DEF);
    expect(warning).not.toBeNull();
    expect(warning).toContain('民居');
    expect(warning).toContain('3');
  });

  it('空屋不警告：沒有東西會消失', () => {
    expect(demolitionWarning(worldWith(0, 0), house, HOUSE_DEF)).toBeNull();
  });

  it('只有工人的建築不警告——工人下一 tick 會被重新指派，是可回復的', () => {
    expect(demolitionWarning(worldWith(0, 2), farm, FARM_DEF)).toBeNull();
  });

  it('查不到 def 時退回用 type 當名稱，不會顯示 undefined', () => {
    const warning = demolitionWarning(worldWith(2, 0), house, undefined);
    expect(warning).toContain('house');
    expect(warning).not.toContain('undefined');
  });
});
