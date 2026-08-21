// R1-R6：等距座標模組（src/render/iso.ts）
import { describe, expect, it } from 'vitest';
import { TILE_W, TILE_H, gridToScreen, tileCenter, screenToGrid, hitTile, depthKey } from '../../src/render/iso';

describe('等距座標常數（R1）', () => {
  it('TILE_W = 64, TILE_H = 32', () => {
    expect(TILE_W).toBe(64);
    expect(TILE_H).toBe(32);
  });
});

describe('gridToScreen：格座標轉畫面座標（菱形頂端頂點，R2）', () => {
  it('known-answer：(0,0)→(0,0)', () => {
    expect(gridToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('known-answer：(1,0)→(32,16)', () => {
    expect(gridToScreen(1, 0)).toEqual({ x: 32, y: 16 });
  });

  it('known-answer：(0,1)→(-32,16)', () => {
    expect(gridToScreen(0, 1)).toEqual({ x: -32, y: 16 });
  });

  it('known-answer：(2,3)→(-32,80)', () => {
    expect(gridToScreen(2, 3)).toEqual({ x: -32, y: 80 });
  });

  it('公式驗證：x=(gx-gy)*TILE_W/2, y=(gx+gy)*TILE_H/2（gx,gy 於 [-5,5] 全組合）', () => {
    for (let gx = -5; gx <= 5; gx++) {
      for (let gy = -5; gy <= 5; gy++) {
        const { x, y } = gridToScreen(gx, gy);
        expect(x).toBeCloseTo(((gx - gy) * TILE_W) / 2, 9);
        expect(y).toBeCloseTo(((gx + gy) * TILE_H) / 2, 9);
      }
    }
  });
});

describe('tileCenter：菱形中心座標（R3）', () => {
  it('等於 gridToScreen 的頂點座標再加 (0, TILE_H/2)', () => {
    for (let gx = -3; gx <= 3; gx++) {
      for (let gy = -3; gy <= 3; gy++) {
        const vertex = gridToScreen(gx, gy);
        const center = tileCenter(gx, gy);
        expect(center.x).toBeCloseTo(vertex.x, 9);
        expect(center.y).toBeCloseTo(vertex.y + TILE_H / 2, 9);
      }
    }
  });

  it('known-answer：(0,0)→(0,16)、(1,0)→(32,32)、(2,3)→(-32,96)', () => {
    expect(tileCenter(0, 0)).toEqual({ x: 0, y: 16 });
    expect(tileCenter(1, 0)).toEqual({ x: 32, y: 32 });
    expect(tileCenter(2, 3)).toEqual({ x: -32, y: 96 });
  });
});

describe('screenToGrid：畫面座標轉格座標（gridToScreen 的精確逆變換，R4）', () => {
  it('known-answer：(32,16)→(1,0)、(-32,16)→(0,1)', () => {
    const a = screenToGrid(32, 16);
    expect(a.gx).toBeCloseTo(1, 9);
    expect(a.gy).toBeCloseTo(0, 9);

    const b = screenToGrid(-32, 16);
    expect(b.gx).toBeCloseTo(0, 9);
    expect(b.gy).toBeCloseTo(1, 9);
  });

  it('往返還原：對任意整數格 gx,gy∈[-20,20]，gridToScreen 後 screenToGrid 誤差 < 1e-9', () => {
    for (let gx = -20; gx <= 20; gx += 5) {
      for (let gy = -20; gy <= 20; gy += 5) {
        const screen = gridToScreen(gx, gy);
        const back = screenToGrid(screen.x, screen.y);
        expect(Math.abs(back.gx - gx)).toBeLessThan(1e-9);
        expect(Math.abs(back.gy - gy)).toBeLessThan(1e-9);
      }
    }
  });

  it('公式驗證：gx=(x/(TILE_W/2)+y/(TILE_H/2))/2, gy=(y/(TILE_H/2)-x/(TILE_W/2))/2', () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [32, 16],
      [-32, 16],
      [-32, 80],
      [100, -47],
      [-1, -1],
    ];
    for (const [x, y] of samples) {
      const { gx, gy } = screenToGrid(x, y);
      expect(gx).toBeCloseTo((x / (TILE_W / 2) + y / (TILE_H / 2)) / 2, 9);
      expect(gy).toBeCloseTo((y / (TILE_H / 2) - x / (TILE_W / 2)) / 2, 9);
    }
  });
});

describe('hitTile：滑鼠拾取（screenToGrid 各取 Math.floor，R5）', () => {
  it('等於 screenToGrid 結果各自 floor', () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [32, 16],
      [-1, -1],
      [100, -47],
      [17.5, -3.25],
    ];
    for (const [x, y] of samples) {
      const g = screenToGrid(x, y);
      const hit = hitTile(x, y);
      expect(hit.gx).toBe(Math.floor(g.gx));
      expect(hit.gy).toBe(Math.floor(g.gy));
    }
  });

  it('以 tileCenter(gx,gy) 為輸入時 hitTile 必回原格（gx,gy∈[-5,5] 全組合）', () => {
    for (let gx = -5; gx <= 5; gx++) {
      for (let gy = -5; gy <= 5; gy++) {
        const center = tileCenter(gx, gy);
        const hit = hitTile(center.x, center.y);
        expect(hit).toEqual({ gx, gy });
      }
    }
  });

  it('菱形內部偏移點（中心±(10,4)）仍命中同一格', () => {
    for (let gx = -3; gx <= 3; gx++) {
      for (let gy = -3; gy <= 3; gy++) {
        const center = tileCenter(gx, gy);
        expect(hitTile(center.x + 10, center.y + 4)).toEqual({ gx, gy });
        expect(hitTile(center.x - 10, center.y - 4)).toEqual({ gx, gy });
      }
    }
  });

  it('known-answer：(0,0) 頂點正上方一像素 (0,-1) 命中 (-1,-1)', () => {
    expect(hitTile(0, -1)).toEqual({ gx: -1, gy: -1 });
  });
});

describe('depthKey：繪製深度排序鍵（R6）', () => {
  it('等於 gx + gy', () => {
    for (let gx = -5; gx <= 5; gx++) {
      for (let gy = -5; gy <= 5; gy++) {
        expect(depthKey(gx, gy)).toBe(gx + gy);
      }
    }
  });

  it('單調性：畫面 y（tileCenter）較大（更靠前）者 depthKey 不小於較小者（gx,gy∈[0,8] 全配對）', () => {
    const tiles: Array<{ gx: number; gy: number }> = [];
    for (let gx = 0; gx <= 8; gx++) {
      for (let gy = 0; gy <= 8; gy++) {
        tiles.push({ gx, gy });
      }
    }

    for (const a of tiles) {
      for (const b of tiles) {
        const yA = tileCenter(a.gx, a.gy).y;
        const yB = tileCenter(b.gx, b.gy).y;
        const keyA = depthKey(a.gx, a.gy);
        const keyB = depthKey(b.gx, b.gy);
        if (yA > yB) {
          expect(keyA).toBeGreaterThanOrEqual(keyB);
        } else if (yA < yB) {
          expect(keyA).toBeLessThanOrEqual(keyB);
        } else {
          expect(keyA).toBe(keyB);
        }
      }
    }
  });
});
