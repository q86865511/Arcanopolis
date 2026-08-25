// 地面裝飾散佈物（src/render/decor.ts）
import { describe, expect, it } from 'vitest';
import { decorPlacementsFor } from '../../src/render/decor';
import type { TerrainType } from '../../src/core/world/terrain';

const SEED = 1;
const OFFSET_RANGE = 12;

describe('decorPlacementsFor：決定論', () => {
  it('同 (seed,gx,gy,type) 重複呼叫恆得同一結果', () => {
    const first = decorPlacementsFor(SEED, 5, 5, 'grass');
    for (let i = 0; i < 5; i++) {
      expect(decorPlacementsFor(SEED, 5, 5, 'grass')).toEqual(first);
    }
  });
});

describe('decorPlacementsFor：不放裝飾的地形', () => {
  it('water/forest/rock/mountain 一律不放——森林/岩地本身已夠碎，水面不該長陸生裝飾', () => {
    for (const type of ['water', 'forest', 'rock', 'mountain'] as const) {
      for (let gx = 0; gx < 50; gx++) {
        expect(decorPlacementsFor(SEED, gx, gx + 3, type)).toEqual([]);
      }
    }
  });
});

describe('decorPlacementsFor：偏移在界內', () => {
  it('有放裝飾時 dx/dy 都在 ±OFFSET_RANGE 之內', () => {
    for (let gx = 0; gx < 200; gx++) {
      for (const type of ['grass', 'sand'] as const) {
        const placements = decorPlacementsFor(SEED, gx, gx * 3 + 1, type);
        for (const { dx, dy } of placements) {
          expect(Math.abs(dx)).toBeLessThanOrEqual(OFFSET_RANGE);
          expect(Math.abs(dy)).toBeLessThanOrEqual(OFFSET_RANGE);
        }
      }
    }
  });
});

/** 掃一個矩形區域統計密度與 grass 命中率。 */
function densityOf(type: TerrainType, size: number): number {
  let hits = 0;
  let total = 0;
  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      total += 1;
      if (decorPlacementsFor(SEED, gx, gy, type).length > 0) hits += 1;
    }
  }
  return hits / total;
}

describe('decorPlacementsFor：密度上下界', () => {
  it('grass 命中率在 0.12±0.04（掃 10000 格）', () => {
    const rate = densityOf('grass', 100);
    expect(rate).toBeGreaterThanOrEqual(0.08);
    expect(rate).toBeLessThanOrEqual(0.16);
  });

  it('sand 命中率在 0.06±0.03（掃 10000 格）', () => {
    const rate = densityOf('sand', 100);
    expect(rate).toBeGreaterThanOrEqual(0.03);
    expect(rate).toBeLessThanOrEqual(0.09);
  });
});

describe('decorPlacementsFor：挑選的 key 屬於該地形的候選集合', () => {
  it('grass 只會挑到 12 張裝飾之一，sand 只會挑到石頭', () => {
    const grassKeys = new Set([
      'decor-rock-01',
      'decor-rock-02',
      'decor-rock-03',
      'decor-bush-01',
      'decor-bush-02',
      'decor-bush-03',
      'decor-flower-01',
      'decor-flower-02',
      'decor-stump-01',
      'decor-log-01',
      'decor-puddle-01',
      'decor-rut-01',
    ]);
    const sandKeys = new Set(['decor-rock-01', 'decor-rock-02', 'decor-rock-03']);

    for (let gx = 0; gx < 200; gx++) {
      for (const [type, allowed] of [
        ['grass', grassKeys],
        ['sand', sandKeys],
      ] as const) {
        for (const { key } of decorPlacementsFor(SEED, gx, gx * 5 + 2, type)) {
          expect(allowed.has(key)).toBe(true);
        }
      }
    }
  });
});
