// S4：cameraBounds.ts 純算式測試（M3.5 審查建議——F1「簽章殘留」正是這類單元測試會抓到的）
import { describe, expect, it } from 'vitest';
import { computeCameraBounds, type Rect } from '../../src/render/cameraBounds';

const WORLD: Rect = { x: -512, y: -224, w: 1024, h: 736 };

describe('computeCameraBounds（S4）', () => {
  it('世界大於等於視窗時逐位元等於世界矩形（回歸保護，21 組數值審查已驗過的性質）', () => {
    const cases: Array<[number, number]> = [
      [640, 360], // 對齊審查實機 1280x720/zoom2 的 displayWidth/Height（1280/2, 720/2）
      [1024, 736], // 恰好等於世界尺寸
      [800, 600],
      [1, 1],
    ];
    for (const [vw, vh] of cases) {
      expect(computeCameraBounds(WORLD, vw, vh)).toEqual(WORLD);
    }
  });

  it('視窗大於世界時，兩軸都置中且尺寸取視窗值', () => {
    const result = computeCameraBounds(WORLD, 2560, 1440);
    expect(result.w).toBe(2560);
    expect(result.h).toBe(1440);
    // 置中：world 中心 = result 中心
    const worldCenterX = WORLD.x + WORLD.w / 2;
    const worldCenterY = WORLD.y + WORLD.h / 2;
    expect(result.x + result.w / 2).toBeCloseTo(worldCenterX, 9);
    expect(result.y + result.h / 2).toBeCloseTo(worldCenterY, 9);
  });

  it('單軸擴張：視窗只在橫向比世界寬時，只有橫軸置中擴張，縱軸維持世界原值', () => {
    // 世界 1024x736；視窗 2560x600（橫向遠大於世界，縱向小於世界）
    const result = computeCameraBounds(WORLD, 2560, 600);
    expect(result.w).toBe(2560);
    expect(result.h).toBe(WORLD.h);
    expect(result.y).toBe(WORLD.y);
    const worldCenterX = WORLD.x + WORLD.w / 2;
    expect(result.x + result.w / 2).toBeCloseTo(worldCenterX, 9);
  });

  it('單軸擴張：2560x1440/zoom2（可視範圍＝畫面尺寸/zoom＝1280x720）只橫向擴張（審查實機案例）', () => {
    // 對齊審查實機取樣：resize 2560x1440 時 displayWidth/Height = 2560/2, 1440/2 = 1280x720，
    // 橫向 1280 > 1024（世界寬）擴張、縱向 720 < 736（世界高）不變，
    // 結果應等於審查實測 bounds=[-640,-224,1280,736]。
    const result = computeCameraBounds(WORLD, 1280, 720);
    expect(result).toEqual({ x: -640, y: -224, w: 1280, h: 736 });
  });

  it('極端輸入：0 尺寸世界時，結果等於視窗本身置中於世界原點', () => {
    const zeroWorld: Rect = { x: 100, y: 200, w: 0, h: 0 };
    const result = computeCameraBounds(zeroWorld, 640, 480);
    expect(result).toEqual({ x: 100 - 320, y: 200 - 240, w: 640, h: 480 });
  });

  it('極端輸入：視窗尺寸為 0 時，結果等於世界矩形本身（世界佔優）', () => {
    expect(computeCameraBounds(WORLD, 0, 0)).toEqual(WORLD);
  });

  it('極端輸入：極窄視窗（1px 寬）仍逐軸取大＋置中，不出現 NaN/負尺寸', () => {
    const result = computeCameraBounds(WORLD, 1, 100000);
    expect(result.w).toBe(WORLD.w);
    expect(result.h).toBe(100000);
    expect(Number.isNaN(result.x)).toBe(false);
    expect(Number.isNaN(result.y)).toBe(false);
  });
});
