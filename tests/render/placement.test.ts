// 建築擺放慣例（src/render/placement.ts）：多格 (w×h) 錨點與 depth
import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W, gridToScreen, tileCenter } from '../../src/render/iso';
import { buildingAnchor, buildingDepth } from '../../src/render/placement';

describe('buildingAnchor：1×1 回歸（不得破壞既有呼叫端）', () => {
  it('省略 w/h 時與舊版公式逐字相同（gx,gy∈[-5,5] 全組合）', () => {
    for (let gx = -5; gx <= 5; gx++) {
      for (let gy = -5; gy <= 5; gy++) {
        const anchor = buildingAnchor(gx, gy);
        const center = tileCenter(gx, gy);
        expect(anchor.x).toBeCloseTo(center.x, 9);
        expect(anchor.y).toBeCloseTo(center.y + TILE_H / 2, 9);
      }
    }
  });

  it('顯式傳 w=1,h=1 與省略時結果相同', () => {
    for (const [gx, gy] of [
      [0, 0],
      [3, -2],
      [-4, 7],
    ] as const) {
      expect(buildingAnchor(gx, gy, 1, 1)).toEqual(buildingAnchor(gx, gy));
    }
  });

  it('known-answer：(0,0)→(0,32)、(2,3)→(-32,112)', () => {
    expect(buildingAnchor(0, 0)).toEqual({ x: 0, y: 32 });
    expect(buildingAnchor(2, 3)).toEqual({ x: -32, y: 112 });
  });
});

describe('buildingAnchor：2×2 多格 footprint', () => {
  it('x 為四格螢幕投影的水平中心（左緣格與右緣格頂點 x 的平均）', () => {
    for (const [gx, gy] of [
      [0, 0],
      [2, 3],
      [-4, 1],
    ] as const) {
      const anchor = buildingAnchor(gx, gy, 2, 2);
      // footprint 最左點：(gx, gy+1) 的左頂點；最右點：(gx+1, gy) 的右頂點
      const leftEdge = gridToScreen(gx, gy + 1).x - TILE_W / 2;
      const rightEdge = gridToScreen(gx + 1, gy).x + TILE_W / 2;
      expect(anchor.x).toBeCloseTo((leftEdge + rightEdge) / 2, 9);
    }
  });

  it('y 為前緣格 (gx+1, gy+1) 的底頂點', () => {
    for (const [gx, gy] of [
      [0, 0],
      [2, 3],
      [-4, 1],
    ] as const) {
      const anchor = buildingAnchor(gx, gy, 2, 2);
      const frontCenter = tileCenter(gx + 1, gy + 1);
      expect(anchor.y).toBeCloseTo(frontCenter.y + TILE_H / 2, 9);
    }
  });

  it('known-answer：2×2 於 (0,0) → x=0（正方形 footprint 與起點格同 x）', () => {
    const anchor = buildingAnchor(0, 0, 2, 2);
    expect(anchor.x).toBeCloseTo(0, 9);
    expect(anchor.y).toBeCloseTo(tileCenter(1, 1).y + TILE_H / 2, 9);
  });
});

describe('buildingDepth：2×2 取前緣格（現行為，釘死防回歸）', () => {
  it('等於前緣格 (gx+w-1, gy+h-1) 的 depthKey（=gx+w-1+gy+h-1）', () => {
    for (const [gx, gy] of [
      [0, 0],
      [2, 3],
      [-4, 1],
    ] as const) {
      expect(buildingDepth(gx, gy, 2, 2)).toBe(gx + 1 + (gy + 1));
    }
  });

  it('省略 w/h 時等同 1×1（與 depthKey(gx,gy) 相同）', () => {
    for (const [gx, gy] of [
      [0, 0],
      [5, -3],
    ] as const) {
      expect(buildingDepth(gx, gy)).toBe(gx + gy);
    }
  });
});
