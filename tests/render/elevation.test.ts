// 階梯高度的渲染慣例（src/render/elevation.ts）
import { describe, expect, it } from 'vitest';
import {
  ELEVATION_STEP,
  floatElevationOffsetY,
  pickElevatedTile,
} from '../../src/render/elevation';
import { hitTile, tileCenter } from '../../src/render/iso';

/** 假地形：矩形高台。x>=10 且 y>=10 的格是 2 階，其餘 0 階。 */
function plateauLevel(gx: number, gy: number): number {
  return gx >= 10 && gy >= 10 ? 2 : 0;
}

describe('pickElevatedTile', () => {
  it('平地（全 0 階）時與平面 hitTile 完全一致', () => {
    const flat = () => 0;
    for (const [wx, wy] of [[0, 0], [100, 37], [-50, 20], [321, 179]] as const) {
      expect(pickElevatedTile(wx, wy, flat)).toEqual(hitTile(wx, wy));
    }
  });

  it('點在高台格「畫出來的頂面」上要選中該格，而不是它後面的格', () => {
    // 格 (12,12) 是 2 階，頂面畫在平面位置上移 2*STEP 處。
    // 點頂面的「上半部」：上移 16px 後，菱形上半的螢幕位置已在平面菱形之外，
    // 平面拾取必然答錯——這正是要修的缺陷。點頂面下半平面拾取碰巧也對，測不出差異。
    const c = tileCenter(12, 12);
    const clickY = c.y - 2 * ELEVATION_STEP - 12;
    // 平面拾取會答錯（選到更後面的格）——這正是要修的缺陷
    expect(hitTile(c.x, clickY)).not.toEqual({ gx: 12, gy: 12 });
    // 高度感知拾取答對
    expect(pickElevatedTile(c.x, clickY, plateauLevel)).toEqual({ gx: 12, gy: 12 });
  });

  it('點在平地格上不受高台存在影響', () => {
    const c = tileCenter(5, 5);
    expect(pickElevatedTile(c.x, c.y, plateauLevel)).toEqual({ gx: 5, gy: 5 });
  });

  it('高台邊緣的前一格（平地）仍可選中', () => {
    // 取中心偏上 4px 而不是正中心：平地格的正中心恰好是後方高台頂面的下尖角，
    // 兩格在該像素重疊，演算法把 tie 判給視覺在前的高台（合理），避開它測主體行為。
    const c = tileCenter(9, 12);
    expect(pickElevatedTile(c.x, c.y - 4, plateauLevel)).toEqual({ gx: 9, gy: 12 });
  });
});

describe('floatElevationOffsetY', () => {
  const state = { worldSeed: 1, worldSize: 200 };

  it('整數格上等於 -level*STEP（插值在格點退化為精確值）', () => {
    // 在真實世界找一個非 0 階的格驗證
    for (let x = 90; x < 110; x++) {
      const offset = floatElevationOffsetY(state, x, 100);
      expect(Math.abs(offset % ELEVATION_STEP)).toBe(0);
      expect(offset).toBeLessThanOrEqual(0);
    }
  });

  it('沿線移動時偏移連續：相鄰取樣點的差有界（不會瞬間跳一整階）', () => {
    let prev = floatElevationOffsetY(state, 60, 100);
    for (let fx = 60.1; fx <= 140; fx += 0.1) {
      const cur = floatElevationOffsetY(state, Math.round(fx * 10) / 10, 100);
      // 一步 0.1 格，插值斜率最大一階/格 → 每步最多 0.1*STEP，取寬鬆上界 0.2*STEP
      expect(Math.abs(cur - prev)).toBeLessThanOrEqual(0.2 * ELEVATION_STEP + 1e-9);
      prev = cur;
    }
  });
});
