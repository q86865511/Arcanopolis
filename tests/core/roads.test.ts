import { describe, expect, it } from 'vitest';
import {
  hasRoad,
  parseRoadKey,
  placeRoad,
  removeRoad,
  roadCount,
  roadKey,
  roadTiles,
} from '../../src/core/world/roads';
import { createInitialState } from '../../src/core/world/state';

describe('道路資料純函數', () => {
  it('鍵格式可來回解析，非規範格式回 null', () => {
    expect(roadKey(12, 34)).toBe('12,34');
    expect(parseRoadKey(roadKey(12, 34))).toEqual({ x: 12, y: 34 });

    for (const key of ['-1,0', '0,-1', '01,0', '0,01', '1.5,2', '1', '1,2,3', 'x,y']) {
      expect(parseRoadKey(key)).toBeNull();
    }
  });

  it('越界或非整數座標不放置且不改 state', () => {
    const state = createInitialState(1);
    state.worldSize = 3;

    for (const [x, y] of [[-1, 0], [0, -1], [3, 0], [0, 3], [1.5, 1]]) {
      expect(placeRoad(state, x, y)).toBe(false);
    }
    expect(state.roads).toEqual({});
  });

  it('放置、重複放置與拆除維持布林回傳契約', () => {
    const state = createInitialState(2);

    expect(placeRoad(state, 4, 5)).toBe(true);
    expect(state.roads).toEqual({ '4,5': 1 });
    expect(hasRoad(state, 4, 5)).toBe(true);
    expect(placeRoad(state, 4, 5)).toBe(false);
    expect(removeRoad(state, 4, 5)).toBe(true);
    expect(hasRoad(state, 4, 5)).toBe(false);
    expect(removeRoad(state, 4, 5)).toBe(false);
  });

  it('hasRoad 只採 own-property 語義', () => {
    const state = createInitialState(3);
    state.roads = Object.create({ '1,1': 1 }) as Record<string, 1>;
    expect(hasRoad(state, 1, 1)).toBe(false);
  });

  it('計數與列舉依鍵的插入順序', () => {
    const state = createInitialState(4);
    expect(placeRoad(state, 2, 2)).toBe(true);
    expect(placeRoad(state, 0, 1)).toBe(true);
    expect(placeRoad(state, 3, 0)).toBe(true);

    expect(roadCount(state)).toBe(3);
    expect(roadTiles(state)).toEqual([
      { x: 2, y: 2 },
      { x: 0, y: 1 },
      { x: 3, y: 0 },
    ]);
  });
});
