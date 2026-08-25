// 階梯高度（src/core/world/terrain.ts 的 elevationLevelAt）
import { describe, expect, it } from 'vitest';
import { baseTerrainAt, elevationLevelAt } from '../../src/core/world/terrain';

const SEED = 1;
const SIZE = 200;

describe('elevationLevelAt', () => {
  it('決定論：同 seed 同座標永遠同值', () => {
    for (const [x, y] of [[0, 0], [100, 100], [37, 158], [199, 199]] as const) {
      expect(elevationLevelAt(SEED, SIZE, x, y)).toBe(elevationLevelAt(SEED, SIZE, x, y));
    }
  });

  it('值域是 0..3 的整數', () => {
    for (let i = 0; i < 400; i++) {
      const x = (i * 37) % SIZE;
      const y = (i * 91) % SIZE;
      const lv = elevationLevelAt(SEED, SIZE, x, y);
      expect(Number.isInteger(lv)).toBe(true);
      expect(lv).toBeGreaterThanOrEqual(0);
      expect(lv).toBeLessThanOrEqual(3);
    }
  });

  it('與地形分類一致：水/沙恆為 0，山地恆為 3（同一份高程值切出來的代數保證）', () => {
    let seenWaterOrSand = 0;
    let seenMountain = 0;
    for (let y = 0; y < SIZE; y += 3) {
      for (let x = 0; x < SIZE; x += 3) {
        const t = baseTerrainAt(SEED, SIZE, x, y);
        const lv = elevationLevelAt(SEED, SIZE, x, y);
        if (t === 'water' || t === 'sand') {
          expect(lv).toBe(0);
          seenWaterOrSand++;
        } else if (t === 'mountain') {
          expect(lv).toBe(3);
          seenMountain++;
        } else {
          // 平地帶（草/林/岩）落在 1 或 2——刻意不對齊地形分類，讓階地邊緣穿過草原
          expect(lv === 1 || lv === 2).toBe(true);
        }
      }
    }
    expect(seenWaterOrSand).toBeGreaterThan(0);
    expect(seenMountain).toBeGreaterThan(0);
  });

  it('相鄰格最多跳一階（fBm 連續性；裙邊素材只需支援單階的依據）', () => {
    // 全圖掃太慢，抽樣一個涵蓋海岸與山地的帶狀區域
    for (let y = 60; y < 140; y++) {
      for (let x = 60; x < 140; x++) {
        const lv = elevationLevelAt(SEED, SIZE, x, y);
        expect(Math.abs(lv - elevationLevelAt(SEED, SIZE, x + 1, y))).toBeLessThanOrEqual(1);
        expect(Math.abs(lv - elevationLevelAt(SEED, SIZE, x, y + 1))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('越界回 0（世界之外是海）', () => {
    expect(elevationLevelAt(SEED, SIZE, -1, 50)).toBe(0);
    expect(elevationLevelAt(SEED, SIZE, 50, SIZE)).toBe(0);
  });

  it('非整數座標 throw（與 terrainAt 同語義）', () => {
    expect(() => elevationLevelAt(SEED, SIZE, 1.5, 2)).toThrow();
  });
});
